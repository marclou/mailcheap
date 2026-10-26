import { LIMITS } from "./config.js";
import { findBrokenMergeTags, withMergeFallbacks } from "./merge-tags.js";
import { sendsEmail } from "./publish-to.js";
import { UNSUBSCRIBE_PLACEHOLDER, findButtonProblem, hasContent } from "./render-email.js";

// The email's checks, or for a web-only issue (campaign.publishTo, lib/publish-to.js) what its page needs: no email goes
// out, so the sender, footer, size, test email and plan emails don't matter, but the website has to be on.
const WEB_ONLY_SKIPPED = new Set(["unsubscribe", "size", "address", "domain", "test", "plan", "sending"]);

// contactFields: the account's fields, whose tags are filled in like {{first_name}}.
export function getPresendChecks({
	campaign,
	newsletter,
	rendered,
	contactFields = [],
	senderProblem = null,
	isSharedSender = false,
	isSendingEnabled,
	planProblem = null,
	isSmsConfigured = true,
}) {
	if (campaign?.channel === "sms") {
		return withBlocking(getSmsChecks({ campaign, isSendingEnabled, isSmsConfigured }));
	}
	const checks = getEmailChecks({ campaign, newsletter, rendered, contactFields, senderProblem, isSharedSender, isSendingEnabled, planProblem });
	if (sendsEmail(campaign)) return withBlocking(checks);
	return withBlocking([
		...checks.filter(({ id }) => !WEB_ONLY_SKIPPED.has(id)),
		{ id: "website", label: "Website on", isOk: Boolean(newsletter.archiveEnabled), message: "Turn on your website to publish on it" },
	]);
}

function withBlocking(checks) {
	return { checks, blocking: checks.filter(({ isOk, isWarning }) => !isOk && !isWarning) };
}

function getEmailChecks({ campaign, newsletter, rendered, contactFields, senderProblem, isSharedSender, isSendingEnabled, planProblem }) {
	const subject = campaign.subject?.trim() ?? "";
	// What inboxes show for a reader without a first name or field values, rather than the tags' own length.
	const subjectLength = withMergeFallbacks(subject, { contactFields }).length;
	const brokenTags = findBrokenMergeTags([campaign.subject, campaign.previewText, campaign.body], contactFields);
	// The editor's HTML, Markdown drafts included; an HTML email designed elsewhere has no buttons of ours.
	const buttonProblem = campaign.format === "html" ? null : findButtonProblem(campaign.body);

	const checks = [
		{ id: "subject", label: "Subject", isOk: subject.length > 0, message: "Add a subject" },
		{
			id: "subject-length",
			label: "Subject under 70 characters",
			isOk: subjectLength <= 70,
			isWarning: true,
			detail: subjectLength ? String(subjectLength) : null,
		},
		...(brokenTags.length > 0
			? [
					{
						id: "merge-tags",
						label: "Merge tags",
						isOk: false,
						isWarning: true,
						message: `${brokenTags[0]} goes out as written: only {{first_name}} and your contact fields are filled in`,
					},
				]
			: []),
		{
			id: "preview",
			label: "Preview text",
			isOk: Boolean(campaign.previewText?.trim()),
			isWarning: true,
		},
		{ id: "content", label: "Content", isOk: hasContent(campaign.body), message: "Add content" },
		...(buttonProblem ? [{ id: "buttons", label: "Buttons", isOk: false, message: buttonProblem }] : []),
		{
			id: "unsubscribe",
			label: "Unsubscribe link",
			isOk: rendered.html.includes(UNSUBSCRIBE_PLACEHOLDER),
			message: `Add ${UNSUBSCRIBE_PLACEHOLDER} to the HTML`,
		},
		{
			id: "size",
			label: "Under 100 KB",
			isOk: rendered.bytes <= LIMITS.maxEmailBytes,
			detail: `${Math.ceil(rendered.bytes / 1000)} KB`,
			message: "Gmail clips emails over 100 KB",
		},
		{
			id: "address",
			label: "Postal address",
			isOk: Boolean(newsletter.postalAddress?.trim()),
			message: "Add a postal address to the newsletter",
		},
		{
			id: "domain",
			label: "From address allowed",
			isOk: !senderProblem,
			message: senderProblem,
			detail: isSharedSender ? "Shared address" : null,
		},
		{ id: "test", label: "Test sent", isOk: Boolean(campaign.testSentAt), isWarning: true },
		// isAccount: about the account rather than the email, so the editor shows it above its steps, not in the checklist.
		{ id: "plan", label: "Within plan limits", isOk: !planProblem, message: planProblem, isAccount: true },
		{ id: "sending", label: "Sending on", isOk: isSendingEnabled, message: "Sending is off", isAccount: true },
	];

	return checks;
}


function getSmsChecks({ campaign, isSendingEnabled, isSmsConfigured }) {
	const text = (campaign.smsText ?? "").trim();
	const hasOptOut = /\b(stop|arret)\b/i.test(text);
	return [
		{ id: "sms-body", label: "Message text", isOk: text.length > 0, message: "Write an SMS message body" },
		{
			id: "sms-opt-out",
			label: "Opt-out instruction",
			isOk: hasOptOut,
			isWarning: true,
			detail: hasOptOut ? "STOP instruction included" : "Missing 'STOP' or opt-out instruction",
			hint: "Include 'STOP' to let recipients unsubscribe",
		},
		{
			id: "sms-length",
			label: "Message length",
			isOk: text.length <= 1600,
			message: "Message exceeds maximum 1600 characters",
		},
		{
			id: "sms-provider",
			label: "SMS service configured",
			isOk: Boolean(isSmsConfigured),
			isAccountLevel: true,
			message: "AWS SNS credentials are required to send SMS",
		},
		{
			id: "sending",
			label: "Sending switch on",
			isOk: Boolean(isSendingEnabled),
			isAccountLevel: true,
			message: "Set SENDING_ENABLED=true in the server's environment",
		},
	];
}