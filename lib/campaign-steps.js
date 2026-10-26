import { formatCount } from "./format.js";
import { getFieldPath, getSectionPath } from "./newsletter-sections.js";
import { getNewsletterPagePath } from "./newsletters.js";

// The campaign editor's steps (FormCampaign): write the issue, review it, send it.
export const CAMPAIGN_STEPS = [
	{ id: "write", label: "Write" },
	{ id: "review", label: "Review" },
	{ id: "send", label: "Send" },
];

// What the review step offers for a check that needs a look (lib/presend-checks.js): a field of the draft, a settings
// page or the test email. Warnings have no message of their own, so they get a hint. A settings field (FormNewsletter's
// id) opens its section's page scrolled to it and focused.
const FIXES = {
	subject: { label: "Edit subject", field: "subject" },
	"subject-length": { label: "Edit subject", field: "subject", hint: "Inboxes cut longer subjects off" },
	preview: { label: "Add preview text", field: "previewText", hint: "Inboxes show it after the subject" },
	content: { label: "Edit content", field: "body" },
	buttons: { label: "Edit content", field: "body" },
	"merge-tags": { label: "Edit content", field: "body" },
	unsubscribe: { label: "Edit HTML", field: "body" },
	size: { label: "Edit content", field: "body" },
	address: { label: "Add a postal address", settings: "sender", field: "postal-address" },
	domain: { label: "Open sender settings", settings: "sender" },
	test: { label: "Send a test", action: "test", hint: "See it in a real inbox before your readers do" },
	plan: { label: "See plans", href: "/billing" },
	website: { label: "Open website settings", settings: "website" },
	"sms-body": { label: "Edit message", field: "smsText" },
	"sms-opt-out": { label: "Add STOP instruction", field: "smsText", hint: "Telecom carriers require an opt-out mention" },
	"sms-length": { label: "Shorten message", field: "smsText" },
	"sms-provider": { label: "Configure AWS SNS", href: "/settings" },
};

export function getCheckFix(check, { newsletterId }) {
	const fix = FIXES[check.id];
	if (!fix?.settings) return fix ?? null;
	const { settings, field, ...rest } = fix;
	// The editor opened its newsletter already, and /newsletters/<id>'s redirect would drop the #.
	return { ...rest, href: field ? getFieldPath(field) : getNewsletterPagePath(newsletterId, getSectionPath(settings)) };
}

// A tip's fix (get_campaign_tips): the field its words are in, and the words.
const TIP_FIXES = { subject: FIXES.subject, previewText: { label: "Edit preview text", field: "previewText" }, content: FIXES.content };

export function getTipFix(tip) {
	return { ...(TIP_FIXES[tip.field] ?? FIXES.content), words: tip.quote };
}

// What stops the send step's button, shown when it's pressed: blocking, the failing checks with their fixes, then what
// the send itself needs. Without a plan the button opens the paywall instead, so nothing stops it. A schedule's emails
// are counted against the plan when it goes out. A web-only issue has no recipients or emails to count.
export function getSendProblems({ hasPlan, choice, blocking, scheduleProblem, sendEmails, scheduleRecipients, emailsLeft, isWebOnly = false }) {
	if (!hasPlan) return [];
	const problems = [...blocking];
	if (choice === "later" && scheduleProblem) problems.push({ id: "time", message: scheduleProblem });
	if (isWebOnly) return problems;
	if (choice === "later") {
		if (scheduleRecipients === 0) problems.push(NO_RECIPIENTS);
		return problems;
	}
	// With none left, the plan's own check says so already.
	const isUsedUp = emailsLeft === 0 && blocking.some(({ id }) => id === "plan");
	if (sendEmails === 0) problems.push(NO_RECIPIENTS);
	else if (emailsLeft !== null && sendEmails > emailsLeft && !isUsedUp) problems.push(getEmailsLeftProblem(emailsLeft));
	return problems;
}

// A send bigger than what the plan has left this month. isAccount: the plan's, like its own check, so the editor shows
// it above the send step too.
export function getEmailsLeftProblem(emailsLeft) {
	return { id: "emails-left", message: `Your plan has ${formatCount(emailsLeft, "email")} left this month`, fix: FIXES.plan, isAccount: true };
}

const NO_RECIPIENTS = { id: "recipients", message: "No contacts to send to" };
