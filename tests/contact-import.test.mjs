import assert from "node:assert/strict";
import { test } from "node:test";
import { getContactWrites, getStatusChanges } from "../lib/contact-import.js";

const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";
const subscribedAt = new Date("2026-10-08T09:00:00.000Z");

// Rows as sanitizeImportRow hands them over, one per status a CSV file can map to.
const contacts = [
	{ email: "new@example.com", status: "active", subscribedAt, openRate: 0.5 },
	{ email: "left@example.com", status: "unsubscribed" },
	{ email: "left-too@example.com", status: "unsubscribed" },
	{ email: "bounced@example.com", status: "bounced" },
	{ email: "cold@example.com", status: "dormant", emailsReceived: 9, openRate: 0, clickRate: 0 },
];

test("rows add the contacts a newsletter doesn't have and only make statuses stricter", () => {
	const writes = getContactWrites({ newsletterId, contacts, source: "import" });
	assert.equal(writes.length, contacts.length);
	assert.deepEqual(writes[0], {
		newsletterId,
		email: "new@example.com",
		status: "active",
		source: "import",
		subscribedAt,
		importedOpenRate: 0.5,
	});
	assert.ok(writes[1].unsubscribedAt instanceof Date);
	assert.deepEqual(
		[writes[4].importedEmailsReceived, writes[4].importedOpenRate, writes[4].importedClickRate],
		[9, 0, 0]
	);

	assert.deepEqual(getStatusChanges(contacts), [
		{ status: "unsubscribed", emails: ["left@example.com", "left-too@example.com"], replaces: ["active", "dormant"] },
		{ status: "bounced", emails: ["bounced@example.com"], replaces: ["active", "dormant", "unsubscribed"] },
		{ status: "dormant", emails: ["cold@example.com"], replaces: ["active"] },
	]);
});

test("existing contacts never become active and contacts waiting to confirm stay as they are", () => {
	const writes = getContactWrites({ newsletterId, contacts, source: "import" });
	const updatable = /^imported/;
	for (const write of writes) {
		// Only the imported* columns change on a contact that already exists (lib/contact-import.js keepUnlessGiven).
		assert.ok(Object.keys(write).filter(updatable.test.bind(updatable)).every((key) => write[key] !== undefined));
	}
	for (const { status, replaces } of getStatusChanges(contacts)) {
		assert.notEqual(status, "active");
		assert.equal(replaces.includes("pending"), false);
	}
});
