import { siteExtensions } from "@/lib/site-extensions";
import { getArchiveUrls, getLinkBaseUrl } from "./archive-hosts.js";
import { LIMITS, getAppUrl } from "./config.js";
import { CONFIRM_URL_PLACEHOLDER } from "./confirmation-content.js";
import { SEND_OUTCOMES } from "./email-provider/outcomes.js";
import { KEEP_URL_PLACEHOLDER } from "./last-chance-content.js";
import { fillMergeTags, fillSubject, withMergeFallbacks } from "./merge-tags.js";
import { getPostalAddress } from "./postal-address.js";
import { describeBlockLevel, describeRate, judgeRates } from "./rate-levels.js";
import { UNSUBSCRIBE_PLACEHOLDER, hasContent, renderEmail } from "./render-email.js";
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
	const { enabled, subject, previewText, markdown } = newsletter?.welcome ?? {};
	if (!enabled || !subject?.trim() || !markdown?.trim()) return null;
	return { format: "markdown", subject: subject.trim(), markdown, previewText: previewText?.trim() ?? "" };
}

// Issues link to their archive page. A draft has no slug yet, so its test email links to the one
// the subject gives when it goes out. Welcome emails aren't issues and have no page.
export function getIssueWebUrl({ campaign, newsletter }) {
	if (!newsletter?.archiveEnabled || !newsletter.slug || !campaign?._id || campaign.archiveListed === false) return null;
	const slug = campaign.archiveSlug || slugify(withMergeFallbacks(campaign.subject), 80);
	return slug ? getArchiveUrls(newsletter).absolutePost(slug) : null;
}

// With a messageId, opens and clicks are tracked; the unsubscribe, confirmation and keep links go in
// afterwards, untouched. Every link is on the newsletter's host (lib/archive-hosts.js). The contact's first name goes
// in last (lib/merge-tags.js), so nothing in it is read as a link placeholder.
export function buildRecipientEmail({ campaign, newsletter, contact, messageId, sender, confirmUrl = "", keepUrl = "" }) {
	const baseUrl = getLinkBaseUrl(newsletter);
	const { pageUrl, headers } = getUnsubscribeLinks({ contactId: contact._id, newsletterId: newsletter._id }, baseUrl);
	const rendered = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter: { ...newsletter, postalAddress: getPostalAddress(newsletter, siteExtensions.defaultPostalAddress) },
		webUrl: getIssueWebUrl({ campaign, newsletter }),
		fontBaseUrl: getAppUrl(),
	});
	const tracked = messageId ? addTracking(rendered.html, { baseUrl, messageId }) : rendered.html;
	const fillLinks = (body) =>
		body
			.replaceAll(UNSUBSCRIBE_PLACEHOLDER, pageUrl)
			.replaceAll(CONFIRM_URL_PLACEHOLDER, confirmUrl)
			.replaceAll(KEEP_URL_PLACEHOLDER, keepUrl);
	const { firstName } = contact;
	const html = fillMergeTags(fillLinks(tracked), { firstName, isHtml: true });
	return {
		from: formatFromAddress(newsletter),
		to: contact.email,
		replyTo: campaign.replyTo || sender?.replyTo || newsletter.replyTo || undefined,
		subject: fillSubject(campaign.subject, firstName),
		html,
		text: fillMergeTags(fillLinks(rendered.text), { firstName }),
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
	if (!hasContent(campaign.format === "markdown" ? campaign.markdown : campaign.html)) return "Add content";

	const { bytes } = buildRecipientEmail({
		campaign,
		newsletter,
		contact: { _id: TEST_CONTACT_ID, email: newsletter.fromEmail },
		messageId: TEST_CONTACT_ID,
	});
	if (bytes > LIMITS.maxEmailBytes) {
		return `The email is ${Math.ceil(bytes / 1000)} KB. Gmail clips emails over 100 KB.`;
	}
	return null;
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
	return { sent: total("sent"), bounced: total("bounced"), complained: total("complained") };
}

// A send's own rates (lib/rate-levels.js). Last-chance emails go to the least engaged addresses, so their bounces
// and complaints count too. block: the whole account stops (lib/account-blocks.js), reason is what its owner reads.
// pause: the campaign pauses with reason, and its owner can resume it.
export function getCampaignRateProblem(stats = {}, lastChance = {}) {
	const judged = judgeRates(sumCampaignRates(stats, lastChance));
	if (!judged) return null;
	if (judged.level === "block") return { level: "block", reason: describeRate(judged, "on a campaign") };
	const check = judged.metric === "bounce" ? "Check where these contacts came from" : "Check that these contacts asked for your emails";
	return {
		level: "pause",
		reason: `${describeRate(judged, "on this campaign")}. ${check} before you resume: at ${describeBlockLevel(judged.metric)}, the account is blocked.`,
	};
}

// The account as a whole, over its last days of sends: block stops it like a campaign's would; pause only warns
// its owner, since no one campaign is at fault.
export const ACCOUNT_CHECK_DAYS = 7;

export function getAccountRateProblem(counts = {}) {
	const judged = judgeRates(counts);
	if (!judged) return null;
	const reason = describeRate(judged, `over the last ${ACCOUNT_CHECK_DAYS} days`);
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
