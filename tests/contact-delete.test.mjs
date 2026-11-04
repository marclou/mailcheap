import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, addAuthor, anonymous, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { runWithRequest } from "./stubs/next-headers.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// Deleting contacts from the dashboard, the REST API and MCP. A contact who unsubscribed, bounced or complained leaves
// a keyed hash of its address behind, so no way back in emails it again; any other contact comes back like a new one.
let app;
let m;
let visitor = 0;
let processed = 0;

// With the archive's signup form and a welcome email on, so every way in could email a new contact.
async function createNewsletter(user, slug) {
	const fields = {
		name: `${slug} news`,
		slug,
		postalAddress: "1 Main St, Paris",
		archiveEnabled: "on",
		welcomeEnabled: "on",
		welcomeSubject: "Welcome",
		welcomeContent: "Thanks for joining.",
	};
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))));
	const newsletterId = url.split("/").at(-1);
	await addAuthor(user, newsletterId);
	return newsletterId;
}

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	user.newsletterId = await createNewsletter(user, user.slug);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	user.signupsKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
	return user;
}

function api(user, method, path, body) {
	return callApi(method, `/api/v1${path}`, { key: user.key, body });
}

function signUp(user, body) {
	return callApi("POST", "/api/v1/contacts", { key: user.signupsKey, body });
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

function signUpOnArchive(user, email) {
	return runWithRequest({ headers: { "x-forwarded-for": `192.0.2.${++visitor}` } }, () =>
		m.archive.subscribe(null, form({ newsletter: user.slug, email }))
	);
}

async function importRows(user, rows, newsletterId = user.newsletterId) {
	const result = await as(user, () => m.contacts.importContacts({ newsletterId, consent: true, rows }));
	assert.ok(result.importId, JSON.stringify(result));
	return result;
}

function findContact(user, email, newsletterId = user.newsletterId) {
	return m.Contact.findOne({ accountId: user.accountId, newsletterId, email }).lean();
}

async function deleteByHand(user, email) {
	const contact = await findContact(user, email);
	assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(contact._id))), { ok: true }, email);
}

async function runJobs() {
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	}
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../app/archive/actions.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		blocks: await import("../lib/account-blocks.js"),
		Contact: (await import("../models/Contact.js")).default,
		DeletedContact: (await import("../models/DeletedContact.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

after(() => app?.stop());

describe("deleting a contact", () => {
	test("the dashboard deletes one contact of the open newsletter, and the list and its counts follow", async () => {
		const user = await customer("delete-dashboard@example.com");
		await importRows(user, [
			{ email: "stays@example.org", status: "active" },
			{ email: "goes@example.org", status: "active" },
		]);
		const goes = await findContact(user, "goes@example.org");

		assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(goes._id))), { ok: true });
		assert.equal(await findContact(user, "goes@example.org"), null);
		const list = (await api(user, "GET", "/contacts")).body;
		assert.deepEqual(list.contacts.map(({ email }) => email), ["stays@example.org"]);
		assert.equal(list.counts.active, 1);
		assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(goes._id))), { error: "Contact not found" });
		assert.equal(await m.DeletedContact.countDocuments({ accountId: user.accountId }), 0, "an active contact leaves nothing behind");
	});

	test("an address in two newsletters needs the newsletter, and only that newsletter's contact goes", async () => {
		const user = await customer("delete-scoped@example.com");
		const otherId = await createNewsletter(user, "delete-scoped-two");
		await importRows(user, [{ email: "both@example.org", status: "active" }]);
		await importRows(user, [{ email: "both@example.org", status: "active" }], otherId);
		const first = await findContact(user, "both@example.org");
		const second = await findContact(user, "both@example.org", otherId);

		const ambiguous = await api(user, "DELETE", "/contacts/both%40example.org");
		assert.deepEqual([ambiguous.status, ambiguous.body.error.message], [400, "newsletter is required: this address is a contact of several newsletters"]);
		const outside = await api(user, "DELETE", `/contacts/${first._id}?newsletter=delete-scoped-two`);
		assert.deepEqual([outside.status, outside.body.error.code], [404, "not_found"], "an ID outside the newsletter named isn't found");

		const deleted = await api(user, "DELETE", "/contacts/both%40example.org?newsletter=delete-scoped-two");
		assert.deepEqual([deleted.status, deleted.body], [200, { id: String(second._id), deleted: true }]);
		assert.equal(await findContact(user, "both@example.org", otherId), null);
		assert.ok(await findContact(user, "both@example.org"), "the other newsletter's contact stays");

		const viaMcp = await callTool(user.key, "delete_contact", { id: "both@example.org" });
		assert.deepEqual(viaMcp.structuredContent, { id: String(first._id), deleted: true }, "in one newsletter now, the address is enough");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 0);
	});

	test("a contact who unsubscribed, bounced or complained leaves its status under a keyed hash, and nothing else", async () => {
		const user = await customer("delete-left@example.com");
		await importRows(user, [
			{ email: "left@example.org", status: "active" },
			{ email: "bounced@example.org", status: "bounced" },
			{ email: "complained@example.org", status: "complained" },
			{ email: "active@example.org", status: "active" },
			{ email: "dormant@example.org", status: "dormant" },
		]);
		const left = await findContact(user, "left@example.org");
		const token = createUnsubscribeToken({ contactId: left._id, newsletterId: user.newsletterId });
		const unsubscribed = await m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST" }));
		assert.equal(unsubscribed.status, 200);

		for (const email of ["left", "bounced", "complained", "active", "dormant"]) await deleteByHand(user, `${email}@example.org`);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 0);
		const kept = await m.DeletedContact.find({ accountId: user.accountId }).lean();
		assert.deepEqual(kept.map(({ status }) => status).sort(), ["bounced", "complained", "unsubscribed"]);
		for (const record of kept) {
			assert.equal(String(record.newsletterId), user.newsletterId);
			assert.match(record.emailHash, /^[\w-]{43}$/, "an HMAC-SHA256 in base64url");
			assert.doesNotMatch(JSON.stringify(record), /@|example/, "no address in it");
		}
		assert.deepEqual(
			(await m.Suppression.find({ accountId: user.accountId }).lean()).map(({ email }) => email).sort(),
			["bounced@example.org", "complained@example.org"],
			"the account's suppression list stays as it was"
		);
	});
});

describe("adding a deleted contact again", () => {
	test("one who left is never emailed again: imports leave it out, and every signup brings its status back", async () => {
		const user = await customer("delete-readd@example.com");
		await importRows(user, [
			{ email: "left@example.org", status: "active" },
			{ email: "complained@example.org", status: "complained" },
		]);
		// A bounce the account's suppression list doesn't have, from before there was one: only the contact remembers it.
		await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "bounced@example.org", status: "bounced" });
		const left = await findContact(user, "left@example.org");
		assert.deepEqual(await as(user, () => m.contacts.setContactStatus(String(left._id), "unsubscribed")), { ok: true });
		for (const email of ["left", "complained", "bounced"]) await deleteByHand(user, `${email}@example.org`);
		const before = sesEmails.length;

		const imported = await importRows(user, ["left", "complained", "bounced", "new"].map((name) => ({ email: `${name}@example.org`, status: "active" })));
		assert.deepEqual([imported.created, imported.dropped.suppressed], [1, 3]);

		const signup = await signUp(user, { email: "left@example.org", resubscribe: true });
		assert.deepEqual([signup.status, signup.body.created, signup.body.status], [201, true, "unsubscribed"]);
		const viaMcp = await callTool(user.key, "add_contact", { email: "bounced@example.org", resubscribe: true });
		assert.deepEqual([viaMcp.structuredContent.created, viaMcp.structuredContent.status], [true, "bounced"]);
		const byHand = await as(user, () => m.contacts.addContact(null, form({ newsletterId: user.newsletterId, email: "complained@example.org", consent: "on" })));
		assert.deepEqual(byHand, { email: "complained@example.org", status: "complained" });
		assert.deepEqual(await signUpOnArchive(user, "left@example.org"), { ok: true });
		assert.deepEqual(await signUpOnArchive(user, "bounced@example.org"), { ok: true });
		const contacts = await m.Contact.find({ accountId: user.accountId }).lean();
		assert.deepEqual(Object.fromEntries(contacts.map(({ email, status }) => [email, status])), {
			"new@example.org": "active",
			"left@example.org": "unsubscribed",
			"bounced@example.org": "bounced",
			"complained@example.org": "complained",
		});

		const draft = await api(user, "POST", "/campaigns", { subject: "Issue", content: "Hello." });
		assert.equal((await api(user, "POST", `/campaigns/${draft.body.id}/send`)).body.stats.recipients, 1);
		await flushAfter();
		await runJobs();
		assert.deepEqual(sesEmails.slice(before).map(({ to }) => to), ["new@example.org"], "no welcome, confirmation or issue for them");
	});

	test("a deleted active or dormant contact comes back like a new one, and an unsubscribe still only counts for its newsletter", async () => {
		const user = await customer("delete-freed@example.com");
		await importRows(user, [
			{ email: "active@example.org", status: "active" },
			{ email: "dormant@example.org", status: "dormant" },
			{ email: "left@example.org", status: "unsubscribed" },
		]);
		for (const email of ["active", "dormant", "left"]) await deleteByHand(user, `${email}@example.org`);
		const before = sesEmails.length;

		const signup = await signUp(user, { email: "active@example.org" });
		assert.deepEqual([signup.status, signup.body.created, signup.body.status], [201, true, "active"]);
		const imported = await importRows(user, [{ email: "dormant@example.org", status: "active" }]);
		assert.deepEqual([imported.created, imported.dropped.suppressed], [1, 0]);
		assert.equal((await findContact(user, "dormant@example.org")).status, "active");

		await createNewsletter(user, "delete-freed-two");
		const elsewhere = await signUp(user, { newsletter: "delete-freed-two", email: "left@example.org" });
		assert.deepEqual([elsewhere.status, elsewhere.body.status], [201, "active"]);
		await flushAfter();
		assert.deepEqual(sesEmails.slice(before).map(({ to, subject }) => `${to}: ${subject}`).sort(), [
			"active@example.org: Welcome",
			"left@example.org: Welcome",
		]);
	});
});

describe("limits", () => {
	test("a blocked account can't delete contacts, from the dashboard or the API", async () => {
		const user = await customer("delete-blocked@example.com");
		await importRows(user, [{ email: "reader@example.org", status: "active" }]);
		const reader = await findContact(user, "reader@example.org");
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });

		assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(reader._id))), {
			error: "This account is blocked: Review. Chat with us to unblock it.",
			code: "account_blocked",
		});
		const viaApi = await api(user, "DELETE", `/contacts/${reader._id}`);
		assert.deepEqual([viaApi.status, viaApi.body.error.code], [403, "account_blocked"]);
		assert.ok(await findContact(user, "reader@example.org"));
	});

	test("each key deletes 120 contacts an hour and its account as many across its keys; deleting by hand isn't counted", async () => {
		const user = await customer("delete-limit@example.com");
		await importRows(user, Array.from({ length: 122 }, (_, index) => ({ email: `reader${index}@example.org`, status: "active" })));
		const contacts = await m.Contact.find({ accountId: user.accountId }).select({ _id: 1 }).lean();
		for (const [index, { _id }] of contacts.slice(0, 120).entries()) {
			assert.equal((await api(user, "DELETE", `/contacts/${_id}`)).status, 200, String(index));
		}

		const limited = await api(user, "DELETE", `/contacts/${contacts[120]._id}`);
		assert.deepEqual([limited.status, limited.body.error.message], [429, "Too many delete_contact calls, try again later"]);
		const otherKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Other agent", level: "full" })))).key;
		const viaOtherKey = await callApi("DELETE", `/api/v1/contacts/${contacts[120]._id}`, { key: otherKey });
		assert.deepEqual([viaOtherKey.status, viaOtherKey.body.error.message], [429, "Too many delete_contact calls on this account, try again later"]);
		assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(contacts[121]._id))), { ok: true });
	});
});
