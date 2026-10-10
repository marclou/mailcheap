import assert from "node:assert/strict";
import { test } from "node:test";
import {
	LAST_CHANCE_DAYS,
	addToPreview,
	emptyPreview,
	getCleanupAction,
	getCleanupSettings,
	getLastSignOfLife,
	splitAudience,
	summarizePreview,
} from "../lib/cleanup.js";
import { withEngagement } from "../lib/engagement.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2027-06-01T12:00:00Z");
const ON = { enabled: true, issues: 6, days: 180 };

function daysAgo(days) {
	return new Date(NOW - days * DAY_MS);
}

function contact(id, fields = {}) {
	return { _id: id, email: `${id}@example.com`, subscribedAt: daysAgo(400), ...fields };
}

test("cleanup is off by default, and saved numbers win over the defaults", () => {
	assert.deepEqual(getCleanupSettings({ slug: "weekly" }), { enabled: false, issues: 6, days: 180 });
	assert.deepEqual(getCleanupSettings({ slug: "weekly", cleanup: { enabled: true, issues: 8, days: 60 } }), {
		enabled: true,
		issues: 8,
		days: 60,
	});
	assert.deepEqual(getCleanupSettings({ slug: "weekly", cleanup: { enabled: "yes", issues: 0, days: null } }), {
		enabled: false,
		issues: 6,
		days: 180,
	});
	assert.deepEqual(getCleanupSettings(null), { enabled: false, issues: 6, days: 180 });
});

test("cold means both: enough ignored issues and an old last sign of life", () => {
	assert.equal(getCleanupAction(contact("a", { ignoredIssues: 6 }), ON, NOW), "lastChance");
	assert.equal(getCleanupAction(contact("b", { ignoredIssues: 5 }), ON, NOW), "issue", "one issue short");
	assert.equal(
		getCleanupAction(contact("c", { ignoredIssues: 40, subscribedAt: daysAgo(179) }), ON, NOW),
		"issue",
		"issues alone never flag anyone"
	);
	assert.equal(
		getCleanupAction(contact("d", { ignoredIssues: 0, subscribedAt: daysAgo(3000) }), ON, NOW),
		"issue",
		"time alone never flags anyone: no sends, no count"
	);
	assert.equal(getCleanupAction(contact("e", { ignoredIssues: 6 }), { ...ON, enabled: false }, NOW), "issue");
	assert.equal(getCleanupAction(contact("f"), ON, NOW), "issue", "no issue counted yet");
});

test("any sign of life counts, and the join date stands in for people who never engaged", () => {
	const cold = { ignoredIssues: 9, subscribedAt: daysAgo(500) };
	for (const field of ["lastOpenAt", "lastClickAt", "lastEngagedAt", "confirmedAt"]) {
		assert.equal(getCleanupAction(contact(field, { ...cold, [field]: daysAgo(30) }), ON, NOW), "issue", field);
		assert.equal(getCleanupAction(contact(field, { ...cold, [field]: daysAgo(200) }), ON, NOW), "lastChance", field);
	}
	assert.equal(getLastSignOfLife({ createdAt: daysAgo(10) }), daysAgo(10).getTime(), "no subscribedAt: createdAt");
	assert.equal(getLastSignOfLife({}), 0);
});

test("after the last-chance email: skip while waiting, dormant at a send 14 or more days later", () => {
	const warned = (days, fields = {}) =>
		contact("w", { ignoredIssues: 6, lastOpenAt: daysAgo(300), lastChanceAt: daysAgo(days), ...fields });
	assert.equal(getCleanupAction(warned(0), ON, NOW), "waiting");
	assert.equal(getCleanupAction(warned(LAST_CHANCE_DAYS - 0.01), ON, NOW), "waiting");
	assert.equal(getCleanupAction(warned(LAST_CHANCE_DAYS), ON, NOW), "dormant");
	assert.equal(getCleanupAction(warned(90), ON, NOW), "dormant");

	// "Yes, keep sending it", a click, an open: the count starts over and they get issues again.
	assert.equal(getCleanupAction(warned(20, { ignoredIssues: 0, lastEngagedAt: daysAgo(19) }), ON, NOW), "issue");
	assert.equal(getCleanupAction(warned(20, { ignoredIssues: 0, lastOpenAt: daysAgo(2) }), ON, NOW), "issue");
	// Months later they can go cold again, and get a new last-chance email.
	assert.equal(
		getCleanupAction(warned(400, { ignoredIssues: 6, lastEngagedAt: daysAgo(390) }), ON, NOW),
		"lastChance"
	);
});

test("signs of life reset the count and move the date forward only", () => {
	const at = new Date("2027-01-01T00:00:00Z");
	const update = withEngagement(undefined, at);
	assert.deepEqual(Object.keys(update), ["ignoredIssues", "lastEngagedAt"]);
	assert.equal(update.ignoredIssues, 0);
	assert.ok(update.lastEngagedAt.queryChunks.some((chunk) => chunk === at), "lastEngagedAt takes the later date");
	assert.equal(withEngagement({ status: "active" }, at).status, "active");
});

// Most engaged first, as the send walks them.
const AUDIENCE = [
	contact("engaged1", { ignoredIssues: 0, lastOpenAt: daysAgo(3) }),
	contact("cold1", { ignoredIssues: 7 }),
	contact("engaged2", { ignoredIssues: 1, lastClickAt: daysAgo(40) }),
	contact("waiting1", { ignoredIssues: 6, lastChanceAt: daysAgo(7) }),
	contact("new1", { ignoredIssues: 0, subscribedAt: daysAgo(2) }),
	contact("expired1", { ignoredIssues: 6, lastChanceAt: daysAgo(15) }),
	contact("cold2", { ignoredIssues: 12 }),
	contact("engaged3", { ignoredIssues: 6, lastOpenAt: daysAgo(100) }),
];

function ids(contacts) {
	return contacts.map(({ _id }) => _id);
}

test("the send-time split: the issue, the last-chance email, waiting and dormant", () => {
	const split = splitAudience(AUDIENCE, { settings: ON, now: NOW });
	assert.deepEqual(ids(split.issue), ["engaged1", "engaged2", "new1", "engaged3"]);
	assert.deepEqual(ids(split.lastChance), ["cold1", "cold2"]);
	assert.deepEqual(ids(split.waiting), ["waiting1"]);
	assert.deepEqual(ids(split.dormant), ["expired1"]);
	assert.equal(split.received, 0);

	const off = splitAudience(AUDIENCE, { settings: { ...ON, enabled: false }, now: NOW });
	assert.deepEqual(ids(off.issue), ids(AUDIENCE), "switched off: everyone gets the issue");
});

test("a limit counts issue recipients only and stops the walk there", () => {
	const split = splitAudience(AUDIENCE, { settings: ON, limit: 2, now: NOW });
	assert.deepEqual(ids(split.issue), ["engaged1", "engaged2"]);
	assert.deepEqual(ids(split.lastChance), ["cold1"], "cold2 sits past the limit, left for a later step");
	assert.deepEqual(ids(split.dormant), []);

	assert.deepEqual(ids(splitAudience(AUDIENCE, { settings: ON, limit: 0, now: NOW }).issue), []);
});

test("a later step skips who already got the issue or the last-chance email, and counts the issue toward the limit", () => {
	const previous = new Map([
		["engaged1", "campaign"],
		["engaged2", "campaign"],
		["cold1", "last-chance"],
	]);
	const split = splitAudience(AUDIENCE, { settings: ON, limit: 3, previous, now: NOW });
	assert.equal(split.received, 2);
	assert.deepEqual(ids(split.issue), ["new1"]);
	assert.deepEqual(ids(split.lastChance), [], "cold1 got it in the first step");
	assert.deepEqual(ids(split.waiting), ["waiting1"]);
});

test("the send dialog's counts match what the send does, at any limit", () => {
	const previous = new Map([["engaged1", "campaign"]]);
	const preview = addToPreview(emptyPreview(), AUDIENCE, { settings: ON, previous, now: NOW });
	for (const limit of [undefined, 1, 2, 3, 4, 5, 50]) {
		const split = splitAudience(AUDIENCE, { settings: ON, limit, previous, now: NOW });
		assert.deepEqual(
			summarizePreview(preview, limit),
			{
				issue: split.issue.length + split.received,
				lastChance: split.lastChance.length,
				waiting: split.waiting.length,
				dormant: split.dormant.length,
			},
			`limit ${limit}`
		);
	}

	// Chunked walks add up to the same preview.
	const chunked = emptyPreview();
	for (let index = 0; index < AUDIENCE.length; index += 3) {
		addToPreview(chunked, AUDIENCE.slice(index, index + 3), { settings: ON, previous, now: NOW });
	}
	assert.deepEqual(chunked, preview);
});

test("signing up again is a sign of life", () => {
	const at = new Date(NOW);
	const update = withEngagement({ status: "active", subscribedAt: at, unsubscribedAt: null }, at);
	assert.equal(update.status, "active");
	assert.equal(update.subscribedAt, at);
	assert.equal(update.unsubscribedAt, null);
	assert.equal(update.ignoredIssues, 0);
});
