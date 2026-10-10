import { getArchiveUrls } from "./archive-hosts.js";
import { LIMITS, getAppUrl } from "./config.js";
import { CONFIRM_URL_PLACEHOLDER } from "./confirmation-content.js";
import { KEEP_URL_PLACEHOLDER } from "./last-chance-content.js";
import { UNSUBSCRIBE_PLACEHOLDER, hasContent, renderEmail } from "./render-email.js";
import { slugify } from "./slug.js";
import { addTracking } from "./tracking.js";
import { getUnsubscribeLinks } from "./unsubscribe.js";

export const SEND_BATCH_SIZE = 50;
export const MAX_BATCH_MESSAGES = 100;
export const MIN_SENT_BEFORE_PAUSE = 100;
export const MAX_CONSECUTIVE_FAILURES = 5;
// Test emails have no contact: their unsubscribe link is valid but matches nobody.
export const TEST_CONTACT_ID = "000000000000000000000000";
// A send's own messages: the issue, and last-chance emails for cold contacts (lib/cleanup.js).
export const CAMPAIGN_MESSAGE_KINDS = ["campaign", "last-chance"];

// SES exception names, then Resend error names (resend.com/docs/api-reference/errors).
const RETRY_ERRORS = new Set([
	"TooManyRequestsException",
	"ThrottlingException",
	"Throttling",
	"rate_limit_exceeded",
	"concurrent_idempotent_requests",
	"application_error",
	"service_unavailable",
]);
// These fail every following send too, so the campaign pauses until the account is fixed.
const PAUSE_ERRORS = new Set([
	"AccountSuspendedException",
	"SendingPausedException",
	"MailFromDomainNotVerifiedException",
	"LimitExceededException",
	"NotFoundException",
	"daily_quota_exceeded",
	"monthly_quota_exceeded",
	"missing_api_key",
	"invalid_api_key",
	"restricted_api_key",
	"suspended_api_key",
]);
// Resend's 403s for an unverified from domain, or a sandbox account sending beyond its own address.
const RESEND_DOMAIN_PROBLEM = /domain is not verified|verify a domain|only send testing emails/i;

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

// Gmail Postmaster Tools reports spam rates per field; the last field identifies the sender.
export function getFeedbackId({ campaignId, kind, newsletterSlug }) {
	return [campaignId ?? kind, newsletterSlug, kind, "mailcheap"]
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
	const slug = campaign.archiveSlug || slugify(campaign.subject, 80);
	return slug ? getArchiveUrls(newsletter).absolutePost(slug) : null;
}

// With a messageId, opens and clicks are tracked; the unsubscribe, confirmation and keep links go in
// afterwards, untouched.
export function buildRecipientEmail({ campaign, newsletter, contact, messageId, confirmUrl = "", keepUrl = "" }) {
	const { pageUrl, headers } = getUnsubscribeLinks({
		contactId: contact._id,
		newsletterId: newsletter._id,
	});
	const rendered = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter,
		webUrl: getIssueWebUrl({ campaign, newsletter }),
	});
	const tracked = messageId ? addTracking(rendered.html, { baseUrl: getAppUrl(), messageId }) : rendered.html;
	const fillLinks = (body) =>
		body
			.replaceAll(UNSUBSCRIBE_PLACEHOLDER, pageUrl)
			.replaceAll(CONFIRM_URL_PLACEHOLDER, confirmUrl)
			.replaceAll(KEEP_URL_PLACEHOLDER, keepUrl);
	const html = fillLinks(tracked);
	return {
		from: formatFromAddress(newsletter),
		to: contact.email,
		replyTo: campaign.replyTo || newsletter.replyTo || undefined,
		subject: campaign.subject,
		html,
		text: fillLinks(rendered.text),
		headers,
		unsubscribeUrl: pageUrl,
		bytes: new TextEncoder().encode(html).length,
	};
}

export function getSendProblem({ campaign, newsletter }) {
	if (!newsletter) return "Newsletter not found";
	if (!newsletter.fromEmail) return "Add a from email to the newsletter";
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

// Rates use sent as the denominator, like SES does for account reviews. Last-chance emails go to the
// least engaged addresses, so their bounces and complaints count toward the limits too.
export function getCampaignPauseReason(stats = {}, lastChance = {}) {
	const total = (key) => (stats?.[key] ?? 0) + (lastChance?.[key] ?? 0);
	const [sent, bounced, complained] = ["sent", "bounced", "complained"].map(total);
	if (sent < MIN_SENT_BEFORE_PAUSE) return null;
	if (bounced / sent > LIMITS.bounceRate) return "bounce rate";
	if (complained / sent > LIMITS.complaintRate) return "complaint rate";
	return null;
}

export function getSendErrorAction(error) {
	const name = error?.name;
	const message = String(error?.message ?? "");
	if (RETRY_ERRORS.has(name) || message.startsWith("Sending is off")) return "retry";
	if (PAUSE_ERRORS.has(name)) return "pause";
	if (name === "MessageRejected" && /not verified/i.test(message)) return "pause";
	if (name === "validation_error" && RESEND_DOMAIN_PROBLEM.test(message)) return "pause";
	return "fail";
}
