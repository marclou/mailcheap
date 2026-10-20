import { LIMITS } from "./config.js";
import { findBrokenMergeTags, withMergeFallbacks } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, hasContent } from "./render-email.js";

export function getPresendChecks({
	campaign,
	newsletter,
	rendered,
	senderProblem = null,
	isSendingEnabled,
	planProblem = null,
}) {
	const subject = campaign.subject?.trim() ?? "";
	// What inboxes show for a reader without a first name, rather than the tag's own length.
	const subjectLength = withMergeFallbacks(subject).length;
	const brokenTags = findBrokenMergeTags(campaign.subject, campaign.previewText, campaign.body);

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
						message: `${brokenTags[0]} goes out as written: only {{first_name}} is filled in`,
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
		},
		{ id: "test", label: "Test sent", isOk: Boolean(campaign.testSentAt), isWarning: true },
		// isAccount: about the account rather than the email, so the editor shows it above its steps, not in the checklist.
		{ id: "plan", label: "Within plan limits", isOk: !planProblem, message: planProblem, isAccount: true },
		{ id: "sending", label: "Sending on", isOk: isSendingEnabled, message: "Sending is off", isAccount: true },
	];

	return {
		checks,
		blocking: checks.filter(({ isOk, isWarning }) => !isOk && !isWarning),
	};
}
