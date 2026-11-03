import { isValidObjectId } from "mongoose";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { scoped } from "@/lib/account-scope";
import { getAccountSendProblem, hasActiveSubscription, isBlocked } from "@/lib/account-state";
import { getArchiveIssue, listOtherIssuePictures } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getShareCardUrl } from "@/lib/archive-seo";
import { findCampaignLinks } from "@/lib/campaign-links";
import { readRecipientFilter } from "@/lib/campaign-recipient-rules";
import { listCampaignRecipients } from "@/lib/campaign-recipients";
import { getCampaignActivity, getCampaignComparison } from "@/lib/campaign-report";
import { countCampaignGmail, countRemainingContacts, sendTimesPipeline } from "@/lib/campaign-queries";
import { getSharedDomain, isSendingEnabled } from "@/lib/config";
import { getFieldOptions } from "@/lib/contact-fields";
import { getStoredTips } from "@/lib/content-review";
import { getPageViews } from "@/lib/page-views";
import { getPostalAddress } from "@/lib/postal-address";
import { sendsEmail } from "@/lib/publish-to";
import { countAudience, countSegmentCards, findCampaignSegmentFilter, listLiveSegments } from "@/lib/segment-queries";
import { compileSegment, describeSegment } from "@/lib/segments";
import { findInNewsletters, getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { getPace } from "@/lib/send-spread";
import { serialize } from "@/lib/serialize";
import { findAccountDomains, loadSender } from "@/lib/sender";
import { getOwnDomainNudge, isOnSharedDomain, isOwnDomainNudgeShown } from "@/lib/sender-rules";
import { getSenderVolumes } from "@/lib/sender-warmup";
import { siteExtensions } from "@/lib/site-extensions";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";
import { countEmailsInFlight, getUsage } from "@/lib/usage";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Campaign" };

// The recipients a sent campaign's report lists at first, and how many more each Show more adds (?shown=).
const RECIPIENTS_STEP = 50;
const MAX_RECIPIENTS = 500;

export default async function CampaignPage({ params, searchParams }) {
	const [{ id }, query, view] = await Promise.all([params, searchParams, getSelectedNewsletter()]);
	const { user, account } = view;
	if (!isValidObjectId(id)) notFound();

	const campaign = await findInNewsletters(view, Campaign, id);
	if (!campaign) notFound();
	openNewsletter(view, campaign.newsletterId, `/campaigns/${id}`);
	if (!campaign.newsletterId.equals(view.selected._id)) notFound();
	const stored = await Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).lean();
	if (!stored) notFound();
	// The previews and the checks show the address its emails print.
	const newsletter = { ...stored, postalAddress: getPostalAddress(stored, siteExtensions.defaultPostalAddress) };
	const plan = await getPlanState(account);

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const filter = readRecipientFilter(query.recipients);
		const shown = Math.min(MAX_RECIPIENTS, Math.max(RECIPIENTS_STEP, Number.parseInt(query.shown, 10) || RECIPIENTS_STEP));
		const [{ providers, timeline, recipients: counts }, comparison, remainingCount, links, cookieStore, list, issue] = await Promise.all([
			getCampaignActivity(campaign),
			getCampaignComparison(campaign),
			countRemainingContacts(campaign),
			findCampaignLinks(campaign),
			cookies(),
			sendsEmail(campaign) ? listCampaignRecipients(account, campaign, { filter, limit: shown }) : null,
			newsletter.archiveEnabled && campaign.archiveSlug ? getArchiveIssue(newsletter, campaign.archiveSlug) : null,
		]);
		// Its card as the website shows it: its page's title, description and picture, or the card MailCheap draws.
		const webPage = issue && {
			title: issue.subject,
			description: issue.previewText,
			imageUrl: issue.thumbnailUrl || getShareCardUrl(newsletter, issue),
		};
		const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
		// For a next step's dialog, and how a send going out reaches Gmail's readers.
		const isGoingOut = ["sending", "paused"].includes(campaign.status);
		const [audience, senderVolumes, gmail, pageViews] = await Promise.all([
			remainingCount > 0 ? countAudience(account, newsletter._id, await findCampaignSegmentFilter(campaign)) : null,
			remainingCount > 0 || isGoingOut ? loadSenderVolumes(account, newsletter) : null,
			isGoingOut ? countCampaignGmail(campaign) : null,
			issue || !sendsEmail(campaign) ? getPageViews(campaign, timeZone) : null,
		]);
		return (
			<CampaignReport
				role={view.role}
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				contactFields={getFieldOptions(account)}
				providers={providers}
				links={serialize(links)}
				recipients={
					list && {
						filter,
						counts,
						recipients: list.recipients,
						hasMore: Boolean(list.nextCursor) && shown < MAX_RECIPIENTS,
						shown,
						step: RECIPIENTS_STEP,
					}
				}
				timeline={timeline}
				comparison={comparison}
				timeZone={timeZone}
				remainingCount={remainingCount}
				emailsLeft={plan.emailsLeft}
				isBlocked={isBlocked(account)}
				pace={getPace({ sender: senderVolumes })}
				newContacts={audience?.neverMailed ?? 0}
				gmail={gmail}
				gmailShare={getGmailShare(audience)}
				isSharedSender={isOnSharedDomain(newsletter.fromEmail, getSharedDomain())}
				webPage={webPage}
				pageViews={pageViews}
			/>
		);
	}

	// A draft whose segment was deleted goes to nobody until it gets another one.
	const segments = await listLiveSegments(account, newsletter._id);
	const segment = campaign.segmentId ? segments.find(({ _id }) => _id.equals(campaign.segmentId)) : null;
	const isSegmentDeleted = Boolean(campaign.segmentId && !segment);
	const [audience, everyone, sender, sendTimes, domains, tips, otherPictures] = await Promise.all([
		isSegmentDeleted ? { contacts: 0, neverMailed: 0, gmail: 0 } : countAudience(account, newsletter._id, segment && compileSegment(segment)),
		campaign.segmentId ? countSegmentCards(account, newsletter._id, []) : null,
		loadSender(account, newsletter),
		getSendTimes(campaign),
		findAccountDomains(account._id),
		getStoredTips({ campaign, newsletter }),
		newsletter.archiveEnabled ? listOtherIssuePictures(newsletter, campaign._id) : [],
	]);
	const senderVolumes = sender.identity ? await getSenderVolumes(account, newsletter, sender.identity) : null;
	const sharedDomain = getSharedDomain();
	const domainNudge = getOwnDomainNudge({ fromEmail: newsletter.fromEmail, domains, sharedDomain });
	// Without a plan there's no shared address yet, and adding a domain waits for one.
	const isDomainNudgeShown = hasActiveSubscription(account) && isOwnDomainNudgeShown(domainNudge, newsletter);

	return (
		<FormCampaign
			campaign={serialize(campaign)}
			newsletter={serialize(newsletter)}
			audienceCount={audience.contacts}
			everyoneCount={everyone?.everyone ?? audience.contacts}
			segments={segments.map(({ _id, name, match, conditions }) => ({
				id: String(_id),
				name,
				description: describeSegment({ match, conditions }, account.contactFields ?? []),
			}))}
			contactFields={getFieldOptions(account)}
			isSegmentDeleted={isSegmentDeleted}
			senderProblem={sender.problem ?? null}
			isSharedSender={isOnSharedDomain(newsletter.fromEmail, sharedDomain)}
			domainNudge={isDomainNudgeShown ? domainNudge : null}
			isSendingEnabled={isSendingEnabled()}
			testEmail={user.email}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
			planProblem={plan.problem}
			emailsLeft={plan.emailsLeft}
			pace={getPace({ sender: senderVolumes })}
			newContacts={audience.neverMailed}
			gmailShare={getGmailShare(audience)}
			tips={tips}
			otherPictures={otherPictures}
		/>
	);
}

// What the send dialogs need: emails left after the sends already going out (null: no limit), and what
// blocks any send. Without a plan, the send buttons open the paywall instead.
async function getPlanState(account) {
	if (!hasActiveSubscription(account)) return { emailsLeft: null, problem: null };
	const [usage, inFlight] = await Promise.all([getUsage(account), countEmailsInFlight(account._id)]);
	const accountProblem = getAccountSendProblem(account)?.message ?? null;
	if (usage.emailsLimit === null) return { emailsLeft: null, problem: accountProblem };
	const emailsLeft = Math.max(0, usage.emailsLimit - usage.emailsSent - inFlight);
	const problem =
		accountProblem ??
		(usage.subscribers > usage.subscribersLimit
			? "Over your plan's subscriber limit"
			: emailsLeft === 0
				? "This month's emails are used up"
				: null);
	return { emailsLeft, problem };
}

// How its domain holds Gmail's readers back: none while the newsletter can't send.
async function loadSenderVolumes(account, newsletter) {
	const sender = await loadSender(account, newsletter);
	return sender.identity ? getSenderVolumes(account, newsletter, sender.identity) : null;
}

function getGmailShare(audience) {
	return audience?.contacts ? audience.gmail / audience.contacts : 0;
}

// A newsletter's first issue borrows the times the account's other newsletters go out.
async function getSendTimes(campaign) {
	const { accountId } = campaign;
	const own = await Campaign.aggregate(
		sendTimesPipeline({ accountId, newsletterId: campaign.newsletterId, excludeId: campaign._id })
	);
	const rows = own.length > 0 ? own : await Campaign.aggregate(sendTimesPipeline({ accountId, excludeId: campaign._id }));
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}
