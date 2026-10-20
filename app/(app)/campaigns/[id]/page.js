import { isValidObjectId } from "mongoose";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { scoped } from "@/lib/account-scope";
import { getAccountSendProblem, hasActiveSubscription, isBlocked } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { findCampaignLinks } from "@/lib/campaign-links";
import { getCampaignActivity, getCampaignComparison } from "@/lib/campaign-report";
import { countNewContacts, countRemainingContacts, getSendVolumes, sendTimesPipeline } from "@/lib/campaign-queries";
import { isSendingEnabled } from "@/lib/config";
import { getPostalAddress } from "@/lib/postal-address";
import { countAudience, countSegmentCards, findCampaignSegmentFilter, listLiveSegments } from "@/lib/segment-queries";
import { compileSegment, describeSegment } from "@/lib/segments";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { getPace } from "@/lib/send-spread";
import { serialize } from "@/lib/serialize";
import { loadSender } from "@/lib/sender";
import { siteExtensions } from "@/lib/site-extensions";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";
import { countEmailsInFlight, getUsage } from "@/lib/usage";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const [{ id }, view] = await Promise.all([params, getSelectedNewsletter()]);
	const { user, account } = view;
	if (!isValidObjectId(id)) notFound();

	const campaign = await Campaign.findOne(scoped(account, { _id: id })).lean();
	if (!campaign) notFound();
	openNewsletter(view, campaign.newsletterId, `/campaigns/${id}`);
	const stored = await Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).lean();
	if (!stored) notFound();
	// The previews and the checks show the address its emails print.
	const newsletter = { ...stored, postalAddress: getPostalAddress(stored, siteExtensions.defaultPostalAddress) };
	const plan = await getPlanState(account);

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const [{ providers, timeline }, comparison, remainingCount, links, cookieStore] = await Promise.all([
			getCampaignActivity(campaign),
			getCampaignComparison(campaign),
			countRemainingContacts(campaign),
			findCampaignLinks(campaign),
			cookies(),
		]);
		// Only a next step needs them, for what its dialog says.
		const [volumes, newContacts] =
			remainingCount > 0
				? await Promise.all([
						getSendVolumes(account),
						countNewContacts(account, newsletter._id, await findCampaignSegmentFilter(campaign)),
					])
				: [];
		return (
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				providers={providers}
				links={serialize(links)}
				timeline={timeline}
				comparison={comparison}
				timeZone={resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value)}
				remainingCount={remainingCount}
				emailsLeft={plan.emailsLeft}
				isBlocked={isBlocked(account)}
				pace={getPace(account, volumes)}
				newContacts={newContacts}
			/>
		);
	}

	// A draft whose segment was deleted goes to nobody until it gets another one.
	const segments = await listLiveSegments(account, newsletter._id);
	const segment = campaign.segmentId ? segments.find(({ _id }) => _id.equals(campaign.segmentId)) : null;
	const isSegmentDeleted = Boolean(campaign.segmentId && !segment);
	const [audience, everyone, sender, sendTimes, volumes] = await Promise.all([
		isSegmentDeleted ? { contacts: 0, neverMailed: 0 } : countAudience(account, newsletter._id, segment && compileSegment(segment)),
		campaign.segmentId ? countSegmentCards(account, newsletter._id, []) : null,
		loadSender(account, newsletter),
		getSendTimes(campaign),
		getSendVolumes(account),
	]);

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
			isSegmentDeleted={isSegmentDeleted}
			senderProblem={sender.problem ?? null}
			isSendingEnabled={isSendingEnabled()}
			testEmail={user.email}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
			planProblem={plan.problem}
			emailsLeft={plan.emailsLeft}
			pace={getPace(account, volumes)}
			newContacts={audience.neverMailed}
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
