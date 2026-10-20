import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getConfirmationContent } from "../lib/confirmation-content.js";
import { activate, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { remoteImages } from "./stubs/remote-image.mjs";
import { deleted as s3Deleted, objects as s3Objects } from "./stubs/s3.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";
import { deleted as blobDeleted, stored as blobStored } from "./stubs/vercel-blob.mjs";

// The REST API through its route handler, with keys made on the API keys page. Every successful answer is
// checked against the action's output schema, which the docs and MCP publish.
let app;
let m;
let processed = 0;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const S3_ENV = {
	IMAGES_S3_BUCKET: "mailcheap-images-test",
	IMAGES_S3_ACCESS_KEY_ID: "images-key-id",
	IMAGES_S3_SECRET_ACCESS_KEY: "images-secret",
	IMAGES_CDN_URL: "https://cdn.example.com",
};

async function api(key, method, path, body) {
	const response = await callApi(method, `/api/v1${path}`, { key, body });
	if (response.status < 300) {
		const segments = new URL(path, "http://x").pathname.split("/").filter(Boolean).map(decodeURIComponent);
		const { action } = m.rest.matchRoute(method, segments);
		const checked = action.output.safeParse(response.body);
		assert.ok(checked.success, `${action.name} answered outside its schema: ${checked.error?.message}`);
	}
	return response;
}

function assertError(response, status, code) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	assert.deepEqual(Object.keys(response.body), ["error"]);
	assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
	assert.equal(response.body.error.code, code, response.body.error.message);
	return response.body.error.message;
}

async function runJobs() {
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	}
}

async function createKey(user, level, name = `${level} key`) {
	return (await as(user, () => m.apiKeys.createApiKey(null, form({ name, level })))).key;
}

async function customer(email, { limits, postalAddress = "1 Main St, Paris" } = {}) {
	const user = await signIn(email);
	await activate(user, limits ? { limitOverrides: limits } : {});
	user.slug = email.split("@")[0].replace(/[^a-z0-9]/g, "-");
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = await createKey(user, "full");
	user.signupsKey = await createKey(user, "signups");
	return user;
}

async function importReaders(user, count, prefix = "reader") {
	const contacts = Array.from({ length: count }, (_, index) => ({ email: `${prefix}${index}@${user.slug}.example.org` }));
	const response = await api(user.key, "POST", "/contacts/import", { consent: true, contacts });
	assert.equal(response.status, 200);
	return response.body;
}

async function draft(user, fields = {}) {
	const response = await api(user.key, "POST", "/campaigns", { subject: "Issue", previewText: "This week", content: "Hello **readers**.", ...fields });
	assert.equal(response.status, 201);
	return response.body.id;
}

// The settings form with confirmed opt-in on, as a browser sends it: a textarea's line breaks become CRLF.
function saveSettingsForm(user, { description = "", confirmation }) {
	const fields = {
		id: user.newsletterId,
		name: `${user.slug} news`,
		slug: user.slug,
		postalAddress: "1 Main St, Paris",
		description,
		requireConfirmation: "on",
		confirmationSubject: confirmation.subject,
		confirmationPreviewText: confirmation.previewText,
		confirmationMarkdown: confirmation.markdown.replaceAll("\n", "\r\n"),
	};
	return as(user, () => m.newsletters.saveNewsletter(null, form(fields)));
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		rest: await import("../lib/api/rest.js"),
		reference: await import("../lib/docs/reference.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		exportRoute: await import("../app/api/v1/contacts/export.csv/route.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		accounts: await import("../lib/accounts.js"),
		blocks: await import("../lib/account-blocks.js"),
		tokens: await import("../lib/api-key-tokens.js"),
		Account: (await import("../models/Account.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		Upload: (await import("../models/Upload.js")).default,
	};
});

after(() => app?.stop());

describe("authentication", () => {
	test("a missing, malformed, unknown or revoked key is unauthorized", async () => {
		const user = await customer("unauthorized@example.com");
		const revoked = await createKey(user, "full", "Revoked");
		const { id } = (await api(user.key, "GET", "/api-keys")).body.apiKeys.find(({ name }) => name === "Revoked");
		assert.equal((await api(user.key, "DELETE", `/api-keys/${id}`)).status, 200);

		for (const key of [undefined, "mc_short", `mc_${"x".repeat(43)}`, revoked]) {
			const response = await api(key, "GET", "/newsletters");
			assertError(response, 401, "unauthorized");
			assert.match(response.headers.get("www-authenticate"), /^Bearer/);
		}
		assertError(await callApi("GET", "/api/v1/newsletters", { headers: { authorization: `Basic ${user.key}` } }), 401, "unauthorized");
	});

	test("an endpoint that doesn't exist is not_found", async () => {
		const user = await customer("unknown-path@example.com");
		assertError(await api(user.key, "GET", "/nothing-here"), 404, "not_found");
		assertError(await api(user.key, "DELETE", "/campaigns"), 404, "not_found");
	});
});

describe("key levels", () => {
	test("a signups only key adds contacts and nothing else", async () => {
		const user = await customer("levels@example.com");
		const added = await api(user.signupsKey, "POST", "/contacts", { email: "fan@example.org", source: "website" });
		assert.equal(added.status, 201);
		assert.deepEqual({ status: added.body.status, created: added.body.created }, { status: "active", created: true });
		assert.equal((await api(user.signupsKey, "POST", "/contacts", { email: "fan@example.org" })).status, 200, "already there");

		for (const [method, path, body] of [
			["GET", "/contacts"],
			["GET", "/campaigns"],
			["POST", "/campaigns", { subject: "Nope" }],
			["POST", "/api-keys", { name: "Escalate", level: "full" }],
			["GET", "/billing"],
		]) {
			assertError(await api(user.signupsKey, method, path, body), 403, "forbidden");
		}
		assert.equal(await m.Campaign.countDocuments({ accountId: user.accountId }), 0);
		assert.equal(await m.ApiKey.countDocuments({ accountId: user.accountId, name: "Escalate" }), 0);
	});

	test("keys from before levels can only add contacts", async () => {
		const user = await customer("legacy-key@example.com");
		const { key, prefix, hash } = m.tokens.generateApiKey();
		await m.ApiKey.collection.insertOne({ accountId: user.accountId, name: "Old site key", prefix, hash, createdAt: new Date() });
		assert.equal((await api(key, "POST", "/contacts", { email: "old-form@example.org" })).status, 201);
		assertError(await api(key, "GET", "/campaigns"), 403, "forbidden");
	});

	test("a full access key creates keys of either level, which work at their level", async () => {
		const user = await customer("key-maker@example.com");
		const created = await api(user.key, "POST", "/api-keys", { name: "Footer form", level: "signups" });
		assert.equal(created.status, 201);
		assert.match(created.body.key, /^mc_[A-Za-z0-9_-]{43}$/);
		assert.equal(created.body.apiKey.level, "signups");
		const stored = await m.ApiKey.findOne({ accountId: user.accountId, name: "Footer form" }).lean();
		assert.notEqual(stored.hash, created.body.key, "only the hash is stored");

		const listed = (await api(user.key, "GET", "/api-keys")).body.apiKeys;
		assert.equal(listed.find(({ name }) => name === "Footer form").isCurrent, false);
		assert.equal(listed.find(({ isCurrent }) => isCurrent).level, "full");
		assert.equal(listed.some((key) => "hash" in key || "key" in key), false);

		assert.equal((await api(created.body.key, "POST", "/contacts", { email: "footer@example.org" })).status, 201);
		assertError(await api(created.body.key, "GET", "/contacts"), 403, "forbidden");
		assert.equal((await api(user.key, "DELETE", `/api-keys/${created.body.apiKey.id}`)).status, 200);
		assertError(await api(created.body.key, "POST", "/contacts", { email: "late@example.org" }), 401, "unauthorized");
	});
});

describe("isolation through keys", () => {
	test("one account's key can't read or change another account's data", async () => {
		const alice = await customer("alice-api@example.com");
		const bob = await customer("bob-api@example.com");
		await importReaders(bob, 2);
		const bobCampaign = await draft(bob, { subject: "Bob's issue" });
		const bobContact = await m.Contact.findOne({ accountId: bob.accountId }).lean();
		const bobKeyId = (await api(bob.key, "GET", "/api-keys")).body.apiKeys[0].id;
		const snapshot = async () =>
			JSON.stringify(
				await Promise.all([
					m.Campaign.find({ accountId: bob.accountId }).lean(),
					m.Contact.find({ accountId: bob.accountId }).sort({ email: 1 }).lean(),
					m.ApiKey.find({ accountId: bob.accountId }).select("-lastUsedAt").lean(),
					m.Newsletter.find({ accountId: bob.accountId }).lean(),
				])
			);
		const before = await snapshot();

		const attempts = [
			["GET", `/campaigns/${bobCampaign}`],
			["PATCH", `/campaigns/${bobCampaign}`, { subject: "Hacked" }],
			["POST", `/campaigns/${bobCampaign}/send`],
			["POST", `/campaigns/${bobCampaign}/test`],
			["DELETE", `/campaigns/${bobCampaign}`],
			["GET", `/contacts/${bobContact._id}`],
			["GET", `/contacts/${encodeURIComponent(bobContact.email)}`],
			["PATCH", `/contacts/${bobContact._id}`, { status: "unsubscribed" }],
			["DELETE", `/contacts/${bobContact._id}`],
			["DELETE", `/contacts/${encodeURIComponent(bobContact.email)}?newsletter=${bob.slug}`],
			["GET", `/newsletters/${bob.slug}`],
			["PATCH", `/newsletters/${bob.newsletterId}`, { name: "Taken" }],
			["GET", `/contacts?newsletter=${bob.slug}`],
			["POST", "/contacts", { newsletter: bob.slug, email: "intruder@example.net" }],
			["POST", "/contacts/import", { newsletter: bob.slug, consent: true, contacts: [{ email: "spam@example.net" }] }],
			["DELETE", `/api-keys/${bobKeyId}`],
		];
		for (const [method, path, body] of attempts) {
			assertError(await api(alice.key, method, path, body), 404, "not_found");
		}
		assert.equal(await snapshot(), before, "nothing of Bob's changed");
		assert.equal(sesEmails.some(({ subject }) => subject?.includes("Bob's issue")), false);

		const lists = await Promise.all(["/campaigns", "/contacts", "/newsletters", "/api-keys", "/domains"].map((path) => api(alice.key, "GET", path)));
		assert.deepEqual(lists[0].body.campaigns, []);
		assert.deepEqual(lists[1].body.contacts, []);
		assert.deepEqual(lists[2].body.newsletters.map(({ slug }) => slug), [alice.slug]);
		assert.equal(lists[3].body.apiKeys.every(({ name }) => !name.includes("Bob")), true);
		assert.deepEqual(lists[4].body.domains, []);
	});
});

describe("errors", () => {
	test("input that breaks the schema is validation_failed, naming the field", async () => {
		const user = await customer("validation@example.com");
		assert.match(assertError(await api(user.key, "POST", "/campaigns", { subject: "x".repeat(201) }), 400, "validation_failed"), /^subject: /);
		assert.match(assertError(await api(user.key, "POST", "/campaigns", { format: "pdf", content: "x" }), 400, "validation_failed"), /^format: /);
		assert.match(assertError(await api(user.key, "GET", "/contacts?limit=500"), 400, "validation_failed"), /^limit: /);
		assertError(await api(user.key, "GET", "/contacts?cursor=nonsense"), 400, "validation_failed");
		const notJson = await callApi("POST", "/api/v1/campaigns", { key: user.key, headers: { "content-type": "application/json" } });
		assert.equal(notJson.status, 201, "an empty body is an empty object");
		for (const body of [[1, 2], "text"]) {
			assert.equal(assertError(await api(user.key, "POST", "/campaigns", body), 400, "validation_failed"), "Send a JSON object");
		}
	});

	test("missing things are not_found; a state that doesn't allow it is conflict", async () => {
		const user = await customer("states@example.com");
		assertError(await api(user.key, "GET", "/campaigns/000000000000000000000000"), 404, "not_found");
		assertError(await api(user.key, "GET", "/contacts/nobody@example.org"), 404, "not_found");
		const sent = await m.Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject: "Old", status: "sent" });
		assertError(await api(user.key, "DELETE", `/campaigns/${sent._id}`), 409, "conflict");
		assertError(await api(user.key, "PATCH", `/campaigns/${sent._id}`, { subject: "Rewrite history" }), 409, "conflict");
		assertError(await api(user.key, "POST", `/campaigns/${sent._id}/resume`), 409, "conflict");

		const deleted = await draft(user);
		assert.deepEqual((await api(user.key, "DELETE", `/campaigns/${deleted}`)).body, { id: deleted, deleted: true });
		assertError(await api(user.key, "GET", `/campaigns/${deleted}`), 404, "not_found");
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: deleted }).lean()).status, "canceled", "kept in the database");
	});

	test("each key has its own rate limit per action, and its account the same one across all its keys", async () => {
		const user = await customer("limits@example.com");
		for (let index = 0; index < 10; index += 1) {
			assert.equal((await api(user.key, "POST", "/api-keys", { name: `Key ${index}`, level: "signups" })).status, 201);
		}
		const limited = await api(user.key, "POST", "/api-keys", { name: "One too many", level: "signups" });
		assert.equal(assertError(limited, 429, "rate_limited"), "Too many create_api_key calls, try again later");
		const otherKey = await createKey(user, "full", "Another full key");
		const viaOtherKey = await api(otherKey, "POST", "/api-keys", { name: "Other key's", level: "signups" });
		assert.equal(assertError(viaOtherKey, 429, "rate_limited"), "Too many create_api_key calls on this account, try again later");
		const stranger = await customer("other-limits@example.com");
		assert.equal((await api(stranger.key, "POST", "/api-keys", { name: "Theirs", level: "signups" })).status, 201, "another account counts on its own");
	});

	test("an account without an active plan only reaches billing", async () => {
		const user = await customer("canceled-api@example.com");
		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
		assertError(await api(user.key, "GET", "/campaigns"), 402, "subscription_required");
		assertError(await api(user.signupsKey, "POST", "/contacts", { email: "late@example.org" }), 402, "subscription_required");
		const billing = await api(user.key, "GET", "/billing");
		assert.equal(billing.status, 200);
		assert.deepEqual({ status: billing.body.status, isActive: billing.body.isActive }, { status: "canceled", isActive: false });
	});
});

describe("sending through the API", () => {
	test("the dashboard's checks run: postal address, from address, plan limits, paused accounts", async () => {
		const user = await customer("checks-api@example.com", { limits: { emailsPerMonth: 2, subscribers: 100 }, postalAddress: "" });
		await importReaders(user, 3);
		const id = await draft(user);
		assert.equal((await api(user.key, "GET", `/campaigns/${id}`)).body.sendProblem.code, "send_check_failed");
		assert.equal(assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 422, "send_check_failed"), "Add a postal address to the newsletter");

		assert.equal((await api(user.key, "PATCH", `/newsletters/${user.slug}`, { postalAddress: "1 Main St, Paris" })).status, 200);
		assert.match(assertError(await api(user.key, "PATCH", `/newsletters/${user.slug}`, { fromEmail: "ceo@example.com" }), 422, "sender_not_allowed"), /example.com/);
		assert.equal((await api(user.key, "POST", "/domains", { domain: "checks-api.dev" })).status, 201);
		assert.equal((await api(user.key, "PATCH", `/newsletters/${user.slug}`, { fromEmail: "hi@checks-api.dev" })).status, 200, "a domain it added");
		assert.match(assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 422, "sender_not_allowed"), /isn't verified yet/);
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { fromEmail: `hello@${user.slug}.mailcheapmail.com` });

		assert.match(assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 402, "plan_limit_emails"), /needs 3 emails/);
		await m.accounts.setLimitOverrides(user.accountId, { emailsPerMonth: 100, subscribers: 2 });
		assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 402, "plan_limit_subscribers");
		await m.accounts.setLimitOverrides(user.accountId, { emailsPerMonth: 100, subscribers: 100 });
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });
		assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 403, "account_blocked");
		const later = new Date(Date.now() + 3_600_000).toISOString();
		assertError(await api(user.key, "POST", `/campaigns/${id}/schedule`, { scheduledAt: later }), 403, "account_blocked");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id }), 0, "nothing was queued");
	});

	test("sending twice answers conflict and sends nothing more", async () => {
		const user = await customer("double-send@example.com");
		await importReaders(user, 2);
		const id = await draft(user);
		const before = sesEmails.length;

		const first = await api(user.key, "POST", `/campaigns/${id}/send`);
		assert.equal(first.status, 200);
		assert.equal(first.body.status, "sending");
		assert.equal(first.body.stats.recipients, 2);
		assert.equal(assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 409, "conflict"), "This campaign is already sending");

		await runJobs();
		assert.equal(sesEmails.length - before, 2);
		assert.equal((await api(user.key, "GET", `/campaigns/${id}`)).body.status, "sent");
		assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 409, "conflict");
		await runJobs();
		assert.equal(sesEmails.length - before, 2, "still two emails");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, kind: "campaign" }), 2);

		const report = await api(user.key, "GET", `/campaigns/${id}/report`);
		assert.equal(report.body.campaign.stats.sent, 2);
		assert.equal(report.body.rates.delivered, 0, "no delivery events yet");
	});

	test("scheduling, unscheduling and test emails", async () => {
		const user = await customer("schedule-api@example.com");
		await importReaders(user, 1);
		const id = await draft(user);
		const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
		const scheduled = await api(user.key, "POST", `/campaigns/${id}/schedule`, { scheduledAt: at });
		assert.deepEqual({ status: scheduled.body.status, scheduledAt: scheduled.body.scheduledAt }, { status: "scheduled", scheduledAt: at });
		assert.equal((await api(user.key, "POST", `/campaigns/${id}/unschedule`)).body.status, "draft");
		assert.equal((await api(user.key, "POST", `/campaigns/${id}/unschedule`)).status, 200, "safe to repeat");
		assertError(await api(user.key, "POST", `/campaigns/${id}/schedule`, { scheduledAt: "tomorrow" }), 400, "validation_failed");

		const test = await api(user.key, "POST", `/campaigns/${id}/test`);
		assert.equal(test.body.sentTo, "schedule-api@example.com", "only the account owner gets tests");
		assert.equal(sesEmails.at(-1).to, "schedule-api@example.com");
		assert.match(sesEmails.at(-1).subject, /^\[Test\] /);
	});
});

describe("contacts", () => {
	test("import checks, cursor pages, status changes and the export link", async () => {
		const user = await customer("contacts-api@example.com");
		assert.equal(
			assertError(await api(user.key, "POST", "/contacts/import", { consent: false, contacts: [{ email: "a@example.org" }] }), 400, "validation_failed"),
			"Confirm that these people agreed to receive your emails"
		);
		const imported = await api(user.key, "POST", "/contacts/import", {
			consent: true,
			contacts: [
				...Array.from({ length: 5 }, (_, index) => ({ email: `person${index}@example.org`, subscribedAt: `2025-0${index + 1}-01T00:00:00Z` })),
				{ email: "info@example.org" },
				{ email: "x@mailinator.com" },
				{ email: "gone@example.org", status: "unsubscribed" },
			],
		});
		assert.deepEqual({ created: imported.body.created, role: imported.body.dropped.role, disposable: imported.body.dropped.disposable }, { created: 6, role: 1, disposable: 1 });
		const stored = await (await import("../models/ContactImport.js")).default.findOne({ accountId: user.accountId, _id: imported.body.importId }).lean();
		assert.equal(stored.source, "api");
		assert.ok(stored.apiKeyId, "the consent records the key");

		const seen = [];
		let cursor = null;
		do {
			const page = await api(user.key, "GET", `/contacts?status=active&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
			seen.push(...page.body.contacts.map(({ email }) => email));
			assert.equal(page.body.counts.active, 5);
			cursor = page.body.nextCursor;
		} while (cursor);
		assert.deepEqual(seen, ["person4@example.org", "person3@example.org", "person2@example.org", "person1@example.org", "person0@example.org"]);
		assert.deepEqual((await api(user.key, "GET", "/contacts?search=person1")).body.contacts.map(({ email }) => email), ["person1@example.org"]);

		const unsubscribed = await api(user.key, "PATCH", "/contacts/person0%40example.org", { status: "unsubscribed" });
		assert.equal(unsubscribed.body.status, "unsubscribed");
		assert.equal((await api(user.key, "PATCH", "/contacts/person0%40example.org", { status: "unsubscribed" })).status, 200, "safe to repeat");
		assertError(await api(user.key, "PATCH", "/contacts/person0%40example.org", { status: "active" }), 400, "validation_failed");
		assertError(await api(user.key, "PATCH", "/contacts/person0%40example.org", { status: "dormant", consent: true }), 409, "conflict");

		const exported = await api(user.key, "GET", "/contacts/export?status=active");
		assert.equal(exported.body.count, 4);
		const download = await m.exportRoute.GET(new Request(exported.body.url));
		assert.equal(download.headers.get("content-type"), "text/csv; charset=utf-8");
		const lines = (await download.text()).trim().split("\r\n");
		assert.equal(lines[0].split(",")[0], "email");
		assert.equal(lines.length, 5);
		const forged = new URL(exported.body.url);
		forged.searchParams.set("token", `${forged.searchParams.get("token").slice(0, -2)}xx`);
		assert.equal((await m.exportRoute.GET(new Request(forged))).status, 401);
	});

	test("signups from a site send the welcome email and answer browsers", async () => {
		const user = await customer("signups-api@example.com");
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { welcome: { enabled: true, subject: "Welcome", markdown: "Thanks." } });
		const before = sesEmails.length;
		const added = await api(user.signupsKey, "POST", "/contacts", { email: "new@example.org", ip: "203.0.113.9" });
		await flushAfter();
		assert.equal(added.status, 201);
		assert.equal(added.headers.get("access-control-allow-origin"), "*");
		assert.equal(sesEmails.length - before, 1);
		assert.equal(sesEmails.at(-1).subject, "Welcome");

		const preflight = await m.rest.handleRestPreflight(
			new Request("http://localhost:3000/api/v1/contacts", { method: "OPTIONS", headers: { "access-control-request-method": "POST" } }),
			["contacts"]
		);
		assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
		const elsewhere = m.rest.handleRestPreflight(new Request("http://localhost:3000/api/v1/campaigns", { method: "OPTIONS" }), ["campaigns"]);
		assert.equal(elsewhere.headers.get("access-control-allow-origin"), null, "full access endpoints don't answer browsers");
		assert.equal((await api(user.key, "GET", "/campaigns")).headers.get("access-control-allow-origin"), null);
	});

	test("the dashboard's Add contact takes the user's word that the person agreed: active at once, no confirmation email", async () => {
		const user = await customer("signups-dashboard@example.com");
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { welcome: { enabled: true, subject: "Welcome", markdown: "Thanks." } });
		const add = (email, fields = { consent: "on" }) =>
			as(user, () => m.contacts.addContact(null, form({ newsletterId: user.newsletterId, email, ...fields })));
		const before = sesEmails.length;

		for (const fields of [{}, { consent: "off" }, { consent: "true" }]) {
			assert.deepEqual(await add("unticked@example.org", fields), { error: "Check that this person agreed to get your emails" }, JSON.stringify(fields));
		}
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 0, "the server refuses it without the box");

		assert.deepEqual(await add("Hand@Example.org"), { email: "hand@example.org", status: "active" });
		await flushAfter();
		assert.equal(sesEmails.length - before, 1);
		assert.equal(sesEmails.at(-1).subject, "Welcome");
		assert.equal((await api(user.key, "GET", "/contacts/hand%40example.org")).body.source, "dashboard");
		const hand = await m.Contact.findOne({ accountId: user.accountId, email: "hand@example.org" }).lean();
		assert.equal(String(hand.consent.userId), String(user.userId), "the consent names who gave it");
		assert.ok(Date.now() - hand.consent.at < 60_000, "and when");
		assert.equal(hand.confirmedAt, undefined, "nobody clicked a confirmation link");
		assert.deepEqual(await add("hand@example.org"), { error: "hand@example.org is already a contact" });
		assert.deepEqual(await add("jane.doe@gmial.com"), { error: "Did you mean jane.doe@gmail.com?" });
		assert.deepEqual(await add("hand..doe@example.org"), { error: "email is invalid" });

		assert.equal((await saveSettingsForm(user, { confirmation: getConfirmationContent({ name: `${user.slug} news` }) })).ok, true);
		const fromSite = await api(user.signupsKey, "POST", "/contacts", { email: "site@example.org", consent: true, source: "dashboard" });
		assert.deepEqual([fromSite.status, fromSite.body.status], [201, "pending"], "an API signup still confirms, whatever its body says");
		await flushAfter();
		// Past the confirmation's resend window, where signing up again sends it again.
		await m.Message.collection.updateMany({ accountId: user.accountId, kind: "confirmation" }, { $set: { createdAt: new Date(Date.now() - 3_600_000) } });
		assert.deepEqual(await add("site@example.org"), { error: "site@example.org is already a contact" });
		assert.deepEqual(await add("later@example.org"), { email: "later@example.org", status: "active" }, "added by hand, it doesn't");
		await flushAfter();
		assert.deepEqual(
			sesEmails.slice(before + 1).map(({ subject }) => /^Confirm your subscription/.test(subject)),
			[true],
			"one confirmation email, for the API signup; the welcome email is off while signups confirm"
		);
		const stored = await m.Contact.find({ accountId: user.accountId, email: { $in: ["later@example.org", "site@example.org"] } }).sort({ email: 1 }).lean();
		assert.deepEqual(
			stored.map(({ email, status, consent }) => [email, status, Boolean(consent)]),
			[["later@example.org", "active", true], ["site@example.org", "pending", false]],
			"the pending contact stays as it was"
		);
	});

	test("the empty contacts page's request adds a contact once YOUR_API_KEY is a key", async () => {
		const user = await customer("curl-api@example.com");
		const curl = m.reference.getAddContactCurl("http://localhost:3000", user.slug);
		const [, method, url] = curl.match(/^curl -X ([A-Z]+) "([^"]+)"/);
		const { pathname } = new URL(url);
		assert.equal(m.rest.matchRoute(method, pathname.split("/").filter(Boolean).slice(2))?.action.name, "add_contact");
		const headers = Object.fromEntries(
			[...curl.matchAll(/-H "([^:]+): ([^"]+)"/g)].map(([, name, value]) => [name.toLowerCase(), value.replace("YOUR_API_KEY", user.signupsKey)])
		);
		const body = JSON.parse(curl.match(/-d '(.+)'$/)[1]);
		assert.deepEqual(body, { email: "jane@example.com", newsletter: user.slug });

		const added = await callApi(method, pathname, { headers, body });
		assert.equal(added.status, 201, JSON.stringify(added.body));
		assert.deepEqual({ email: added.body.email, newsletterId: added.body.newsletterId }, { email: "jane@example.com", newsletterId: user.newsletterId });
	});
});

describe("newsletters and images", () => {
	test("a newsletter update only changes the fields it sends", async () => {
		const user = await customer("settings-api@example.com");
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { welcome: { enabled: true, subject: "Hi", markdown: "Hello." } });
		const updated = await api(user.key, "PATCH", `/newsletters/${user.newsletterId}`, { welcome: { subject: "Hello there" }, replyTo: "Me@Example.org" });
		assert.deepEqual(updated.body.welcome, { enabled: true, subject: "Hello there", previewText: "", markdown: "Hello.", paused: false });
		assert.equal(updated.body.replyTo, "me@example.org");
		assert.equal(updated.body.postalAddress, "1 Main St, Paris");
		assert.equal(updated.body.fromEmail, `hello@${user.slug}.mailcheapmail.com`);
		assertError(await api(user.key, "PATCH", `/newsletters/${user.slug}`, { cleanup: { issues: 1 } }), 400, "validation_failed");
		for (const name of ["Second", "Third"]) assert.equal((await api(user.key, "POST", "/newsletters", { name })).status, 201, name);
		const fourth = assertError(await api(user.key, "POST", "/newsletters", { name: "Fourth" }), 409, "conflict");
		assert.equal(fourth, "An account has up to 3 newsletters");
	});

	test("a new newsletter starts with list cleanup on and the default numbers, unless it says false", async () => {
		const user = await customer("cleanup-new@example.com");
		const totals = { waiting: 0, kept: 0, dormant: 0 };
		const created = await api(user.key, "POST", "/newsletters", { name: "Cleaned up" });
		assert.equal(created.status, 201);
		assert.deepEqual(created.body.cleanup, { enabled: true, issues: 6, days: 180, ...totals });
		const declined = await api(user.key, "POST", "/newsletters", { name: "Left as is", cleanup: { enabled: false } });
		assert.equal(declined.status, 201);
		assert.deepEqual(declined.body.cleanup, { enabled: false, issues: 6, days: 180, ...totals });
	});

	test("saved newsletters keep list cleanup off through reads and saves that leave it out", async () => {
		const user = await customer("cleanup-saved@example.com");
		const now = new Date();
		await m.Newsletter.collection.insertOne({
			accountId: user.accountId,
			name: "No cleanup field",
			slug: "no-cleanup-field",
			fromEmail: "hello@no-cleanup-field.mailcheapmail.com",
			createdAt: now,
			updatedAt: now,
		});
		for (const id of [user.slug, "no-cleanup-field"]) {
			assert.equal((await api(user.key, "GET", `/newsletters/${id}`)).body.cleanup.enabled, false, id);
			const saved = await api(user.key, "PATCH", `/newsletters/${id}`, { cleanup: { days: 90 } });
			assert.deepEqual([saved.body.cleanup.enabled, saved.body.cleanup.days], [false, 90], id);
		}
	});

	test("a confirmation email saved as the settings form filled it in stays the built-in one, which follows later changes", async () => {
		const user = await customer("built-in-confirmation@example.com");
		const name = `${user.slug} news`;
		const filledIn = getConfirmationContent({ name, description: "One idea a week." });
		assert.equal((await saveSettingsForm(user, { description: "One idea a week.", confirmation: filledIn })).ok, true);
		const stored = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.deepEqual(stored.confirmation, { subject: "", previewText: "", markdown: "" }, "no copy of the built-in one");
		assert.equal((await api(user.key, "GET", `/newsletters/${user.slug}`)).body.confirmation.isCustom, false);

		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { description: "Two ideas a week." });
		const before = sesEmails.length;
		assert.equal((await api(user.signupsKey, "POST", "/contacts", { email: "pending@example.org" })).body.status, "pending");
		await flushAfter();
		assert.equal(sesEmails.length - before, 1);
		assert.ok(sesEmails.at(-1).text.includes(`You asked to get ${name}. Two ideas a week.`), "the confirmation email has the new description");

		const { subject, previewText, markdown } = (await api(user.key, "GET", `/newsletters/${user.slug}`)).body.confirmation;
		const renamed = await api(user.key, "PATCH", `/newsletters/${user.slug}`, { name: "Field notes", confirmation: { subject, previewText, markdown } });
		assert.equal(renamed.body.confirmation.isCustom, false, "read before the rename, it's still the built-in one");
		assert.equal(renamed.body.confirmation.subject, "Confirm your subscription to Field notes");
	});

	test("an edited confirmation email is stored and kept; one stored before stays through saves that leave it out", async () => {
		const user = await customer("own-confirmation@example.com");
		const builtIn = getConfirmationContent({ name: `${user.slug} news` });
		const edited = { ...builtIn, markdown: `${builtIn.markdown}\n\nP.S. Reply to say hi.` };
		assert.equal((await saveSettingsForm(user, { confirmation: edited })).ok, true);
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { description: "One idea a week." });
		const { confirmation } = (await api(user.key, "GET", `/newsletters/${user.slug}`)).body;
		assert.equal(confirmation.isCustom, true);
		assert.ok(confirmation.markdown.endsWith("P.S. Reply to say hi."));
		assert.ok(!confirmation.markdown.includes("One idea a week."), "the description doesn't change it");

		const { subject, previewText, markdown } = getConfirmationContent({ name: `${user.slug} news`, description: "One idea a week." });
		await m.Newsletter.updateOne({ accountId: user.accountId }, { $set: { confirmation: { subject, previewText, markdown } } });
		await api(user.key, "PATCH", `/newsletters/${user.slug}`, { postalAddress: "2 Main St, Paris" });
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).confirmation.markdown, markdown);
	});

	test("images upload as base64 or from a link, into the account's folder", async () => {
		const user = await customer("images-api@example.com");
		const fromFile = await api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName: "Cover.png" });
		assert.equal(fromFile.status, 201);
		assert.equal(fromFile.body.contentType, "image/png");
		assert.ok(fromFile.body.url.includes(`accounts/${user.accountId}/images/cover`));

		remoteImages.set("https://images.example.com/photo.png", PNG);
		const fromLink = await api(user.key, "POST", "/images", { url: "https://images.example.com/photo.png" });
		assert.equal(fromLink.status, 201);
		assert.equal(await m.Upload.countDocuments({ accountId: user.accountId }), 2);

		assertError(await api(user.key, "POST", "/images", { base64: Buffer.from("<svg/>").toString("base64") }), 400, "validation_failed");
		assertError(await api(user.key, "POST", "/images", {}), 400, "validation_failed");
		assertError(await api(user.key, "POST", "/images", { url: "https://images.example.com/missing.png" }), 400, "validation_failed");
	});

	test("with an S3 bucket, new images go there and are served from its CDN; older ones keep their URL", async () => {
		const user = await customer("images-s3@example.com");
		const before = await api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName: "Before.png" });
		const uploaded = await withEnv(S3_ENV, () =>
			api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName: "Cover.png" })
		);
		assert.equal(uploaded.status, 201);
		const object = s3Objects.at(-1);
		assert.match(object.Key, new RegExp(`^accounts/${user.accountId}/images/cover-[0-9a-f]{16}\\.png$`));
		assert.equal(object.ContentType, "image/png");
		assert.equal(object.CacheControl, "public, max-age=31536000, immutable");
		assert.equal(uploaded.body.url, `https://cdn.example.com/${object.Key}`);
		const stored = await m.Upload.findOne({ accountId: user.accountId, url: uploaded.body.url }).lean();
		assert.equal(stored.pathname, object.Key);

		const { images } = (await api(user.key, "GET", "/images")).body;
		assert.deepEqual(images.map(({ url }) => url), [uploaded.body.url, before.body.url], "the Blob image is still listed as it was");
	});

	test("an upload whose record can't be saved deletes its file, on S3 and on Vercel Blob, so no purge misses it", async (t) => {
		const user = await customer("images-unrecorded@example.com");
		t.mock.method(m.Upload, "create", async () => {
			throw new Error("MongoDB is unreachable");
		});
		t.mock.method(console, "error", () => {});
		const upload = () => api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName: "Cover.png" });
		const folder = `accounts/${user.accountId}/images/`;

		assertError(await withEnv(S3_ENV, upload), 500, "internal_error");
		assert.match(s3Deleted.at(-1).Key, new RegExp(`^${folder}cover-[0-9a-f]{16}\\.png$`));
		assert.equal(s3Objects.some(({ Key }) => Key.startsWith(folder)), false, "nothing stays on S3");

		assertError(await upload(), 500, "internal_error");
		const blob = blobStored.at(-1);
		assert.ok(blob.pathname.startsWith(`${folder}cover`));
		assert.equal(blobDeleted.at(-1), `https://blob.example.com/${blob.pathname}`, "nor on Vercel Blob");
		assert.equal(await m.Upload.countDocuments({ accountId: user.accountId }), 0);
	});

	test("list_images lists the account's images, newest first, a page at a time", async () => {
		const user = await customer("images-list@example.com");
		const other = await customer("images-other@example.com");
		await api(other.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName: "theirs.png" });
		const urls = [];
		for (const fileName of ["one.png", "two.png", "three.png"]) {
			urls.unshift((await api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64"), fileName })).body.url);
		}

		const first = await api(user.key, "GET", "/images?limit=2");
		assert.equal(first.status, 200);
		assert.deepEqual(first.body.images.map(({ url }) => url), urls.slice(0, 2));
		assert.deepEqual(Object.keys(first.body.images[0]).sort(), ["bytes", "contentType", "createdAt", "id", "url"]);
		assert.ok(first.body.nextCursor);
		const second = await api(user.key, "GET", `/images?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
		assert.deepEqual(second.body.images.map(({ url }) => url), urls.slice(2));
		assert.equal(second.body.nextCursor, null);

		assertError(await api(user.key, "GET", "/images?cursor=nope"), 400, "validation_failed");
		const theirs = await api(other.key, "GET", "/images");
		assert.equal(theirs.body.images.length, 1, "each account sees its own images");
	});

	test("without image storage, or with half of S3's settings, uploads answer unavailable and say what's missing", async () => {
		const user = await customer("images-off@example.com");
		const upload = () => api(user.key, "POST", "/images", { base64: Buffer.from(PNG).toString("base64") });
		const off = await withEnv({ BLOB_READ_WRITE_TOKEN: "" }, upload);
		assert.match(assertError(off, 503, "unavailable"), /IMAGES_S3_BUCKET.*BLOB_READ_WRITE_TOKEN/);
		const half = await withEnv({ IMAGES_S3_BUCKET: "mailcheap-images-test" }, upload);
		assert.match(assertError(half, 503, "unavailable"), /IMAGES_S3_ACCESS_KEY_ID, IMAGES_S3_SECRET_ACCESS_KEY, IMAGES_CDN_URL/);
		assert.equal(await m.Upload.countDocuments({ accountId: user.accountId }), 0);
	});
});
