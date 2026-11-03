import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { RESEND_ENV, createFakeResend, signResendWebhook } from "./helpers/resend.mjs";
import { published } from "./stubs/qstash.mjs";

// Resend as the provider, through the real actions and jobs, with the team answered in memory.
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

// A paying customer whose newsletter sends from its own domain, verified at Resend.
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

function postWebhook(event, headers = signResendWebhook(JSON.stringify(event))) {
	return m.webhookRoute.POST(
		new Request("http://localhost:3000/api/webhooks/resend", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(event),
		})
	);
}

// The webhook event for an email the fake sent, with the tags it was sent with, as Resend posts them.
function eventFor(sent, type, data = {}) {
	return {
		type,
		created_at: new Date().toISOString(),
		data: {
			email_id: sent.id,
			from: sent.body.from,
			to: sent.body.to,
			subject: sent.body.subject,
			created_at: new Date().toISOString(),
			tags: Object.fromEntries(sent.body.tags.map(({ name, value }) => [name, value])),
			...data,
		},
	};
}

before(async () => {
	app = await startTestApp({ ...RESEND_ENV, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	fake = createFakeResend();
	fake.install();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		webhookRoute: await import("../app/api/webhooks/resend/route.js"),
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

describe("Resend domains", () => {
	test("an own domain is added to the team with Resend's tracking off, and its records show with full names", async () => {
		const user = await signIn("rs-domain@example.com");
		await activate(user);
		const domain = await addDomain(user, "news.rs-domain.dev");

		const added = fake.findDomain("news.rs-domain.dev");
		assert.equal(added.openTracking, false, "MailCheap tracks opens itself");
		assert.equal(added.clickTracking, false, "and clicks");
		assert.equal(added.returnPath, "send");
		assert.equal(domain.provider, "resend");
		assert.equal(domain.providerDomainId, added.id);
		assert.equal(domain.mailFromDomain, "send.news.rs-domain.dev");
		assert.equal(domain.verified, false);
		assert.deepEqual(
			domain.records.map(({ purpose, type, name, value }) => [purpose, type, name, type === "TXT" && purpose === "dkim" ? "key" : value]),
			[
				["dkim", "TXT", "resend._domainkey.news.rs-domain.dev", "key"],
				["mail-from", "MX", "send.news.rs-domain.dev", "10 feedback-smtp.us-east-1.amazonses.com"],
				["mail-from", "TXT", "send.news.rs-domain.dev", "v=spf1 include:amazonses.com ~all"],
			]
		);

		fake.verifyDomain("news.rs-domain.dev");
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: true });
		assert.ok(fake.state.calls.some(({ method, path }) => method === "POST" && path === `/domains/${added.id}/verify`), "Check now asks Resend to look again");
	});

	test("a domain the team already has, like EMAIL_FROM's, can't be taken over by an account", async () => {
		const user = await signIn("rs-existing@example.com");
		await activate(user);
		fake.state.domains.set("dom_owner", { id: "dom_owner", name: "rs-existing.dev", verified: true, dkim: "p=owner" });
		const result = await as(user, () => m.domains.addDomainAction(null, form({ domain: "rs-existing.dev" })));
		assert.notEqual(result.ok, true);
		assert.equal(await m.Domain.exists({ accountId: user.accountId, domain: "rs-existing.dev" }), null, "no claim, no provider id");
		assert.ok(fake.findDomain("rs-existing.dev"), "the owner's domain stays on the team");
	});

	test("removing a domain removes it from the team", async () => {
		const user = await signIn("rs-remove@example.com");
		await activate(user);
		const domain = await addDomain(user, "rs-remove.dev");
		assert.deepEqual(await as(user, () => m.domains.removeDomainAction(String(domain._id))), { ok: true, removed: "rs-remove.dev" });
		assert.equal(fake.findDomain("rs-remove.dev"), null);
	});
});

describe("Resend sending", () => {
	test("test emails carry the account and message in tags, the message id as Idempotency-Key, and Resend's id is kept", async () => {
		const user = await customer("rs-test@example.com", "rs-test");
		const id = await draft(user, "Issue 7");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });

		const message = await m.Message.findOne({ accountId: user.accountId, kind: "test" }).lean();
		const sent = fake.state.emails.at(-1);
		assert.equal(sent.key, String(message._id));
		assert.equal(sent.body.from, '"Jane" <hello@rs-test.dev>');
		assert.deepEqual(sent.body.to, ["rs-test@example.com"]);
		assert.equal(sent.body.subject, "[Test] Issue 7");
		assert.match(sent.body.headers["List-Unsubscribe"], /\/api\/unsubscribe\?token=/);
		assert.equal(sent.body.headers["Feedback-ID"], `${id}:mc-${user.accountId}:test:mailcheap`);
		assert.deepEqual(sent.body.tags, [
			{ name: "message_id", value: String(message._id) },
			{ name: "account_id", value: String(user.accountId) },
			{ name: "kind", value: "test" },
			{ name: "campaign_id", value: id },
		]);
		assert.equal(message.providerMessageId, sent.id);
		assert.equal(message.status, "sent");
	});

	test("a campaign goes out one email at a time, and MailCheap's own emails still go out apart", async () => {
		const user = await customer("rs-campaign@example.com", "rs-campaign");
		const before = fake.state.emails.length;
		const id = await sendCampaign(user, ["one@example.org", "two@example.org"], "Weekly");
		await runJobs();

		assert.deepEqual(fake.state.emails.slice(before).map(({ body }) => body.to[0]).sort(), ["one@example.org", "two@example.org"]);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
		assert.ok(platformEmails.some(({ to }) => to.includes("rs-campaign@example.com")), "the sign-in code went through the recorded Resend call");
	});

	test("Resend's rate limit puts the batch back for after its retry-after, and nothing is lost", async () => {
		const user = await customer("rs-limit@example.com", "rs-limit");
		const id = await sendCampaign(user, ["limit1@example.org", "limit2@example.org"], "Limited");
		fake.fail({ method: "POST", path: /^\/emails$/, status: 429, headers: { "retry-after": "120" }, body: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } });
		const response = await runNextJob();
		assert.equal((await response.json()).republished, true);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2);
		assert.ok(published.at(-1).notBefore >= Math.floor(Date.now() / 1000) + 110);

		await runJobs();
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "sent" }), 2);
	});

	test("a from domain Resend doesn't have verified pauses the campaign with the reason", async () => {
		const user = await customer("rs-unverified@example.com", "rs-unverified");
		const id = await sendCampaign(user, ["reader@example.org"], "Paused");
		fake.findDomain("rs-unverified.dev").verified = false;
		await runJobs();
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.match(campaign.pauseReason, /not verified/);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "kept for the resume");
	});
});

describe("Resend events", () => {
	test("a delivery then a hard bounce mark the email and keep the address out of the account's next sends", async () => {
		const user = await customer("rs-bounce@example.com", "rs-bounce");
		const id = await sendCampaign(user, ["bounce@example.org"], "Bounced");
		await runJobs();
		const sent = fake.state.emails.at(-1);

		for (const [type, data] of [["email.delivered"], ["email.bounced", { bounce: { type: "Permanent", subType: "NoEmail", message: "The recipient's mailbox doesn't exist" } }]]) {
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

	test("an address the team suppresses fails the email without becoming the account's own suppression", async () => {
		const user = await customer("rs-team@example.com", "rs-team");
		const id = await sendCampaign(user, ["elsewhere@example.org"], "Team");
		await runJobs();
		const sent = fake.state.emails.at(-1);
		await postWebhook(eventFor(sent, "email.suppressed", { suppressed: { type: "OnAccountSuppressionList", message: "Another email to it bounced" } }));

		const message = await m.Message.findOne({ accountId: user.accountId, campaignId: id }).lean();
		assert.equal(message.status, "failed");
		assert.match(message.error, /Suppressed by Resend/);
		assert.equal(await m.Suppression.exists({ accountId: user.accountId, email: "elsewhere@example.org" }), null);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "elsewhere@example.org" }).lean()).status, "active");
	});

	test("an event naming another account in its tags changes nothing, and a forged or missing signature is refused", async () => {
		const owner = await customer("rs-owner@example.com", "rs-owner");
		const other = await customer("rs-other@example.com", "rs-other");
		await sendCampaign(owner, ["mine@example.org"], "Mine");
		await runJobs();
		const sent = fake.state.emails.at(-1);
		const forged = eventFor(sent, "email.complained");
		forged.data.tags.account_id = String(other.accountId);
		await postWebhook(forged);
		const isSuppressed = async () =>
			Boolean((await m.Suppression.exists({ accountId: owner.accountId, email: "mine@example.org" })) || (await m.Suppression.exists({ accountId: other.accountId, email: "mine@example.org" })));
		assert.equal(await isSuppressed(), false);

		const event = eventFor(sent, "email.complained");
		const body = JSON.stringify(event);
		const signedElsewhere = signResendWebhook(body, { secret: `whsec_${Buffer.from("someone-else").toString("base64")}` });
		assert.equal((await postWebhook(event, signedElsewhere)).status, 401);
		assert.equal((await postWebhook(event, {})).status, 401);
		assert.equal(await isSuppressed(), false);
	});

	test("Resend redelivering an event counts it once", async () => {
		const user = await customer("rs-replay@example.com", "rs-replay");
		const id = await sendCampaign(user, ["replay@example.org"], "Replay");
		await runJobs();
		const event = eventFor(fake.state.emails.at(-1), "email.complained");
		const headers = signResendWebhook(JSON.stringify(event));
		await postWebhook(event, headers);
		await postWebhook(event, { ...headers });
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.stats.complained, 1);
	});
});

test("the admin page shows the rate MailCheap keeps to on Resend", async () => {
	const { lanes } = await m.capacity.getSendingCapacity();
	assert.deepEqual(lanes.map(({ label, meters, perSecond }) => ({ label, meters, perSecond })), [{ label: "All emails", meters: [], perSecond: 14 }]);
});
