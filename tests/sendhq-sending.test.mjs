import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { SENDHQ_ENV, createFakeSendhq, signSendhqWebhook } from "./helpers/sendhq.mjs";
import { published } from "./stubs/qstash.mjs";

// SendHQ as the provider, through the real actions and jobs, with the workspace answered in memory.
let app;
let fake;
let m;
let processed = 0;

async function runNextJob() {
	const { url, body } = published[processed++];
	return url.endsWith("/api/jobs/send-batch") ? m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body })) : null;
}

async function runJobs() {
	while (processed < published.length) await runNextJob();
}

async function createNewsletter(user, slug) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, fromName: "Jane", postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
}

function saveFrom(user, fromEmail) {
	return as(user, () =>
		m.newsletters.saveNewsletter(null, form({ id: user.newsletterId, name: user.slug, slug: user.slug, fromName: "Jane", fromEmail, postalAddress: "1 Main St, Paris" }))
	);
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

async function addDomain(user, domain) {
	assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain }))), { ok: true, domain });
	return m.Domain.findOne({ accountId: user.accountId, domain }).lean();
}

// A paying customer whose newsletter sends from its own domain, verified at SendHQ.
async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	await createNewsletter(user, slug);
	const domain = await addDomain(user, `${slug}.dev`);
	fake.verifyDomain(domain.domain);
	assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: true });
	assert.equal((await saveFrom(user, `hello@${domain.domain}`)).ok, true);
	return user;
}

async function importContacts(user, emails) {
	await as(user, () =>
		m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: emails.map((email) => ({ email, status: "active" })) })
	);
}

async function sendCampaign(user, emails, subject) {
	await importContacts(user, emails);
	const id = await draft(user, subject);
	assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
	return id;
}

function postWebhook(event, headers = signSendhqWebhook(JSON.stringify(event))) {
	return m.webhookRoute.POST(
		new Request("http://localhost:3000/api/webhooks/sendhq", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(event),
		})
	);
}

// The webhook event for an email the fake sent, as SendHQ posts it.
function eventFor(sent, type, data = {}) {
	return {
		type,
		created_at: new Date().toISOString(),
		data: { email_id: sent.id, from: sent.body.from, to: sent.body.to, subject: sent.body.subject, ...data },
	};
}

before(async () => {
	app = await startTestApp({ ...SENDHQ_ENV, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	fake = createFakeSendhq();
	fake.install();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		webhookRoute: await import("../app/api/webhooks/sendhq/route.js"),
		capacity: await import("../lib/sending-capacity.js"),
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

afterEach(() => fake.state.failures.splice(0));

after(() => app?.stop());

describe("SendHQ domains", () => {
	test("an own domain is added to the workspace, with its DKIM records and SendHQ's own return path", async () => {
		const user = await signIn("sq-domain@example.com");
		await activate(user);
		const domain = await addDomain(user, "news.sq-domain.dev");

		const added = fake.findDomain("news.sq-domain.dev");
		assert.equal(domain.provider, "sendhq");
		assert.equal(domain.providerDomainId, added.id);
		assert.equal(domain.mailFromDomain, "amazonses.com");
		assert.equal(domain.verified, false);

		fake.verifyDomain("news.sq-domain.dev");
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: true });
		assert.ok(fake.state.calls.some(({ method, path }) => method === "POST" && path === `/domains/${added.id}/verify`), "Check now asks SendHQ to look again");
		const checked = await m.Domain.findOne({ accountId: user.accountId, _id: domain._id }).lean();
		assert.deepEqual(
			checked.records.map(({ purpose, type, name, value }) => [purpose, type, name, value]),
			added.tokens.map((token) => ["dkim", "CNAME", `${token}._domainkey.news.sq-domain.dev`, `${token}.dkim.amazonses.com`])
		);
		assert.equal(checked.mailFromStatus, "SUCCESS");
	});

	test("a domain already in a SendHQ workspace, like EMAIL_FROM's, can't be taken over by an account", async () => {
		const user = await signIn("sq-existing@example.com");
		await activate(user);
		fake.state.domains.set("dom_owner", { id: "dom_owner", name: "sq-existing.dev", verified: true, tokens: ["owner1", "owner2", "owner3"] });
		const result = await as(user, () => m.domains.addDomainAction(null, form({ domain: "sq-existing.dev" })));
		assert.notEqual(result.ok, true);
		assert.equal(await m.Domain.exists({ accountId: user.accountId, domain: "sq-existing.dev" }), null, "no claim, no provider id");
		assert.ok(fake.findDomain("sq-existing.dev"), "the owner's domain stays in the workspace");
	});

	test("removing a domain removes it from the workspace", async () => {
		const user = await signIn("sq-remove@example.com");
		await activate(user);
		const domain = await addDomain(user, "sq-remove.dev");
		assert.deepEqual(await as(user, () => m.domains.removeDomainAction(String(domain._id))), { ok: true, removed: "sq-remove.dev" });
		assert.equal(fake.findDomain("sq-remove.dev"), null);
	});
});

describe("SendHQ sending", () => {
	test("test emails go out as transactional with the message id as Idempotency-Key, and SendHQ's email id is kept", async () => {
		const user = await customer("sq-test@example.com", "sq-test");
		const id = await draft(user, "Issue 7");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });

		const message = await m.Message.findOne({ accountId: user.accountId, kind: "test" }).lean();
		const sent = fake.state.emails.at(-1);
		assert.equal(sent.key, String(message._id));
		assert.equal(sent.body.from, '"Jane" <hello@sq-test.dev>');
		assert.deepEqual(sent.body.to, ["sq-test@example.com"]);
		assert.equal(sent.body.subject, "[Test] Issue 7");
		assert.equal(sent.body.message_class, "transactional");
		assert.match(sent.body.headers["List-Unsubscribe"], /\/api\/unsubscribe\?token=/);
		assert.equal(sent.body.headers["Feedback-ID"], `${id}:mc-${user.accountId}:test:mailcheap`);
		assert.equal(message.providerMessageId, sent.id);
		assert.equal(message.status, "sent");
	});

	test("a campaign goes out as marketing, one email at a time, and MailCheap's own emails still go out apart", async () => {
		const user = await customer("sq-campaign@example.com", "sq-campaign");
		const before = fake.state.emails.length;
		const id = await sendCampaign(user, ["one@example.org", "two@example.org"], "Weekly");
		await runJobs();

		const sent = fake.state.emails.slice(before);
		assert.deepEqual(sent.map(({ body }) => body.to[0]).sort(), ["one@example.org", "two@example.org"]);
		assert.ok(sent.every(({ body }) => body.message_class === "marketing"));
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
		assert.ok(platformEmails.some(({ to }) => to.includes("sq-campaign@example.com")), "the sign-in code went through the recorded Resend call");
	});

	test("SendHQ's daily volume limit puts the batch back for an hour, and nothing is lost", async () => {
		const user = await customer("sq-limit@example.com", "sq-limit");
		const id = await sendCampaign(user, ["limit1@example.org", "limit2@example.org"], "Limited");
		fake.fail({
			method: "POST",
			path: /^\/emails$/,
			status: 429,
			message: "This account is too new to send this volume of email. Your limit increases automatically as your account builds a sending history.",
		});
		const response = await runNextJob();
		assert.equal((await response.json()).republished, true);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2);
		assert.ok(published.at(-1).notBefore >= Math.floor(Date.now() / 1000) + 3500);

		await runJobs();
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "sent" }), 2);
	});

	test("a from domain SendHQ doesn't have verified pauses the campaign with the reason", async () => {
		const user = await customer("sq-unverified@example.com", "sq-unverified");
		const id = await sendCampaign(user, ["reader@example.org"], "Paused");
		fake.findDomain("sq-unverified.dev").verified = false;
		await runJobs();
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.match(campaign.pauseReason, /not verified/);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "kept for the resume");
	});

	test("an address on the workspace's suppression list fails that email without becoming the account's suppression", async () => {
		const user = await customer("sq-listed@example.com", "sq-listed");
		const id = await sendCampaign(user, ["listed@example.org"], "Listed");
		fake.fail({ method: "POST", path: /^\/emails$/, status: 422, message: "Blocked: recipient(s) on the suppression list: listed@example.org. Remove them via the dashboard to override." });
		await runJobs();
		const message = await m.Message.findOne({ accountId: user.accountId, campaignId: id }).lean();
		assert.equal(message.status, "failed");
		assert.equal(await m.Suppression.exists({ accountId: user.accountId, email: "listed@example.org" }), null);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "listed@example.org" }).lean()).status, "active");
	});
});

describe("SendHQ events", () => {
	test("a delivery then a hard bounce mark the email and keep the address out of the account's next sends", async () => {
		const user = await customer("sq-bounce@example.com", "sq-bounce");
		const id = await sendCampaign(user, ["bounce@example.org"], "Bounced");
		await runJobs();
		const sent = fake.state.emails.at(-1);

		const events = [
			["email.delivered", { recipients: ["bounce@example.org"] }],
			["email.bounced", { recipient: "bounce@example.org", bounce: { type: "Permanent", sub_type: "NoEmail", diagnostic: "550 5.1.1 No such user", suppressed: true } }],
		];
		for (const [type, data] of events) {
			const response = await postWebhook(eventFor(sent, type, data));
			assert.deepEqual(await response.json(), { ok: true, handled: 1 }, type);
		}
		const message = await m.Message.findOne({ accountId: user.accountId, campaignId: id }).lean();
		assert.equal(message.status, "bounced");
		assert.ok(message.deliveredAt);
		const suppression = await m.Suppression.findOne({ accountId: user.accountId, email: "bounce@example.org" }).lean();
		assert.equal(suppression.reason, "bounce");
		assert.equal(suppression.detail, "Permanent/NoEmail");
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "bounce@example.org" }).lean()).status, "bounced");
	});

	test("an address the provider's shared list suppresses fails the email without becoming the account's own suppression", async () => {
		const user = await customer("sq-shared@example.com", "sq-shared");
		const id = await sendCampaign(user, ["elsewhere@example.org"], "Shared");
		await runJobs();
		const sent = fake.state.emails.at(-1);
		await postWebhook(eventFor(sent, "email.bounced", { recipient: "elsewhere@example.org", bounce: { type: "Permanent", sub_type: "OnAccountSuppressionList", suppressed: true } }));

		const message = await m.Message.findOne({ accountId: user.accountId, campaignId: id }).lean();
		assert.equal(message.status, "failed");
		assert.match(message.error, /Suppressed by SendHQ's provider/);
		assert.equal(await m.Suppression.exists({ accountId: user.accountId, email: "elsewhere@example.org" }), null);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "elsewhere@example.org" }).lean()).status, "active");
	});

	test("an event naming an email no account sent changes nothing, and a forged or missing signature is refused", async () => {
		const owner = await customer("sq-owner@example.com", "sq-owner");
		await sendCampaign(owner, ["mine@example.org"], "Mine");
		await runJobs();
		const sent = fake.state.emails.at(-1);
		const isSuppressed = async () => Boolean(await m.Suppression.exists({ accountId: owner.accountId, email: "mine@example.org" }));

		const unknown = eventFor({ ...sent, id: "em_unknown" }, "email.complained", { recipient: "mine@example.org" });
		assert.deepEqual(await (await postWebhook(unknown)).json(), { ok: true, handled: 1 });
		assert.equal(await isSuppressed(), false);

		const event = eventFor(sent, "email.complained", { recipient: "mine@example.org" });
		const body = JSON.stringify(event);
		const signedElsewhere = signSendhqWebhook(body, { secret: `whsec_${Buffer.from("someone-else").toString("base64")}` });
		assert.equal((await postWebhook(event, signedElsewhere)).status, 401);
		assert.equal((await postWebhook(event, {})).status, 401);
		assert.equal(await isSuppressed(), false);
	});

	test("SendHQ redelivering an event counts it once", async () => {
		const user = await customer("sq-replay@example.com", "sq-replay");
		const id = await sendCampaign(user, ["replay@example.org"], "Replay");
		await runJobs();
		const event = eventFor(fake.state.emails.at(-1), "email.complained", { recipient: "replay@example.org", complaint: { feedback_type: "abuse" } });
		const headers = signSendhqWebhook(JSON.stringify(event));
		await postWebhook(event, headers);
		await postWebhook(event, { ...headers });
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.stats.complained, 1);
	});
});

test("the admin page shows the rate MailCheap keeps to on SendHQ", async () => {
	const { lanes } = await m.capacity.getSendingCapacity();
	assert.deepEqual(lanes.map(({ label, meters, perSecond }) => ({ label, meters, perSecond })), [{ label: "All emails", meters: [], perSecond: 14 }]);
});
