import { LIMITS } from "./config.js";
import { UNSUBSCRIBE_PLACEHOLDER, hasContent } from "./render-email.js";

export function getPresendChecks({
	campaign,
	newsletter,
	rendered,
	isDomainVerified,
	isSendingEnabled,
	providerLabel = "SES",
}) {
	const subject = campaign.subject?.trim() ?? "";

	const checks = [
		{ id: "subject", label: "Subject", isOk: subject.length > 0, message: "Add a subject" },
		{
			id: "subject-length",
			label: "Subject under 70 characters",
			isOk: subject.length <= 70,
			isWarning: true,
			detail: subject.length ? String(subject.length) : null,
		},
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
			label: "Domain verified",
			isOk: isDomainVerified,
			message: `Verify the sending domain in ${providerLabel}`,
		},
		{ id: "test", label: "Test sent", isOk: Boolean(campaign.testSentAt), isWarning: true },
		{ id: "sending", label: "Sending on", isOk: isSendingEnabled, message: "Sending is off" },
	];

	return {
		checks,
		blocking: checks.filter(({ isOk, isWarning }) => !isOk && !isWarning),
	};
}
