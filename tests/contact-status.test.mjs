import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { STATUS_CHANGES, getBulkFromStatuses, getStatusChangeProblem, getStatusChanges, needsConsent } from "../lib/contact-status.js";
import { STATUS_CHANGES_KEPT } from "../lib/status-changes.js";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// Changing a contact's status from its menu, the REST API and MCP: one set of rules, consent to bring back someone who
// unsubscribed or never confirmed, bounces and complaints locked, and every change kept on the contact.
let app;
let m;

test("bounced and complained never change, and unsubscribed only comes back as active", () => {
	assert.deepEqual(getStatusChanges("bounced"), []);
	assert.deepEqual(getStatusChanges("complained"), []);
	assert.deepEqual(getStatusChanges("unsubscribed"), ["active"]);
	assert.deepEqual(getStatusChanges("nope"), []);
	for (const [from, targets] of Object.entries(STATUS_CHANGES)) assert.ok(!targets.includes(from), `${from} doesn't list itself`);
	assert.equal(getStatusChangeProblem({ from: "bounced", to: "active", consent: true }).code, "conflict");
	assert.equal(getStatusChangeProblem({ from: "unsubscribed", to: "dormant", consent: true }).code, "conflict");
	assert.equal(getStatusChangeProblem({ from: "pending", to: "dormant" }).code, "conflict");
});

test("resubscribing and making a pending contact active need consent; the rest don't", () => {
	assert.equal(needsConsent("unsubscribed", "active"), true);
	assert.equal(needsConsent("pending", "active"), true);
	assert.equal(needsConsent("dormant", "active"), false);
	assert.equal(getStatusChangeProblem({ from: "unsubscribed", to: "active" }).code, "validation_failed");
	assert.equal(getStatusChangeProblem({ from: "pending", to: "active", consent: false }).code, "validation_failed");
	assert.equal(getStatusChangeProblem({ from: "unsubscribed", to: "active", consent: true }), null);
	for (const [from, to] of [
		["active", "dormant"],
		["active", "unsubscribed"],
		["dormant", "active"],
		["dormant", "unsubscribed"],
		["pending", "unsubscribed"],
	]) {
		assert.equal(getStatusChangeProblem({ from, to }), null, `${from} to ${to}`);
	}
});

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	const fields = { name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" };
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))));
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

async function importRows(user, rows) {
	const result = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	assert.ok(result.importId, JSON.stringify(result));
}

function findContact(user, email) {
	return m.Contact.findOne({ accountId: user.accountId, newsletterId: user.newsletterId, email }).lean();
}

async function setByHand(user, email, status, consent) {
	const contact = await findContact(user, email);
	return as(user, () => m.contacts.setContactStatus(String(contact._id), status, consent));
}

function patch(user, email, body) {
	return callApi("PATCH", `/api/v1/contacts/${encodeURIComponent(email)}`, { key: user.key, body });
}

async function callTool(key, name, args) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result;
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		globalSuppressions: await import("../lib/global-suppressions.js"),
		contactsLib: await import("../lib/contacts.js"),
		Contact: (await import("../models/Contact.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
		GlobalSuppression: (await import("../models/GlobalSuppression.js")).default,
	};
});

after(() => app?.stop());

describe("from the contact's menu", () => {
	test("an active contact goes dormant and back, and each change is kept with who made it", async () => {
		const user = await customer("menu@example.com");
		await importRows(user, [{ email: "reader@example.org", status: "active" }]);

		assert.deepEqual(await setByHand(user, "reader@example.org", "dormant"), { ok: true });
		assert.equal((await findContact(user, "reader@example.org")).status, "dormant");
		await m.Contact.updateOne({ accountId: user.accountId, email: "reader@example.org" }, { $set: { ignoredIssues: 4 } });

		assert.deepEqual(await setByHand(user, "reader@example.org", "active"), { ok: true });
		const contact = await findContact(user, "reader@example.org");
		assert.equal(contact.status, "active");
		assert.equal(contact.ignoredIssues, 0, "the list cleanup starts over");
		assert.deepEqual(
			contact.statusChanges.map(({ from, to, via }) => [from, to, via]),
			[
				["active", "dormant", "dashboard"],
				["dormant", "active", "dashboard"],
			]
		);
		assert.equal(String(contact.statusChanges[0].userId), String(user.userId));
		assert.equal(contact.statusChanges[1].consent, undefined, "no consent needed to wake a dormant contact");
	});

	test("resubscribing someone who unsubscribed takes the box saying they asked", async () => {
		const user = await customer("resubscribe@example.com");
		await importRows(user, [{ email: "left@example.org", status: "unsubscribed" }]);

		const refused = await setByHand(user, "left@example.org", "active");
		assert.match(refused.error, /only resubscribe someone who asked/);
		assert.equal((await findContact(user, "left@example.org")).status, "unsubscribed");

		assert.match((await setByHand(user, "left@example.org", "dormant", true)).error, /can only be resubscribed/);

		const before = await findContact(user, "left@example.org");
		assert.deepEqual(await setByHand(user, "left@example.org", "active", true), { ok: true });
		const contact = await findContact(user, "left@example.org");
		assert.equal(contact.status, "active");
		assert.equal(contact.unsubscribedAt, undefined);
		assert.ok(contact.subscribedAt > before.subscribedAt, "like signing up again");
		assert.deepEqual(
			contact.statusChanges.map(({ from, to, via, consent }) => ({ from, to, via, consent })),
			[{ from: "unsubscribed", to: "active", via: "dashboard", consent: true }]
		);
	});

	test("a pending contact becomes active only with consent, as confirmed", async () => {
		const user = await customer("pending@example.com");
		await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "new@example.org", status: "pending" });

		assert.match((await setByHand(user, "new@example.org", "active")).error, /asked to get your emails/);
		assert.match((await setByHand(user, "new@example.org", "dormant", true)).error, /can't become dormant/);
		assert.deepEqual(await setByHand(user, "new@example.org", "active", true), { ok: true });
		const contact = await findContact(user, "new@example.org");
		assert.equal(contact.status, "active");
		assert.ok(contact.confirmedAt);
		assert.equal(contact.statusChanges[0].consent, true);
	});

	test("bounced and complained contacts keep their status", async () => {
		const user = await customer("locked@example.com");
		await importRows(user, [
			{ email: "bounced@example.org", status: "bounced" },
			{ email: "complained@example.org", status: "complained" },
		]);
		assert.match((await setByHand(user, "bounced@example.org", "active", true)).error, /bounced, so their status can't change/);
		assert.match((await setByHand(user, "complained@example.org", "unsubscribed")).error, /spam, so their status can't change/);
		assert.equal((await findContact(user, "bounced@example.org")).status, "bounced");
		assert.equal((await findContact(user, "complained@example.org")).status, "complained");
	});
});

describe("through the API and MCP", () => {
	test("the same rules, with consent: true to resubscribe, and the key kept with each change", async () => {
		const user = await customer("agent@example.com");
		await importRows(user, [
			{ email: "reader@example.org", status: "active" },
			{ email: "left@example.org", status: "unsubscribed" },
			{ email: "bounced@example.org", status: "bounced" },
		]);

		const dormant = await patch(user, "reader@example.org", { status: "dormant" });
		assert.equal(dormant.status, 200, JSON.stringify(dormant.body));
		assert.equal(dormant.body.status, "dormant");
		const again = await patch(user, "reader@example.org", { status: "dormant" });
		assert.equal(again.status, 200, "setting the status it has changes nothing");
		assert.equal((await findContact(user, "reader@example.org")).statusChanges.length, 1);

		const withoutConsent = await patch(user, "left@example.org", { status: "active" });
		assert.equal(withoutConsent.status, 400);
		assert.equal(withoutConsent.body.error.code, "validation_failed");
		const toDormant = await patch(user, "left@example.org", { status: "dormant", consent: true });
		assert.equal(toDormant.status, 409);
		const resubscribed = await patch(user, "left@example.org", { status: "active", consent: true });
		assert.equal(resubscribed.status, 200, JSON.stringify(resubscribed.body));
		assert.equal(resubscribed.body.status, "active");
		assert.equal(resubscribed.body.unsubscribedAt, null);

		const locked = await patch(user, "bounced@example.org", { status: "active", consent: true });
		assert.equal(locked.status, 409);
		assert.match(locked.body.error.message, /bounced/);
		assert.equal((await patch(user, "reader@example.org", { status: "pending" })).status, 400, "pending can't be set");

		const change = (await findContact(user, "left@example.org")).statusChanges.at(-1);
		assert.equal(change.via, "api");
		assert.ok(change.apiKeyId);
		assert.equal(change.consent, true);

		const tool = await callTool(user.key, "update_contact_status", { id: "reader@example.org", status: "active" });
		assert.equal(tool.isError, undefined, JSON.stringify(tool));
		assert.equal(tool.structuredContent.status, "active");
		assert.equal((await findContact(user, "reader@example.org")).statusChanges.at(-1).via, "mcp");
	});

	test("an address the account or MailCheap won't email stays out, and its suppression stays as it was", async () => {
		const user = await customer("suppressed@example.com");
		await importRows(user, [
			{ email: "bounced-elsewhere@example.org", status: "unsubscribed" },
			{ email: "trap@example.org", status: "dormant" },
		]);
		await m.Suppression.create({ accountId: user.accountId, email: "bounced-elsewhere@example.org", reason: "bounce" });
		await m.globalSuppressions.suppressGlobally({ emails: ["trap@example.org"], reason: "trap" });

		const suppressed = await patch(user, "bounced-elsewhere@example.org", { status: "active", consent: true });
		assert.equal(suppressed.status, 409);
		assert.match(suppressed.body.error.message, /bounced, so it can't be emailed again/);
		const trap = await patch(user, "trap@example.org", { status: "active" });
		assert.equal(trap.status, 409);

		assert.equal(await m.Suppression.countDocuments({ accountId: user.accountId, email: "bounced-elsewhere@example.org" }), 1);
		assert.equal(await m.GlobalSuppression.countDocuments({ reason: "trap" }), 1);
		assert.equal((await findContact(user, "bounced-elsewhere@example.org")).status, "unsubscribed");
		assert.equal((await findContact(user, "trap@example.org")).status, "dormant");
		const unsubscribed = await patch(user, "trap@example.org", { status: "unsubscribed" });
		assert.equal(unsubscribed.status, 200, "leaving is always possible");
	});

	test(`a contact keeps its last ${STATUS_CHANGES_KEPT} changes`, async () => {
		const user = await customer("history@example.com");
		await importRows(user, [{ email: "reader@example.org", status: "active" }]);
		for (let index = 0; index < STATUS_CHANGES_KEPT + 2; index++) {
			const response = await patch(user, "reader@example.org", { status: index % 2 ? "active" : "dormant" });
			assert.equal(response.status, 200, JSON.stringify(response.body));
		}
		const { statusChanges } = await findContact(user, "reader@example.org");
		assert.equal(statusChanges.length, STATUS_CHANGES_KEPT);
		assert.deepEqual([statusChanges[0].from, statusChanges.at(-1).to], ["active", "active"]);
	});
});

describe("many at once", () => {
	function bulk(user, body) {
		return callApi("POST", "/api/v1/contacts/status", { key: user.key, body: { newsletter: user.slug, ...body } });
	}

	async function statuses(user) {
		const contacts = await m.Contact.find({ accountId: user.accountId }).sort({ email: 1 }).lean();
		return Object.fromEntries(contacts.map(({ email, status }) => [email, status]));
	}

	test("take only the changes that need no consent", () => {
		assert.deepEqual(getBulkFromStatuses("dormant"), ["active"]);
		assert.deepEqual(getBulkFromStatuses("unsubscribed"), ["active", "dormant", "pending"]);
		assert.deepEqual(getBulkFromStatuses("active"), ["dormant"], "resubscribing and confirming take consent, one contact at a time");
	});

	test("update_contacts_status changes what it picks within the filter's status, kept with the key, and never another account's", async () => {
		const user = await customer("bulk@example.com");
		const other = await customer("bulk-other@example.com");
		const rows = (owner) =>
			[
				["active@example.org", "active", { tags: ["paused"] }],
				["untagged@example.org", "active"],
				["dormant@example.org", "dormant", { tags: ["paused"], ignoredIssues: 4 }],
				["pending@example.org", "pending", { tags: ["paused"] }],
				["left@example.org", "unsubscribed", { tags: ["paused"] }],
				["bounced@example.org", "bounced", { tags: ["paused"] }],
			].map(([email, status, fields]) => ({ accountId: owner.accountId, newsletterId: owner.newsletterId, email, status, ...fields }));
		await m.Contact.insertMany([...rows(user), ...rows(other)]);
		const theirs = await statuses(other);

		for (const body of [
			{ filter: {}, status: "dormant" },
			{ status: "dormant" },
			{ all: true, filter: { tag: "paused" }, status: "dormant" },
			{ newsletter: undefined, all: true, status: "dormant" },
		]) {
			const refused = await bulk(user, body);
			assert.equal(refused.status, 400, JSON.stringify(body));
			assert.equal(refused.body.error.code, "validation_failed");
		}
		assert.equal((await bulk(user, { all: true, status: "pending" })).status, 400, "pending can't be set");

		const paused = await bulk(user, { filter: { tag: "paused" }, status: "dormant" });
		assert.equal(paused.status, 200, JSON.stringify(paused.body));
		assert.deepEqual(paused.body, { changed: 1, remaining: 0 });
		const change = (await findContact(user, "active@example.org")).statusChanges.at(-1);
		assert.deepEqual([change.from, change.to, change.via, Boolean(change.apiKeyId)], ["active", "dormant", "api", true]);

		const pending = await bulk(user, { filter: { tag: "paused", status: "pending" }, status: "unsubscribed" });
		assert.deepEqual(pending.body, { changed: 1, remaining: 0 }, "the filter's status narrows it");
		assert.ok((await findContact(user, "pending@example.org")).unsubscribedAt);
		assert.equal((await findContact(user, "dormant@example.org")).status, "dormant");

		assert.deepEqual((await bulk(user, { all: true, status: "active" })).body, { changed: 2, remaining: 0 });
		assert.deepEqual(await statuses(user), {
			"active@example.org": "active",
			"bounced@example.org": "bounced",
			"dormant@example.org": "active",
			"left@example.org": "unsubscribed",
			"pending@example.org": "unsubscribed",
			"untagged@example.org": "active",
		});
		assert.equal((await findContact(user, "dormant@example.org")).ignoredIssues, 0, "the list cleanup starts over");

		const theirId = String((await m.Contact.findOne({ accountId: other.accountId, email: "active@example.org" }).lean())._id);
		assert.deepEqual((await bulk(user, { newsletter: undefined, contacts: [theirId], status: "unsubscribed" })).body, { changed: 0, remaining: 0 });
		assert.deepEqual(await statuses(other), theirs, "another account's contacts stay as they were");

		const tool = await callTool(user.key, "update_contacts_status", { newsletter: user.slug, contacts: ["untagged@example.org"], status: "unsubscribed" });
		assert.equal(tool.isError, undefined, JSON.stringify(tool));
		assert.deepEqual(tool.structuredContent, { changed: 1, remaining: 0 });
		assert.equal((await findContact(user, "untagged@example.org")).statusChanges.at(-1).via, "mcp");
	});

	test("an address the account or MailCheap won't email stays dormant, and nothing is left to try again", async () => {
		const user = await customer("bulk-suppressed@example.com");
		await m.Contact.insertMany(
			["back", "bounced-elsewhere", "spamtrap"].map((name) => ({ accountId: user.accountId, newsletterId: user.newsletterId, email: `${name}@example.org`, status: "dormant" }))
		);
		await m.Suppression.create({ accountId: user.accountId, email: "bounced-elsewhere@example.org", reason: "bounce" });
		await m.globalSuppressions.suppressGlobally({ emails: ["spamtrap@example.org"], reason: "trap" });

		assert.deepEqual((await bulk(user, { all: true, status: "active" })).body, { changed: 1, remaining: 0 });
		assert.deepEqual(await statuses(user), { "back@example.org": "active", "bounced-elsewhere@example.org": "dormant", "spamtrap@example.org": "dormant" });
		assert.deepEqual((await bulk(user, { all: true, status: "active" })).body, { changed: 0, remaining: 0 });
		assert.deepEqual((await bulk(user, { all: true, status: "unsubscribed" })).body, { changed: 3, remaining: 0 }, "leaving is always possible");
	});

	test("a call changes a few thousand at most, and says how many are left for the next", async () => {
		const user = await customer("bulk-many@example.com");
		const { MAX_CHANGED_AT_ONCE } = m.contactsLib;
		await m.Contact.insertMany(
			Array.from({ length: MAX_CHANGED_AT_ONCE + 2 }, (_, index) => ({ accountId: user.accountId, newsletterId: user.newsletterId, email: `reader${index}@example.org`, status: "active" }))
		);
		assert.deepEqual((await bulk(user, { all: true, status: "dormant" })).body, { changed: MAX_CHANGED_AT_ONCE, remaining: 2 });
		assert.deepEqual((await bulk(user, { all: true, status: "dormant" })).body, { changed: 2, remaining: 0 });
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, status: "dormant" }), MAX_CHANGED_AT_ONCE + 2);
	});
});
