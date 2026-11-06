import { siteExtensions } from "@/lib/site-extensions";
import { getArchiveUrls, getLinkBaseUrl } from "./archive-hosts.js";
import { getAuthorByline } from "./author-rules.js";
import { LIMITS, getAppUrl } from "./config.js";
import { CONFIRM_URL_PLACEHOLDER } from "./confirmation-content.js";
import { SEND_OUTCOMES } from "./email-provider/outcomes.js";
import { KEEP_URL_PLACEHOLDER } from "./last-chance-content.js";
import { fillForReader, withoutMergeTags } from "./merge-tags.js";
import { hasEmailBody, toEmailContent } from "./newsletter-emails.js";
import { getPostalAddress } from "./postal-address.js";
import { goesOnWeb } from "./publish-to.js";
import { describeBlockLevel, describeRate, judgeRates } from "./rate-levels.js";
import { UNSUBSCRIBE_PLACEHOLDER, findButtonProblem, hasContent, renderEmail } from "./render-email.js";
import { EVERY_READER, forEmail } from "./sections.js";
import { slugify } from "./slug.js";
import { addTracking } from "./tracking.js";
import { getUnsubscribeLinks } from "./unsubscribe.js";

export const MAX_BATCH_MESSAGES = 100;
export const MAX_CONSECUTIVE_FAILURES = 5;
// Test emails have no contact: their unsubscribe link is valid but matches nobody.
export const TEST_CONTACT_ID = "000000000000000000000000";
// A send's own messages: the issue, and last-chance emails for cold contacts (lib/cleanup.js).
export const CAMPAIGN_MESSAGE_KINDS = ["campaign", "last-chance"];

const RETRY_ERRORS = new Set(["TooManyRequestsException", "ThrottlingException", "Throttling"]);
// These fail every following send too, so the campaign pauses until the account is fixed.
const PAUSE_ERRORS = new Set([
	"AccountSuspendedException",
	"SendingPausedException",
	"MailFromDomainNotVerifiedException",
	"LimitExceededException",
	"NotFoundException",
	"SenderNotAllowed",
]);

export function chunk(items, size) {
	const chunks = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

// RFC 5322 needs quotes around names with punctuation; SES needs RFC 2047 for non-ASCII names.
export function formatFromAddress({ fromName, fromEmail }) {
	const name = String(fromName ?? "")
		.replace(/[\r\n"\\]/g, "")
		.trim();
	if (!name) return fromEmail;
	if (/^[\x20-\x7e]+$/.test(name)) return `"${name}" <${fromEmail}>`;
	return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?= <${fromEmail}>`;
}

// Gmail's feedback loop (Google Postmaster Tools) reports a spam rate for each field on its own, so a value never repeats
// across fields or names a single email: the campaign, or the newsletter for its signup emails; the account, as
// mc-<accountId> like its tenant at either provider; the kind of email; and MailCheap, Gmail's sender ID.
export function getFeedbackId({ campaignId, newsletterId, accountId, kind }) {
	return [campaignId ?? newsletterId, `mc-${accountId}`, kind, "mailcheap"]
		.map((part) => String(part ?? "").replace(/[^A-Za-z0-9_-]/g, ""))
		.join(":");
}

// Newsletters that confirm signups say it all in the confirmation email: one email, not two.
export function getWelcomeContent(newsletter) {
	if (newsletter?.requireConfirmation) return null;
	const welcome = newsletter?.welcome;
	if (!welcome?.enabled || !welcome.subject?.trim() || !hasEmailBody(welcome)) return null;
	return toEmailContent(welcome);
}

// Issues link to their archive page. A draft has no slug yet, so its test email links to the one
// the subject gives when it goes out. Welcome emails aren't issues and have no page, and neither do email-only issues:
// their emails have no Read online link.
export function getIssueWebUrl({ campaign, newsletter }) {
	if (!newsletter?.archiveEnabled || !newsletter.slug || !campaign?._id || campaign.archiveListed === false) return null;
	if (!goesOnWeb(campaign)) return null;
	const slug = campaign.archiveSlug || slugify(withoutMergeTags(campaign.subject), 80);
	return slug ? getArchiveUrls(newsletter).absolutePost(slug) : null;
}

// With a messageId, opens and clicks are tracked; the unsubscribe, confirmation and keep links go in
// afterwards, untouched. Every link is on the newsletter's host (lib/archive-hosts.js). The contact's first name and
// field values go in last (lib/merge-tags.js), so nothing in them is read as a link placeholder. contactFields: the
// account's fields, whose tags print the contact's values. reader: whose sections the email has (lib/sections.js), the
// contact's tags and segments, or EVERY_READER for all of them; without one, only those for everyone. An issue's author
// (campaign.author, lib/authors.js) gets the replies, and its byline when they show in emails.
export function buildRecipientEmail({ campaign, newsletter, contact, contactFields = [], messageId, sender, confirmUrl = "", keepUrl = "", reader }) {
	const baseUrl = getLinkBaseUrl(newsletter);
	const { pageUrl, headers } = getUnsubscribeLinks({ contactId: contact._id, newsletterId: newsletter._id }, baseUrl);
	const rendered = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.format === "rich" ? forEmail(campaign.html, reader) : campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter: { ...newsletter, postalAddress: getPostalAddress(newsletter, siteExtensions.defaultPostalAddress) },
		webUrl: getIssueWebUrl({ campaign, newsletter }),
		fontBaseUrl: getAppUrl(),
		author: getAuthorByline(campaign.author, "email"),
	});
	const tracked = messageId ? addTracking(rendered.html, { baseUrl, messageId }) : rendered.html;
	const fillLinks = (body) =>
		body
			.replaceAll(UNSUBSCRIBE_PLACEHOLDER, pageUrl)
			.replaceAll(CONFIRM_URL_PLACEHOLDER, confirmUrl)
			.replaceAll(KEEP_URL_PLACEHOLDER, keepUrl);
	const { subject, html, text } = fillForReader(
		{ subject: campaign.subject, html: fillLinks(tracked), text: fillLinks(rendered.text) },
		contact,
		contactFields
	);
	return {
		from: formatFromAddress(newsletter),
		to: contact.email,
		replyTo: campaign.author?.email || campaign.replyTo || sender?.replyTo || newsletter.replyTo || undefined,
		subject,
		html,
		text,
		headers,
		unsubscribeUrl: pageUrl,
		bytes: new TextEncoder().encode(html).length,
	};
}

// sender: what lib/sender.js says about the newsletter's from address, for the account sending it.
export function getSendProblem({ campaign, newsletter, sender }) {
	if (!newsletter) return "Newsletter not found";
	if (!newsletter.fromEmail) return "Add a from email to the newsletter";
	if (sender?.problem) return sender.problem;
	if (!getPostalAddress(newsletter, siteExtensions.defaultPostalAddress)) return "Add a postal address to the newsletter";
	if (!campaign?.subject?.trim()) return "Add a subject";
	const contentProblem = getContentProblem(campaign);
	if (contentProblem) return contentProblem;

	// Its biggest email: every section in.
	const { bytes } = buildRecipientEmail({
		campaign,
		newsletter,
		contact: { _id: TEST_CONTACT_ID, email: newsletter.fromEmail },
		messageId: TEST_CONTACT_ID,
		reader: EVERY_READER,
	});
	if (bytes > LIMITS.maxEmailBytes) {
		return `The email is ${Math.ceil(bytes / 1000)} KB. Gmail clips emails over 100 KB.`;
	}
	return null;
}

// Web only: what its page needs. No email goes out, so the from address, the postal address and the email's size don't
// matter, but the website has to be on.
export function getPublishProblem({ campaign, newsletter }) {
	if (!newsletter) return "Newsletter not found";
	if (!newsletter.archiveEnabled) return "Turn on the newsletter's website to publish on it";
	if (!campaign?.subject?.trim()) return "Add a subject";
	return getContentProblem(campaign);
}

// Words or a picture, and buttons readers can use. An HTML email designed elsewhere has no buttons of ours.
function getContentProblem(campaign) {
	const body = campaign.format === "markdown" ? campaign.markdown : campaign.html;
	if (!hasContent(body)) return "Add content";
	return campaign.format === "html" ? null : findButtonProblem(body);
}

// Sending in steps: the next step reaches the most engaged contacts up to this many in total. Without
// a number it goes to everyone left.
export function getNextStepLimit({ sentSoFar, additional }) {
	const more = Number(additional);
	return Number.isInteger(more) && more > 0 ? sentSoFar + more : undefined;
}

// A campaign counts its last-chance emails apart, so open and click rates stay the issue's own.
export function getCampaignStatsPath(kind) {
	return kind === "last-chance" ? "lastChance" : "stats";
}

function sumCampaignRates(stats, lastChance) {
	const total = (key) => (stats?.[key] ?? 0) + (lastChance?.[key] ?? 0);
	return { sent: total("sent"), bounced: total("bounced"), complained: total("complained"), refused: total("refused") };
}

// What the owner of a send paused over its rates looks at before resuming it.
const PAUSE_CHECKS = {
	bounce: "Check where these contacts came from",
	complaint: "Check that these contacts asked for your emails",
	refusal: "Gmail refuses emails it reads as unsolicited: check that these contacts asked for your emails",
};

// A send's own rates (lib/rate-levels.js). Last-chance emails go to the least engaged addresses, so their bounces,
// complaints and refusals count too. block: the whole account stops (lib/account-blocks.js), reason is what its owner
// reads. pause: the campaign pauses with reason, and its owner can resume it. metric: the one over its level.
export function getCampaignRateProblem(stats = {}, lastChance = {}) {
	const judged = judgeRates(sumCampaignRates(stats, lastChance));
	if (!judged) return null;
	const { level, metric } = judged;
	if (level === "block") return { level, metric, reason: describeRate(judged, "on a campaign") };
	const blockLevel = describeBlockLevel(metric);
	return {
		level,
		metric,
		reason: `${describeRate(judged, "on this campaign")}. ${PAUSE_CHECKS[metric]} before you resume${blockLevel ? `: at ${blockLevel}, the account is blocked` : ""}.`,
	};
}

// The account as a whole, over its last days of sends: block stops it like a campaign's would; pause only warns
// its owner, since no one campaign is at fault.
export const ACCOUNT_CHECK_DAYS = 7;
const LAST_DAYS = `over the last ${ACCOUNT_CHECK_DAYS} days`;

// The sends the account check adds up: the last ACCOUNT_CHECK_DAYS, or the ones since an admin last unblocked it, whose
// unblock settled the emails before it. where: how the check's reason says it.
export function getAccountCheckWindow(now, unblockedAt) {
	const weekAgo = new Date(now.getTime() - ACCOUNT_CHECK_DAYS * 24 * 60 * 60 * 1000);
	if (unblockedAt && unblockedAt > weekAgo) return { since: new Date(unblockedAt), where: "since the account was unblocked" };
	return { since: weekAgo, where: LAST_DAYS };
}

export function getAccountRateProblem(counts = {}, where = LAST_DAYS) {
	const judged = judgeRates(counts);
	if (!judged) return null;
	const reason = describeRate(judged, where);
	if (judged.level === "block") return { level: "block", reason };
	return {
		level: "pause",
		reason: `${reason}. Nothing is paused, but at ${describeBlockLevel(judged.metric)} the account is blocked: check where your recent contacts came from.`,
	};
}

const OUTCOME_ACTIONS = {
	[SEND_OUTCOMES.throttled]: "retry",
	[SEND_OUTCOMES.unavailable]: "retry",
	[SEND_OUTCOMES.suppressed]: "suppress",
	[SEND_OUTCOMES.domainUnverified]: "pause",
	[SEND_OUTCOMES.tenantPaused]: "pause",
	[SEND_OUTCOMES.approvalPending]: "pause",
	[SEND_OUTCOMES.misconfigured]: "pause",
	[SEND_OUTCOMES.credentialRefused]: "retry",
	[SEND_OUTCOMES.failed]: "fail",
};

// Provider errors carry an outcome (lib/email-provider/outcomes.js); SES errors keep their AWS names.
export function getSendErrorAction(error) {
	if (error?.outcome) return OUTCOME_ACTIONS[error.outcome] ?? "fail";
	const name = error?.name;
	const message = String(error?.message ?? "");
	if (RETRY_ERRORS.has(name) || message.startsWith("Sending is off")) return "retry";
	if (PAUSE_ERRORS.has(name)) return "pause";
	if (name === "MessageRejected" && /not verified/i.test(message)) return "pause";
	return "fail";
}

// The provider refusing one customer's own emails: it suspended or holds the domain they send from, or paused their
// sending space, and nothing on their dashboard lifts it. A hold on the whole sending space blocks the account
// instead (lib/tenant-events.js), and MailCheap's own setup alerts as send-refused.
const CUSTOMER_REFUSALS = new Set([SEND_OUTCOMES.domainUnverified, SEND_OUTCOMES.tenantPaused]);
const CUSTOMER_REFUSAL_ERRORS = new Set(["SendingPausedException", "MailFromDomainNotVerifiedException"]);
const REFUSAL_CODE = /\b(domain_suspended|domain_unverified|dbl_listed|tenant_suspended|operator_hold|sending disabled|unverified domain|not aligned)\b/i;
const PROVIDER_CODE = /^[a-z_]{1,40}$/;

export function isCustomerRefusal(error) {
	if (error?.hold) return false;
	return error?.outcome ? CUSTOMER_REFUSALS.has(error.outcome) : CUSTOMER_REFUSAL_ERRORS.has(error?.name);
}

// A provider pause no owner lifts from their dashboard: its refusal or MailCheap's own setup. Their own login refused
// goes again on a resume, and a from address MailCheap's check refuses (lib/sender.js) is theirs to fix.
export function isPauseForAdmins(error) {
	return error?.outcome !== SEND_OUTCOMES.credentialRefused && error?.name !== "SenderNotAllowed";
}

// The provider's own word for a refusal and nothing else from its answer, which can quote a reader's address.
export function getRefusalCode(error) {
	const code = PROVIDER_CODE.test(error?.providerCode ?? "") ? error.providerCode : null;
	const quoted = REFUSAL_CODE.exec(`${error?.detail ?? ""} ${error?.message ?? ""}`)?.[1];
	return code || quoted?.toLowerCase() || error?.outcome || error?.name || "refused";
}
