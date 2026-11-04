import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getDeliveryEmail } from "../lib/email-aliases.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { normalizePostshibaEvent } from "../lib/email-provider/postshiba-events.js";
import { getSesEventPlan } from "../lib/ses-event-mapping.js";
import { activate, addAuthor, anonymous, as, callApi, catchNotFound, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { POSTSHIBA } from "./helpers/postshiba.mjs";
import { runWithRequest } from "./stubs/next-headers.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// The never-email list every account shares: what a provider says doesn't exist, and spam traps, kept as keyed hashes
// and skipped by every account's imports, signups and sends. Complaints and soft bounces stay the account's own.
const UNDELIVERABLE = "This address can't receive email";
const DAY_MS = 24 * 60 * 60 * 1000;

function postshibaBounce(fields) {
	return { event: "bounce", email: "Reader@Example.org", timestamp: 1_790_000_000, ...fields };
}

test("a +tag goes and Gmail's two domains are one, but Gmail's dots and Yahoo's -tags stay as delivered", () => {
	assert.equal(getDeliveryEmail(" Jane.Doe+News@GoogleMail.com "), "jane.doe@gmail.com");
	assert.equal(getDeliveryEmail("jane+shop@outlook.com"), "jane@outlook.com");
	assert.equal(getDeliveryEmail("jane-shop@yahoo.com"), "jane-shop@yahoo.com", "a disposable address of its own");
	assert.equal(getDeliveryEmail("jane+shop@example.com"), "jane+shop@example.com", "a domain without the rule keeps its tag");
	assert.equal(getDeliveryEmail("not an email"), null);
});

test("PostShiba's Invalid Address hard bounces and spam traps are listed; soft bounces and complaints never are", () => {
	const listing = (fields) => getEventPlan(normalizePostshibaEvent(postshibaBounce(fields))).globalSuppression;
	assert.deepEqual(listing({ type: "bounce", status: "5.1.1", reason: "550 5.1.1 user unknown", bounce_classification: "Invalid Address" }), {
		emails: ["reader@example.org"],
		reason: "bounce",
		detail: "bounce/5.1.1",
	});
	assert.equal(listing({ type: "bounce", status: "5.1.2", reason: "Host unknown", bounce_classification: "Invalid Address" }).reason, "bounce", "no such domain");
	for (const [fields, why] of [
		[{ type: "bounce", status: "5.2.2", reason: "552 5.2.2 mailbox full", bounce_classification: "Mailbox Unavailable" }, "a full mailbox"],
		[{ type: "bounce", status: "5.2.1", reason: "550 5.2.1 account disabled", bounce_classification: "Mailbox Unavailable" }, "a disabled mailbox"],
		[{ type: "blocked", status: "5.7.1", reason: "550 5.7.1 sender blocked", bounce_classification: "Reputation" }, "a refusal of the sender"],
		[{ type: "bounce", reason: "expired", bounce_classification: "Invalid Address" }, "a message that expired"],
		[{ type: "bounce", status: "4.1.1", reason: "450 4.1.1 try later", bounce_classification: "Invalid Address" }, "a temporary code"],
		[{ type: "bounce", status: "5.1.1", reason: "550 5.1.1 user unknown" }, "no class"],
		[{ type: "blocked", reason: "554 5.7.1 listed for spamtrap hits", bounce_classification: "Reputation" }, "a shared IP's listing"],
	]) {
		assert.equal(listing(fields), null, why);
	}
	assert.deepEqual(listing({ type: "bounce", status: "5.7.1", reason: "550 5.7.1 spamtrap hit", bounce_classification: "Reputation" }), {
		emails: ["reader@example.org"],
		reason: "trap",
		detail: "bounce/5.7.1",
	});
	assert.equal(getEventPlan(normalizePostshibaEvent({ event: "spamreport", email: "reader@example.org" })).globalSuppression, null);

	const ses = (bounceType, bounceSubType) =>
		getSesEventPlan({
			eventType: "Bounce",
			mail: { messageId: "ses-1", destination: ["reader@example.org"] },
			bounce: { bounceType, bounceSubType, bouncedRecipients: [{ emailAddress: "reader@example.org", diagnosticCode: "smtp; 550 5.1.1 user unknown" }] },
		}).globalSuppression;
	assert.equal(ses("Permanent", "NoEmail").reason, "bounce");
	assert.equal(ses("Permanent", "Suppressed").reason, "bounce", "on SES's own list of invalid addresses");
	assert.equal(ses("Permanent", "General"), null, "General can be a full mailbox");
	assert.equal(ses("Transient", "MailboxFull"), null);
});

describe("the never-email list", () => {
	let app;
	let m;
	let admin;
	let processed = 0;
	let visitor = 0;

	before(async () => {
		app = await startTestApp({ POSTSHIBA_WEBHOOK_SECRET: POSTSHIBA.webhookSecret, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			contactsPage: await import("../app/(app)/contacts/page.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			archive: await import("../app/archive/actions.js"),
			admin: await import("../app/admin/actions.js"),
			mcpRoute: await import("../app/mcp/route.js"),
			webhookRoute: await import("../app/api/webhooks/postshiba/route.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			Account: (await import("../models/Account.js")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			ContactImport: (await import("../models/ContactImport.js")).default,
			GlobalSuppression: (await import("../models/GlobalSuppression.js")).default,
			Message: (await import("../models/Message.js")).default,
			Suppression: (await import("../models/Suppression.js")).default,
		};
		admin = await signIn("admin@example.com");
	});

	after(() => app?.stop());

	// A paying customer with a newsletter, a full access key and a PostShiba tenant its events name.
	async function customer(email) {
		const user = await signIn(email);
		await activate(user);
		user.slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })))
		);
		user.newsletterId = url.split("/").at(-1);
		await addAuthor(user);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
		user.tenantSlug = `mc-${user.accountId}`;
		await m.Account.updateOne({ _id: user.accountId }, { $set: { postshiba: { tenantId: `Tn-${user.slug}`, tenantSlug: user.tenantSlug, tenantStatus: "active" } } });
		return user;
	}

	async function importRows(user, rows) {
		const result = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
		assert.ok(result.importId, JSON.stringify(result));
		return result;
	}

	function addByApi(user, email) {
		return callApi("POST", "/api/v1/contacts", { key: user.key, body: { email } });
	}

	async function addByMcp(user, email) {
		const request = new Request("http://localhost:3000/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": "2025-06-18",
				authorization: `Bearer ${user.key}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_contact", arguments: { email } } }),
		});
		const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
		return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result;
	}

	function addOnArchive(user, email) {
		return runWithRequest({ headers: { "x-forwarded-for": `192.0.2.${++visitor}` } }, () => m.archive.subscribe(null, form({ newsletter: user.slug, email })));
	}

	function addByHand(user, email) {
		return as(user, () => m.contacts.addContact(null, form({ newsletterId: user.newsletterId, email, consent: "on" })));
	}

	// An email of the account's that went out, as the webhook finds it by the unique args every send carries.
	async function sentMessage(user, email) {
		const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "active" });
		const campaign = await m.Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject: "Earlier issue", status: "sent", startedAt: new Date() });
		return m.Message.create({ kind: "campaign", accountId: user.accountId, newsletterId: user.newsletterId, campaignId: campaign._id, contactId: contact._id, email, status: "sent", sentAt: new Date() });
	}

	function event(user, message, name, fields = {}) {
		const args = message ? { account_id: String(user.accountId), message_id: String(message._id), kind: "campaign" } : {};
		return {
			event: name,
			email: message?.email,
			timestamp: Math.floor(Date.now() / 1000),
			sg_event_id: `capsule-${crypto.randomUUID()}`,
			sg_message_id: `${crypto.randomUUID()}@postshiba.test`,
			tenant_id: user.tenantSlug,
			...args,
			unique_args: args,
			...fields,
		};
	}

	function hardBounce(user, message, fields = {}) {
		return event(user, message, "bounce", { type: "bounce", status: "5.1.1", reason: "550 5.1.1 user unknown", bounce_classification: "Invalid Address", ...fields });
	}

	async function post(...events) {
		for (const item of events) {
			const body = JSON.stringify([item]);
			const timestamp = String(Math.floor(Date.now() / 1000));
			const signature = `sha256=${crypto.createHmac("sha256", POSTSHIBA.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;
			const response = await m.webhookRoute.POST(
				new Request("http://localhost:3000/api/webhooks/postshiba", {
					method: "POST",
					headers: { "content-type": "application/json", "x-capsule-timestamp": timestamp, "x-capsule-signature": signature },
					body,
				})
			);
			assert.equal(response.status, 200);
		}
	}

	async function runJobs() {
		while (processed < published.length) {
			const { url, body } = published[processed++];
			if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
		}
	}

	// A campaign to the newsletter's active contacts, sent through the batches: who got it.
	async function sendIssue(user, subject) {
		const draft = await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { subject, content: "Hello." } });
		const queued = await callApi("POST", `/api/v1/campaigns/${draft.body.id}/send`, { key: user.key });
		assert.equal(queued.status, 200, JSON.stringify(queued.body));
		await flushAfter();
		await runJobs();
		return { campaignId: draft.body.id, to: sesEmails.filter((email) => email.subject === subject).map(({ to }) => to).sort() };
	}

	function findContact(user, email) {
		return m.Contact.findOne({ accountId: user.accountId, email }).lean();
	}

	// The list's own scheme: an HMAC of the address as delivered, with a key derived from SUPPRESSION_HASH_KEY only.
	function expectedHash(email) {
		const key = crypto.hkdfSync("sha256", process.env.SUPPRESSION_HASH_KEY, "", "mailcheap-global-suppression-v1", 32);
		return crypto.createHmac("sha256", Buffer.from(key)).update(getDeliveryEmail(email)).digest("base64url");
	}

	test("a hard bounce at one account stops the address for every other: its imports, adds and sends", async () => {
		const alice = await customer("never-alice@example.com");
		const bob = await customer("never-bob@example.com");
		// On Bob's list before anyone knew.
		await importRows(bob, ["dead@example.org", "jane.doe+bob@gmail.com", "alive@example.org", "janedoe@gmail.com"].map((email) => ({ email, status: "active" })));

		await post(hardBounce(alice, await sentMessage(alice, "dead@example.org")), hardBounce(alice, await sentMessage(alice, "jane.doe+news@gmail.com")));
		const entries = await m.GlobalSuppression.find({ emailHash: { $in: [expectedHash("dead@example.org"), expectedHash("jane.doe@gmail.com")] } }).lean();
		assert.equal(entries.length, 2, "jane.doe+news@gmail.com is listed as jane.doe@gmail.com, as delivered");
		for (const entry of entries) {
			assert.deepEqual([entry.reason, entry.detail], ["bounce", "bounce/5.1.1"]);
			assert.ok(Math.abs(entry.expiresAt - Date.now() - 180 * DAY_MS) < 60_000, "180 days after the bounce");
			assert.deepEqual(Object.keys(entry).sort(), ["__v", "_id", "createdAt", "detail", "emailHash", "expiresAt", "reason", "updatedAt"], "nothing names an account");
			assert.doesNotMatch(JSON.stringify(entry), /@|example|gmail/);
		}
		assert.equal((await findContact(alice, "dead@example.org")).status, "bounced", "Alice's own handling stays as it was");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "dead@example.org", reason: "bounce" }));
		assert.equal((await findContact(bob, "dead@example.org")).status, "active", "Bob's data isn't touched by Alice's event");

		const imported = await importRows(bob, [
			{ email: "dead@example.org", status: "active" },
			{ email: "Jane.Doe@GoogleMail.com", status: "active" },
			{ email: "janedoe@gmail.com", status: "active" },
			{ email: "new@example.org", status: "active" },
			{ email: "jane.doe+old@gmail.com", status: "unsubscribed" },
		]);
		assert.deepEqual([imported.created, imported.existing, imported.dropped.undeliverable], [2, 1, 2], "Gmail's dots aren't merged: janedoe@ is another address");
		assert.equal((await m.ContactImport.findOne({ accountId: bob.accountId, _id: imported.importId }).lean()).dropped.undeliverable, 2);
		assert.equal((await findContact(bob, "jane.doe+old@gmail.com")).status, "unsubscribed", "a row that only records an unsubscribe still goes in");

		for (const email of ["dead@example.org", "Jane.Doe+Hi@GoogleMail.com"]) {
			const viaApi = await addByApi(bob, email);
			assert.deepEqual([viaApi.status, viaApi.body.error], [400, { code: "validation_failed", message: UNDELIVERABLE }], email);
		}
		const viaMcp = await addByMcp(bob, "dead@example.org");
		assert.deepEqual([viaMcp.isError, JSON.parse(viaMcp.content[0].text).error.message], [true, UNDELIVERABLE]);
		assert.deepEqual(await addByHand(bob, "dead@example.org"), { error: UNDELIVERABLE });
		assert.deepEqual(await addOnArchive(bob, "dead@example.org"), { error: UNDELIVERABLE });
		assert.equal((await addByApi(bob, "janedoe+hi@gmail.com")).status, 201);
		await flushAfter();

		const { campaignId, to } = await sendIssue(bob, "Bob's issue");
		assert.deepEqual(to, ["alive@example.org", "janedoe+hi@gmail.com", "janedoe@gmail.com", "new@example.org"], "one batch, two of its contacts listed");
		const skipped = await m.Message.find({ accountId: bob.accountId, campaignId, status: "suppressed" }).lean();
		assert.deepEqual(skipped.map(({ email, error }) => `${email}: ${error}`).sort(), [`dead@example.org: ${UNDELIVERABLE}`, `jane.doe+bob@gmail.com: ${UNDELIVERABLE}`]);
		for (const email of ["dead@example.org", "jane.doe+bob@gmail.com"]) {
			const contact = await findContact(bob, email);
			assert.equal(contact.status, "bounced", email);
			assert.ok(contact.undeliverableAt instanceof Date, `${email} is marked so Bob sees why`);
		}
		assert.equal(await m.Suppression.countDocuments({ accountId: bob.accountId }), 0, "Bob's own suppression list stays his");

		const page = await as(bob, () => m.contactsPage.default({ searchParams: Promise.resolve({ status: "bounced" }) }));
		assert.match(renderToStaticMarkup(page), /Undeliverable/);
	});

	test("soft bounces, complaints and an address the email didn't go to stay with their account", async () => {
		const alice = await customer("never-soft@example.com");
		const bob = await customer("never-soft-bob@example.com");
		const before = await m.GlobalSuppression.countDocuments();

		await post(
			hardBounce(alice, await sentMessage(alice, "full@example.org"), { status: "5.2.2", reason: "552 5.2.2 mailbox full", bounce_classification: "Mailbox Unavailable" }),
			hardBounce(alice, await sentMessage(alice, "blocked@example.org"), { type: "blocked", status: "5.7.1", reason: "550 5.7.1 sender blocked", bounce_classification: "Reputation" }),
			hardBounce(alice, await sentMessage(alice, "late@example.org"), { reason: "expired" }),
			event(alice, await sentMessage(alice, "slow@example.org"), "deferred", { reason: "421 try again later", bounce_classification: "Frequency/Volume" }),
			event(alice, await sentMessage(alice, "complainer@example.org"), "spamreport"),
			hardBounce(alice, await sentMessage(alice, "named@example.org"), { email: "other@example.org" }),
			hardBounce(alice, null, { email: "unmatched@example.org" })
		);
		assert.equal(await m.GlobalSuppression.countDocuments(), before, "nothing listed");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "full@example.org", reason: "bounce" }), "Alice's own suppression as before");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "complainer@example.org", reason: "complaint" }));
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "unmatched@example.org", reason: "bounce" }), "the tenant's suppression still applies");
		assert.equal((await findContact(alice, "complainer@example.org")).status, "complained");

		for (const email of ["full@example.org", "blocked@example.org", "late@example.org", "slow@example.org", "complainer@example.org", "other@example.org", "unmatched@example.org"]) {
			assert.equal((await addByApi(bob, email)).status, 201, email);
		}
		await flushAfter();
		const { to } = await sendIssue(bob, "Bob's soft issue");
		assert.ok(to.includes("complainer@example.org"), "a complaint at Alice's isn't Bob's");
		assert.equal(to.length, 7);
	});

	test("a spam trap stays on the list for good, and a hard bounce leaves after 180 days", async () => {
		const trapped = await customer("never-trapped@example.com");
		const alice = await customer("never-expiry@example.com");
		const bob = await customer("never-expiry-bob@example.com");
		await post(hardBounce(trapped, await sentMessage(trapped, "trap@example.org"), { status: "5.7.1", reason: "550 5.7.1 spamtrap hit", bounce_classification: "Reputation" }));
		assert.equal((await m.Account.findById(trapped.accountId).lean()).pausedBy, "trap", "the account is blocked as before");
		await post(hardBounce(alice, await sentMessage(alice, "trap@example.org")), hardBounce(alice, await sentMessage(alice, "gone@example.org")));

		const trap = await m.GlobalSuppression.findOne({ emailHash: expectedHash("trap@example.org") }).lean();
		assert.deepEqual([trap.reason, trap.expiresAt], ["trap", undefined], "a later bounce never gives a trap an end");
		const indexes = await m.GlobalSuppression.collection.indexes();
		const ttl = indexes.find(({ key }) => Object.keys(key).join() === "expiresAt");
		assert.equal(ttl.expireAfterSeconds, 0, "MongoDB deletes a bounce once its date is past, and never an entry without one");

		// 180 days later: the bounce's date is past, before MongoDB's TTL monitor gets to it.
		await m.GlobalSuppression.updateOne({ emailHash: expectedHash("gone@example.org") }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
		assert.equal((await addByApi(bob, "gone@example.org")).status, 201);
		assert.equal((await addByApi(bob, "trap@example.org")).status, 400);
		const imported = await importRows(bob, [{ email: "trap@example.org", status: "active" }, { email: "gone2@example.org", status: "active" }]);
		assert.deepEqual([imported.created, imported.dropped.undeliverable], [1, 1]);
	});

	test("an admin looks an address up and takes a false positive off: the contacts it stopped are active again", async () => {
		const alice = await customer("never-admin-alice@example.com");
		const bob = await customer("never-admin-bob@example.com");
		await importRows(bob, [{ email: "wrong@example.org", status: "active" }, { email: "fine@example.org", status: "active" }]);
		await post(hardBounce(alice, await sentMessage(alice, "wrong@example.org")));
		assert.deepEqual((await sendIssue(bob, "Before the fix")).to, ["fine@example.org"]);
		assert.equal((await findContact(bob, "wrong@example.org")).status, "bounced");

		assert.equal(await as(bob, () => catchNotFound(m.admin.findUndeliverableAddress("wrong@example.org"))), true);
		assert.equal(await as(bob, () => catchNotFound(m.admin.removeUndeliverableAddress("wrong@example.org"))), true);
		assert.ok(await m.GlobalSuppression.exists({ emailHash: expectedHash("wrong@example.org") }), "nothing changed for a customer");

		const found = await as(admin, () => m.admin.findUndeliverableAddress(" Wrong@Example.org "));
		assert.equal(found.email, "wrong@example.org");
		assert.deepEqual([found.entry.reason, found.entry.detail], ["bounce", "bounce/5.1.1"]);
		assert.ok(new Date(found.entry.expiresAt) > new Date(found.entry.listedAt));
		assert.deepEqual(await as(admin, () => m.admin.findUndeliverableAddress("nope")), { error: "Enter a valid email" });

		assert.deepEqual(await as(admin, () => m.admin.removeUndeliverableAddress("wrong@example.org")), { ok: true, restored: 1 });
		const restored = await findContact(bob, "wrong@example.org");
		assert.deepEqual([restored.status, restored.undeliverableAt], ["active", undefined]);
		assert.equal((await findContact(alice, "wrong@example.org")).status, "bounced", "Alice's own bounce stays hers");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "wrong@example.org" }));
		assert.deepEqual(await as(admin, () => m.admin.findUndeliverableAddress("wrong@example.org")), { email: "wrong@example.org", entry: null });
		assert.deepEqual(await as(admin, () => m.admin.removeUndeliverableAddress("wrong@example.org")), { error: "Not on the list" });
		assert.deepEqual((await sendIssue(bob, "After the fix")).to, ["fine@example.org", "wrong@example.org"]);
	});
});
