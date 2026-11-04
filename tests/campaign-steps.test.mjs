import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMPAIGN_STEPS, getCheckFix, getSendProblems } from "../lib/campaign-steps.js";
import { getPresendChecks } from "../lib/presend-checks.js";

const READY = {
	hasPlan: true,
	choice: "now",
	blocking: [],
	scheduleProblem: null,
	sendEmails: 240,
	scheduleRecipients: 240,
	emailsLeft: null,
};
const NO_SUBJECT = { id: "subject", message: "Add a subject", fix: { label: "Edit subject", field: "subject" } };

function messages(problems) {
	return problems.map(({ message }) => message);
}

test("the editor goes write, review, send", () => {
	assert.deepEqual(
		CAMPAIGN_STEPS.map(({ label }) => label),
		["Write", "Review", "Send"]
	);
});

test("every check that can fail says how to fix it, except the server's own sending switch", () => {
	const { checks } = getPresendChecks({
		campaign: { subject: "", previewText: "", body: "" },
		newsletter: {},
		rendered: { html: "", bytes: 200_000 },
		senderProblem: "Add a from email to the newsletter",
		isSendingEnabled: false,
		planProblem: "This month's emails are used up",
	});
	const fixes = Object.fromEntries(checks.map((check) => [check.id, getCheckFix(check, { newsletterId: "n1" })]));

	assert.deepEqual(fixes.subject, { label: "Edit subject", field: "subject" });
	assert.equal(fixes.preview.field, "previewText");
	assert.equal(fixes.content.field, "body");
	assert.equal(fixes.unsubscribe.field, "body");
	assert.equal(fixes.size.field, "body");
	assert.deepEqual(fixes.address, { label: "Add a postal address", href: "/newsletters/sender#postal-address" });
	assert.equal(fixes.domain.href, "/newsletters/n1?next=%2Fnewsletters%2Fsender", "the campaign's newsletter opens first");
	assert.equal(fixes.test.action, "test");
	assert.equal(fixes.plan.href, "/billing");
	assert.equal(fixes.sending, null);
	// Warnings have no message, so each one comes with a hint instead.
	for (const check of checks.filter(({ isWarning }) => isWarning)) assert.ok(fixes[check.id].hint, check.id);
});

test("the checklist asks for an author until the issue has one, as a check that holds the send", () => {
	const input = { newsletter: {}, rendered: { html: "", bytes: 1_000 }, isSendingEnabled: true };
	const authorCheck = (campaign) =>
		getPresendChecks({ ...input, campaign: { subject: "Hi", body: "<p>Hello</p>", ...campaign } }).checks.find(({ id }) => id === "author");

	const missing = authorCheck({});
	assert.deepEqual(missing, { id: "author", label: "Author", isOk: false, message: "Choose an author for this issue" });
	assert.deepEqual(getCheckFix(missing, { newsletterId: "n1" }), { label: "Choose an author", field: "author" });
	assert.equal(authorCheck({ authorId: "a1" }).isOk, true);
});

test("the checklist is about the email: the plan and the sending switch are the account's", () => {
	const { checks } = getPresendChecks({
		campaign: { subject: "Hi", previewText: "", body: "<p>Hello</p>" },
		newsletter: { postalAddress: "1 Main St" },
		rendered: { html: "", bytes: 1_000 },
		isSendingEnabled: true,
	});

	assert.deepEqual(
		checks.filter(({ isAccount }) => isAccount).map(({ id }) => id),
		["plan", "sending"]
	);
});

test("sending now stops on a failing check, nobody to send to, or the plan's emails", () => {
	assert.deepEqual(getSendProblems(READY), []);
	assert.deepEqual(getSendProblems({ ...READY, blocking: [NO_SUBJECT] }), [NO_SUBJECT], "with its fix");
	assert.deepEqual(messages(getSendProblems({ ...READY, sendEmails: 0 })), ["No contacts to send to"]);
	const [overPlan] = getSendProblems({ ...READY, emailsLeft: 100 });
	assert.equal(overPlan.message, "Your plan has 100 emails left this month");
	assert.equal(overPlan.fix.href, "/billing");
	assert.equal(overPlan.isAccount, true, "above the send step with the account's problems, not only when the button is pressed");
	assert.deepEqual(getSendProblems({ ...READY, emailsLeft: 240 }), []);
});

test("with none of the plan's emails left, the plan's own check is the one problem", () => {
	const usedUp = { id: "plan", message: "This month's emails are used up", isAccount: true };
	assert.deepEqual(messages(getSendProblems({ ...READY, blocking: [usedUp], emailsLeft: 0 })), ["This month's emails are used up"]);
	assert.deepEqual(
		messages(getSendProblems({ ...READY, blocking: [{ ...usedUp, message: "Over your plan's subscriber limit" }], emailsLeft: 10 })),
		["Over your plan's subscriber limit", "Your plan has 10 emails left this month"],
		"some left: both show"
	);
	assert.deepEqual(messages(getSendProblems({ ...READY, emailsLeft: 0 })), ["Your plan has 0 emails left this month"], "without the check, it still stops");
});

test("every problem shows at once, the checks' first", () => {
	const uploading = { id: "uploading", message: "Wait for images to finish uploading" };
	assert.deepEqual(messages(getSendProblems({ ...READY, blocking: [uploading, NO_SUBJECT], sendEmails: 0 })), [
		"Wait for images to finish uploading",
		"Add a subject",
		"No contacts to send to",
	]);
});

test("scheduling stops on a failing check, a time that can't be, or nobody to send to", () => {
	const later = { ...READY, choice: "later" };
	assert.deepEqual(getSendProblems(later), []);
	assert.deepEqual(messages(getSendProblems({ ...later, scheduleProblem: "Pick a time in the future" })), ["Pick a time in the future"]);
	assert.deepEqual(messages(getSendProblems({ ...later, scheduleRecipients: 0 })), ["No contacts to send to"]);
	assert.deepEqual(getSendProblems({ ...later, blocking: [NO_SUBJECT] }), [NO_SUBJECT]);
	assert.deepEqual(getSendProblems({ ...later, emailsLeft: 10 }), [], "the plan's emails are checked when it goes out");
});

test("without a plan, Send now and Schedule open the paywall instead of waiting on the checks", () => {
	for (const choice of ["now", "later"]) {
		assert.deepEqual(getSendProblems({ ...READY, hasPlan: false, choice, blocking: [NO_SUBJECT], sendEmails: 0, scheduleRecipients: 0 }), []);
	}
});
