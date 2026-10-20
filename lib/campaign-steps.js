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
	"merge-tags": { label: "Edit content", field: "body" },
	unsubscribe: { label: "Edit HTML", field: "body" },
	size: { label: "Edit content", field: "body" },
	address: { label: "Add a postal address", settings: "sender", field: "postal-address" },
	domain: { label: "Open sender settings", settings: "sender" },
	test: { label: "Send a test", action: "test", hint: "See it in a real inbox before your readers do" },
	plan: { label: "See plans", href: "/billing" },
};

export function getCheckFix(check, { newsletterId }) {
	const fix = FIXES[check.id];
	if (!fix?.settings) return fix ?? null;
	const { settings, field, ...rest } = fix;
	// The editor opened its newsletter already, and /newsletters/<id>'s redirect would drop the #.
	return { ...rest, href: field ? getFieldPath(field) : getNewsletterPagePath(newsletterId, getSectionPath(settings)) };
}

// What stops the send step's button, shown when it's pressed: blocking, the failing checks with their fixes, then what
// the send itself needs. Without a plan the button opens the paywall instead, so nothing stops it. A schedule's emails
// are counted against the plan when it goes out.
export function getSendProblems({ hasPlan, choice, blocking, scheduleProblem, sendEmails, scheduleRecipients, emailsLeft }) {
	if (!hasPlan) return [];
	const problems = [...blocking];
	if (choice === "later") {
		if (scheduleProblem) problems.push({ id: "time", message: scheduleProblem });
		if (scheduleRecipients === 0) problems.push(NO_RECIPIENTS);
		return problems;
	}
	if (sendEmails === 0) problems.push(NO_RECIPIENTS);
	else if (emailsLeft !== null && sendEmails > emailsLeft) {
		problems.push({ id: "emails-left", message: `Your plan has ${formatCount(emailsLeft, "email")} left this month`, fix: FIXES.plan });
	}
	return problems;
}

const NO_RECIPIENTS = { id: "recipients", message: "No contacts to send to" };
