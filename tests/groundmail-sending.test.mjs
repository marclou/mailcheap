import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { GROUNDMAIL_ENV, createFakeGroundmail, signGroundmailEvent } from "./helpers/groundmail.mjs";
import { published } from "./stubs/qstash.mjs";

// Groundmail as the provider, through the real actions, jobs and webhook, with Groundmail answered in memory.
let app;
let fake;
let m;
let processed = 0;
let visitors = 0;

async function runNextJob() {
	const { url, body } = published[processed++];
	return url.endsWith("/api/jobs/send-batch") ? m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body })) : null;
}

async function runJobs() {
	while (processed < published.length) await runNextJob();
}

const subscription = (id) => ({
	id: `sub_${id}`,
	status: "active",
	customer: `cus_${id}`,
	items: { data: [{ price: { lookup_key: "starter_month" }, current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
});

async function loadAccount(user) {
	return m.Account.findById(user.accountId).lean();
}

async function createNewsletter(user, slug, fields = {}) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, fromName: "Jane", postalAddress: "1 Main St, Paris", ...fields })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello {{ name }}</p>" }));
	return id;
}

async function importContacts(user, emails) {
	await as(user, () =>
		m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: emails.map((email) => ({ email, status: "active" })) })
	);
}

async function verifyOwnDomain(user, domain) {
	fake.publishDns(domain);
	const stored = await m.Domain.findOne({ accountId: user.accountId, domain }).lean();
	assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(stored._id))), { ok: true, verified: true });
}

// A paying customer whose newsletter sends from its own domain, verified at Groundmail. Without a shared domain, a
// newsletter's from address is on one of the account's domains from the start.
async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	const domain = `${slug}.dev`;
	assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain }))), { ok: true, domain });
	await verifyOwnDomain(user, domain);
	await createNewsletter(user, slug, { fromEmail: `hello@${domain}` });
	user.account = await loadAccount(user);
	return user;
}

function postWebhook(event, { header } = {}) {
	const signed = signGroundmailEvent(event);
	return m.webhookRoute.POST(
		new Request("http://localhost:3000/api/webhooks/groundmail", {
			method: "POST",
			headers: { "content-type": "application/json", "groundmail-signature": header ?? signed.header },
			body: signed.body,
		})
	);
}

function emailEvent(type, sent, data = {}) {
	return {
		type,
		created_at: new Date().toISOString(),
		data: {
			email_id: sent.response.id,
			to: [sent.body.to],
			from: sent.body.from.email,
			subject: sent.body.subject,
			status: type.split(".")[1],
			bounce_reason: null,
			bounce_type: null,
			tags: sent.body.tags ?? [],
			...(sent.tenant && { tenant: sent.tenant }),
			...data,
		},
	};
}

before(async () => {
	app = await startTestApp({ ...GROUNDMAIL_ENV, SHARED_DOMAIN: "", QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	fake = createFakeGroundmail();
	fake.install();
	m = {
		signin: await import("../app/signin/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		contactsLib: await import("../lib/contacts.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		domainsLib: await import("../lib/domains.js"),
		admin: await import("../app/admin/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		webhookRoute: await import("../app/api/webhooks/groundmail/route.js"),
		billing: await import("../lib/billing.js"),
		tenants: await import("../lib/tenants.js"),
		providers: await import("../lib/email-provider/index.js"),
		capacity: await import("../lib/sending-capacity.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

// A failure a test set up and didn't reach never lands on the next one.
afterEach(() => {
	fake.state.failures.splice(0);
	fake.state.isTenantsEnabled = true;
	fake.state.isNewsletterEnabled = true;
});

after(() => app?.stop());

describe("Groundmail tenants", () => {
	test("a plan starting creates one tenant named after the account, and the admin page describes it", async () => {
		const user = await signIn("gm-tenant@example.com");
		await m.billing.applySubscription(await loadAccount(user), subscription("gm-tenant"));
		await m.billing.applySubscription(await loadAccount(user), subscription("gm-tenant"));

		const externalId = `mc-${user.accountId}`;
		const tenant = fake.findTenant(externalId);
		assert.ok(tenant);
		assert.equal(fake.callsTo("POST", /^\/tenants$/).filter(({ body }) => body.external_id === externalId).length, 1, "only once");
		const { groundmail } = await loadAccount(user);
		assert.deepEqual([groundmail.tenantId, groundmail.externalId, groundmail.tenantStatus], [tenant.id, externalId, "active"]);
		assert.ok(groundmail.provisionedAt);

		const provider = m.providers.getEmailProvider();
		assert.deepEqual([provider.id, provider.name, provider.returnPathPrefix], ["groundmail", "Groundmail", "rp"]);
		assert.deepEqual(provider.describeTenant(await loadAccount(user)), { id: externalId, status: "active", detail: null });
		assert.equal(provider.describeTenant({}), null);
		assert.deepEqual(await m.capacity.getSendingCapacity({ fresh: true }), { error: "unreported" }, "Groundmail has no shared caps to show");
	});

	test("a tenant an earlier attempt created is found by its external id, with no second one", async () => {
		const user = await signIn("gm-retry@example.com");
		await m.billing.applySubscription(await loadAccount(user), subscription("gm-retry"));
		const { tenantId } = (await loadAccount(user)).groundmail;
		// A lost write: Groundmail has the tenant, MailCheap forgot it.
		await m.Account.updateOne({ _id: user.accountId }, { $unset: { groundmail: 1 } });
		await m.tenants.provisionTenant(user.accountId);
		assert.equal((await loadAccount(user)).groundmail.tenantId, tenantId);
		assert.equal([...fake.state.tenants.values()].filter(({ external_id }) => external_id === `mc-${user.accountId}`).length, 1);
	});

	test("without tenants at Groundmail, accounts send as the Groundmail account, and get a tenant once Groundmail has them", async () => {
		fake.state.isTenantsEnabled = false;
		const alerts = () => platformEmails.filter(({ subject }) => /tenant not created/.test(subject)).length;
		const alertsBefore = alerts();
		const user = await signIn("gm-no-tenants@example.com");
		await m.billing.applySubscription(await loadAccount(user), subscription("gm-no-tenants"));
		assert.equal((await loadAccount(user)).groundmail, undefined);
		assert.equal(alerts(), alertsBefore, "not a failure");

		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "gm-no-tenants.dev" }))), { ok: true, domain: "gm-no-tenants.dev" });
		assert.equal(fake.findDomain("gm-no-tenants.dev").tenant, null, "the Groundmail account's");
		await verifyOwnDomain(user, "gm-no-tenants.dev");
		await createNewsletter(user, "gm-no-tenants", { fromEmail: "hello@gm-no-tenants.dev" });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		const sent = fake.state.emails.at(-1);
		assert.equal(sent.body.tenant, undefined);
		assert.equal(sent.body.category, "newsletter");

		const admin = await signIn("admin@example.com");
		const pausesBefore = fake.callsTo("PATCH", /^\/tenants\//).length;
		assert.deepEqual(await as(admin, () => m.admin.blockAccountAction(String(user.accountId), "Review")), { ok: true });
		assert.equal(fake.callsTo("PATCH", /^\/tenants\//).length, pausesBefore, "nothing to pause: MailCheap's block stops its sends");
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });

		fake.state.isTenantsEnabled = true;
		await m.tenants.provisionTenant(user.accountId);
		const { groundmail } = await loadAccount(user);
		assert.equal(groundmail.externalId, `mc-${user.accountId}`);
		assert.equal(fake.findDomain("gm-no-tenants.dev").tenant, groundmail.externalId, "its domain moves into its tenant");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.equal(fake.state.emails.at(-1).body.tenant, groundmail.externalId);
	});
});

describe("Groundmail domains", () => {
	test("an own domain gets Groundmail's records in the account's tenant, and verifies once they're in DNS", async () => {
		const user = await signIn("gm-domain@example.com");
		await activate(user);
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "letters.dev" }))), { ok: true, domain: "letters.dev" });
		const domain = await m.Domain.findOne({ accountId: user.accountId }).lean();
		const atGroundmail = fake.findDomain("letters.dev");
		assert.equal(atGroundmail.tenant, `mc-${user.accountId}`, "in the account's own tenant");
		assert.deepEqual([domain.provider, domain.providerDomainId, domain.mailFromDomain], ["groundmail", atGroundmail.id, "rp.letters.dev"]);
		assert.deepEqual(domain.records, [
			{ purpose: "dkim", type: "TXT", name: "_groundmail.letters.dev", value: `groundmail-verify=${atGroundmail.id}` },
			{ purpose: "dkim", type: "TXT", name: "gm1._domainkey.letters.dev", value: `v=DKIM1; t=s; h=sha256; p=MIIB${atGroundmail.id}` },
			{ purpose: "mail-from", type: "CNAME", name: "rp.letters.dev", value: "rp.groundmail.test" },
			{ purpose: "mail-from", type: "TXT", name: "letters.dev", value: "v=spf1 include:spf.groundmail.test ~all" },
		]);
		assert.deepEqual([domain.verified, domain.dkimStatus, domain.mailFromStatus], [false, "PENDING", "PENDING"]);

		// Groundmail doesn't look at DNS on its own: the Domains page asks it, once a minute at most.
		const verifyCalls = () => fake.callsTo("POST", new RegExp(`^/domains/${atGroundmail.id}$`)).length;
		fake.publishDns("letters.dev");
		await m.Domain.updateOne({ accountId: user.accountId, _id: domain._id }, { $set: { checkedAt: new Date(Date.now() - 120_000), readAt: new Date(Date.now() - 120_000) } });
		const before = verifyCalls();
		const [refreshed] = await m.domainsLib.refreshDomains(await loadAccount(user), [await m.Domain.findOne({ accountId: user.accountId, _id: domain._id }).lean()]);
		assert.equal(verifyCalls(), before + 1);
		assert.deepEqual([refreshed.verified, refreshed.dkimStatus, refreshed.mailFromStatus], [true, "SUCCESS", "SUCCESS"]);
		assert.equal((await m.domainsLib.refreshDomains(await loadAccount(user), [refreshed]))[0], refreshed, "a verified domain is left alone");

		assert.deepEqual(await as(user, () => m.domains.removeDomainAction(String(domain._id))), { ok: true, removed: "letters.dev" });
		assert.equal(fake.findDomain("letters.dev"), null);
	});

	test("Check now says which records Groundmail is still missing", async () => {
		const user = await signIn("gm-check@example.com");
		await activate(user);
		await as(user, () => m.domains.addDomainAction(null, form({ domain: "check.dev" })));
		const domain = await m.Domain.findOne({ accountId: user.accountId }).lean();
		fake.fail({ method: "POST", path: new RegExp(`^/domains/${domain.providerDomainId}$`), status: 400, body: {
			error: "DNS records not found yet: SPF include:spf.groundmail.test",
			code: "validation_error",
			checks: { ownership: true, dkim: true, spf: false, return_path: true, dmarc: false },
		} });
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: false });
		const checked = await m.Domain.findOne({ accountId: user.accountId, _id: domain._id }).lean();
		assert.deepEqual([checked.dkimStatus, checked.mailFromStatus], ["SUCCESS", "PENDING"]);
	});

	test("a domain stays in its own account and tenant: another can't add, check or remove it", async () => {
		const owner = await customer("gm-owner@example.com", "gm-owner");
		const other = await customer("gm-other@example.com", "gm-other");
		const domain = await m.Domain.findOne({ accountId: owner.accountId, domain: "gm-owner.dev" }).lean();
		const created = fake.callsTo("POST", /^\/domains$/).length;
		assert.deepEqual(await as(other, () => m.domains.addDomainAction(null, form({ domain: "gm-owner.dev" }))), { error: "gm-owner.dev is used by another MailCheap account" });
		assert.equal(fake.callsTo("POST", /^\/domains$/).length, created, "Groundmail never heard of the second claim");
		assert.deepEqual(await as(other, () => m.domains.checkDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.deepEqual(await as(other, () => m.domains.removeDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.equal(fake.findDomain("gm-owner.dev").tenant, `mc-${owner.accountId}`);
	});
});

describe("Groundmail sending", () => {
	test("a test email is category newsletter in the account's tenant, with the message id as Idempotency-Key and MailCheap's headers", async () => {
		const user = await customer("gm-test@example.com", "gm-test");
		const id = await draft(user, "Issue 7");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });

		const message = await m.Message.findOne({ accountId: user.accountId, kind: "test" }).lean();
		const { key, body, response } = fake.state.emails.at(-1);
		assert.equal(key, String(message._id));
		assert.equal(body.tenant, `mc-${user.accountId}`);
		assert.equal(body.category, "newsletter");
		assert.equal(body.unsubscribe, undefined, "Groundmail puts its own one-click unsubscribe on newsletter email");
		assert.deepEqual(body.from, { email: "hello@gm-test.dev", name: "Jane" });
		assert.equal(body.to, "gm-test@example.com");
		assert.equal(body.subject, "[Test] Issue 7");
		assert.match(body.headers["List-Unsubscribe"], /\/api\/unsubscribe\?token=/);
		assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
		assert.equal(body.headers["Feedback-ID"], `${id}:mc-${user.accountId}:test:mailcheap`);
		assert.deepEqual(body.tags, [
			{ name: "account_id", value: String(user.accountId) },
			{ name: "message_id", value: String(message._id) },
			{ name: "kind", value: "test" },
			{ name: "campaign_id", value: id },
		]);
		assert.equal(message.providerMessageId, response.id, "Groundmail's events name it by this id");
		assert.equal(message.status, "sent");
	});

	test("a campaign goes to each contact, and Groundmail's events mark deliveries, bounces and complaints", async () => {
		const user = await customer("gm-campaign@example.com", "gm-campaign");
		const readers = ["delivered@example.org", "hard@example.org", "block@example.org", "reader4@example.org"];
		await importContacts(user, readers);
		const id = await draft(user, "Weekly");
		const before = fake.state.emails.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await runJobs();
		const sent = fake.state.emails.slice(before);
		assert.deepEqual(sent.map(({ body }) => body.to).sort(), [...readers].sort());
		assert.ok(sent.every(({ body }) => body.category === "newsletter" && body.tenant === `mc-${user.accountId}`));
		const to = (email) => sent.find(({ body }) => body.to === email);

		const results = [];
		results.push(await postWebhook(emailEvent("email.delivered", to("delivered@example.org"))));
		results.push(await postWebhook(emailEvent("email.bounced", to("hard@example.org"), { bounce_type: "hard", bounce_reason: "550 5.1.1 user unknown" })));
		results.push(await postWebhook(emailEvent("email.bounced", to("block@example.org"), { bounce_type: "block", bounce_reason: "550 5.7.1 local policy" })));
		results.push(await postWebhook(emailEvent("email.delivered", to("reader4@example.org"))));
		results.push(await postWebhook(emailEvent("email.complained", to("reader4@example.org"))));
		for (const response of results) assert.deepEqual(await response.json(), { ok: true, handled: 1 });

		const status = async (email) => (await m.Message.findOne({ accountId: user.accountId, campaignId: id, email }).lean()).status;
		assert.equal(await status("delivered@example.org"), "delivered");
		assert.equal(await status("hard@example.org"), "bounced");
		assert.equal(await status("block@example.org"), "sent", "a block bounce isn't the address's fault");
		assert.equal(await status("reader4@example.org"), "complained");
		const suppressions = await m.Suppression.find({ accountId: user.accountId }).lean();
		assert.deepEqual(Object.fromEntries(suppressions.map(({ email, reason }) => [email, reason])), { "hard@example.org": "bounce", "reader4@example.org": "complaint" });
		const contact = (email) => m.Contact.findOne({ accountId: user.accountId, email }).lean();
		assert.deepEqual([(await contact("hard@example.org")).status, (await contact("block@example.org")).status, (await contact("reader4@example.org")).status], ["bounced", "active", "complained"]);

		// Groundmail's one-click unsubscribe, which replaces MailCheap's List-Unsubscribe header on newsletter email.
		const unsubscribed = await postWebhook({
			type: "contact.unsubscribed",
			created_at: new Date().toISOString(),
			data: { email: "delivered@example.org", source: "unsubscribe", scope: "category", category: "newsletter", email_id: to("delivered@example.org").response.id },
		});
		assert.deepEqual(await unsubscribed.json(), { ok: true, handled: 1 });
		assert.equal((await contact("delivered@example.org")).status, "unsubscribed");

		// Redelivered: counted once.
		assert.deepEqual(await (await postWebhook(emailEvent("email.bounced", to("hard@example.org"), { bounce_type: "hard", bounce_reason: "550 5.1.1 user unknown" }))).json(), { ok: true, handled: 1 });
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).stats.bounced, 1);
	});

	test("the webhook takes only Groundmail's signature, and an event never lands in an account its tenant isn't", async () => {
		const owner = await customer("gm-hook@example.com", "gm-hook");
		const other = await customer("gm-hook-other@example.com", "gm-hook-other");
		const id = await draft(owner);
		await as(owner, () => m.campaigns.sendTestCampaign(id));
		const sent = fake.state.emails.at(-1);

		const forged = await postWebhook(emailEvent("email.bounced", sent, { bounce_type: "hard" }), { header: `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` });
		assert.equal(forged.status, 401);
		const otherTenant = await postWebhook(emailEvent("email.bounced", sent, { bounce_type: "hard", tenant: `mc-${other.accountId}` }));
		assert.deepEqual(await otherTenant.json(), { ok: true, handled: 1 });
		assert.equal((await m.Message.findOne({ accountId: owner.accountId, kind: "test", campaignId: id }).lean()).status, "sent", "untouched");
		assert.equal(await m.Suppression.countDocuments({ accountId: other.accountId }), 0);
		assert.deepEqual(await (await postWebhook({ type: "email.opened", created_at: new Date().toISOString(), data: { email_id: sent.response.id } })).json(), { ok: true, handled: 0 });

		// The message_id tag names another tenant's message: never applied to it.
		const otherSent = { ...sent, tenant: `mc-${other.accountId}` };
		assert.deepEqual(await (await postWebhook(emailEvent("email.bounced", otherSent, { bounce_type: "hard", email_id: "msg_unknown" }))).json(), { ok: true, handled: 1 });
		assert.equal((await m.Message.findOne({ accountId: owner.accountId, kind: "test", campaignId: id }).lean()).status, "sent", "still untouched");

		await withEnv({ GROUNDMAIL_WEBHOOK_SECRET: "" }, async () => {
			assert.equal((await postWebhook(emailEvent("email.delivered", sent))).status, 503);
		});
	});

	test("an event that arrives before the send's answer is saved finds the message by its message_id tag", async () => {
		const user = await customer("gm-early@example.com", "gm-early");
		const id = await draft(user);
		await as(user, () => m.campaigns.sendTestCampaign(id));
		const sent = fake.state.emails.at(-1);
		const query = { accountId: user.accountId, kind: "test", campaignId: id };
		// As if Groundmail's event beat MailCheap's write of the email id.
		await m.Message.updateOne(query, { $set: { providerMessageId: null } });

		assert.deepEqual(await (await postWebhook(emailEvent("email.delivered", sent))).json(), { ok: true, handled: 1 });
		const message = await m.Message.findOne(query).lean();
		assert.equal(message.status, "delivered");
		assert.equal(message.providerMessageId, sent.response.id, "the email id is saved from the event");

		// Without tags (an older event shape), Groundmail's id still finds it.
		assert.deepEqual(await (await postWebhook(emailEvent("email.complained", sent, { tags: undefined }))).json(), { ok: true, handled: 1 });
		assert.equal((await m.Message.findOne(query).lean()).status, "complained");
	});

	test("a daily ramp limit puts the batch back until Groundmail resets it", async () => {
		const user = await customer("gm-ramp@example.com", "gm-ramp");
		await importContacts(user, ["ramp1@example.org", "ramp2@example.org"]);
		const id = await draft(user, "Ramped");
		const resetsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
		fake.fail({ method: "POST", path: /^\/emails$/, status: 429, body: { error: { code: "daily_ramp_limit", message: "New tenants ramp up their sending", details: { tenant: `mc-${user.accountId}`, resets_at: resetsAt } } } });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const response = await runNextJob();
		assert.equal((await response.json()).republished, true);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2, "nothing lost");
		assert.ok(published.at(-1).notBefore >= Math.floor(Date.now() / 1000) + 3000, "not in a loop");
		await runJobs();
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "sent" }), 2);
	});

	test("an address Groundmail suppresses is skipped and kept out of the account's next sends", async () => {
		const user = await customer("gm-suppressed@example.com", "gm-suppressed");
		fake.suppress(`mc-${user.accountId}`, "gone@example.org");
		await importContacts(user, ["gone@example.org", "here@example.org"]);
		const id = await draft(user, "Hello");
		await as(user, () => m.campaigns.sendCampaign(id, {}));
		await runJobs();
		const messages = await m.Message.find({ accountId: user.accountId, campaignId: id }).lean();
		assert.deepEqual(Object.fromEntries(messages.map(({ email, status }) => [email, status])), { "gone@example.org": "suppressed", "here@example.org": "sent" });
		assert.equal((await m.Suppression.findOne({ accountId: user.accountId, email: "gone@example.org" }).lean()).reason, "provider");
	});

	test("a reader who unsubscribed through Groundmail and signs up again gets the account's newsletters again, and other tenants keep theirs", async () => {
		const user = await customer("gm-back@example.com", "gm-back");
		const other = await customer("gm-back-other@example.com", "gm-back-other");
		const reader = "returning@example.org";
		const tenant = `mc-${user.accountId}`;
		await importContacts(user, [reader]);
		const first = await draft(user, "Before");
		await as(user, () => m.campaigns.sendCampaign(first, {}));
		await runJobs();
		const sent = fake.state.emails.find(({ body }) => body.to === reader && body.tenant === tenant);
		// Groundmail's one-click unsubscribe: kept for this tenant, and the reader leaves in MailCheap.
		fake.optOut(tenant, reader);
		fake.optOut(`mc-${other.accountId}`, reader);
		await postWebhook({
			type: "contact.unsubscribed",
			created_at: new Date().toISOString(),
			data: { email: reader, scope: "category", category: "newsletter", email_id: sent.response.id, tenant },
		});
		const contact = () => m.Contact.findOne({ accountId: user.accountId, email: reader }).lean();
		assert.equal((await contact()).status, "unsubscribed");

		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const lifts = () => fake.callsTo("DELETE", /^\/suppressions$/);
		const before = lifts().length;
		await m.contactsLib.upsertContact({ newsletter, email: reader, source: "website", resubscribe: true });
		assert.equal((await contact()).status, "active");
		assert.deepEqual(lifts().slice(before).map(({ query }) => query), [{ type: "category_opt_out", email: reader, category: "newsletter", tenant }]);
		assert.ok(!fake.state.optOuts.has(`${tenant}:${reader}:newsletter`));
		assert.ok(fake.state.optOuts.has(`mc-${other.accountId}:${reader}:newsletter`), "another account's unsubscribe stays");

		const second = await draft(user, "After");
		await as(user, () => m.campaigns.sendCampaign(second, {}));
		await runJobs();
		assert.equal((await m.Message.findOne({ accountId: user.accountId, campaignId: second, email: reader }).lean()).status, "sent");
		assert.equal(await m.Suppression.countDocuments({ accountId: user.accountId, email: reader }), 0);

		// Signing up when already subscribed, or someone new, asks Groundmail nothing.
		await m.contactsLib.upsertContact({ newsletter, email: reader, source: "website", resubscribe: true });
		await m.contactsLib.upsertContact({ newsletter, email: "new-reader@example.org", source: "website", resubscribe: true });
		assert.equal(lifts().length, before + 1);
	});

	test("joining another newsletter of the account lifts the account's unsubscribe at Groundmail", async () => {
		const user = await customer("gm-second-list@example.com", "gm-second-list");
		const tenant = `mc-${user.accountId}`;
		const reader = "left-one@example.org";
		await importContacts(user, [reader]);
		await m.Contact.updateOne({ accountId: user.accountId, email: reader }, { $set: { status: "unsubscribed", unsubscribedAt: new Date() } });
		fake.optOut(tenant, reader);
		const firstNewsletterId = user.newsletterId;
		await createNewsletter(user, "gm-second-list-b", { fromEmail: "news@gm-second-list.dev" });
		assert.notEqual(user.newsletterId, firstNewsletterId);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const { created } = await m.contactsLib.upsertContact({ newsletter, email: reader, source: "website", resubscribe: true });
		assert.equal(created, true);
		assert.ok(!fake.state.optOuts.has(`${tenant}:${reader}:newsletter`));
	});

	test("resubscribing a contact from the dashboard lifts Groundmail's unsubscribe, and Groundmail failing never stops it", async () => {
		const user = await customer("gm-resub@example.com", "gm-resub");
		const tenant = `mc-${user.accountId}`;
		await importContacts(user, ["flaky@example.org", "steady@example.org"]);
		const find = (email) => m.Contact.findOne({ accountId: user.accountId, email }).lean();
		for (const email of ["flaky@example.org", "steady@example.org"]) {
			const { _id } = await find(email);
			assert.deepEqual(await as(user, () => m.contacts.setContactStatus(String(_id), "unsubscribed")), { ok: true });
			fake.optOut(tenant, email);
		}

		fake.fail({ method: "DELETE", path: /^\/suppressions$/, status: 500, body: { error: { code: "internal_error", message: "Something went wrong" } } });
		const errors = [];
		const original = console.error;
		console.error = (...args) => errors.push(args.join(" "));
		try {
			const flaky = await find("flaky@example.org");
			assert.deepEqual(await as(user, () => m.contacts.setContactStatus(String(flaky._id), "active", true)), { ok: true });
		} finally {
			console.error = original;
		}
		assert.equal((await find("flaky@example.org")).status, "active", "MailCheap resubscribes them anyway");
		assert.ok(errors.some((line) => /Groundmail may still refuse a resubscribed contact/.test(line)));
		assert.ok(!errors.some((line) => line.includes("flaky@example.org")), "no address in the log");

		const steady = await find("steady@example.org");
		assert.deepEqual(await as(user, () => m.contacts.setContactStatus(String(steady._id), "active", true)), { ok: true });
		assert.ok(!fake.state.optOuts.has(`${tenant}:steady@example.org:newsletter`));
	});

	test("until Groundmail enables newsletter sending, a campaign pauses with the reason and the admins hear of it", async () => {
		const user = await customer("gm-not-enabled@example.com", "gm-not-enabled");
		await importContacts(user, ["waiting@example.org"]);
		const id = await draft(user, "Waiting");
		const emailsBefore = platformEmails.length;
		fake.state.isNewsletterEnabled = false;
		await as(user, () => m.campaigns.sendCampaign(id, {}));
		await runJobs();
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.match(campaign.pauseReason, /hasn't enabled newsletter sending/);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "waits for the resume");
		const toAdmins = platformEmails.slice(emailsBefore).filter(({ to }) => to.includes("admin@example.com"));
		assert.deepEqual(toAdmins.map(({ subject }) => subject), ["[MailCheap] Groundmail refuses MailCheap's sends"]);
		assert.match(toAdmins[0].text, /Readers' emails are refused until Groundmail approves the team\./);
	});
});

describe("Groundmail blocks", () => {
	test("blocking an account pauses its tenant at Groundmail until an admin unblocks it", async () => {
		const user = await customer("gm-pause@example.com", "gm-pause");
		const externalId = `mc-${user.accountId}`;
		const admin = await signIn("admin@example.com");
		assert.deepEqual(await as(admin, () => m.admin.blockAccountAction(String(user.accountId), "Review")), { ok: true });
		assert.deepEqual([fake.findTenant(externalId).status, fake.findTenant(externalId).pause_source], ["paused", "api"]);
		assert.equal((await loadAccount(user)).groundmail.tenantStatus, "paused");

		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.equal(fake.findTenant(externalId).status, "active");
		assert.equal((await loadAccount(user)).groundmail.tenantStatus, "active");
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	});

	test("Groundmail pausing a tenant blocks its account, and unblocking waits for Groundmail", async () => {
		const user = await customer("gm-hold@example.com", "gm-hold");
		const other = await customer("gm-hold-other@example.com", "gm-hold-other");
		const externalId = `mc-${user.accountId}`;
		fake.pauseTenant(externalId, "automated");
		const id = await draft(user);
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /Groundmail paused this account's tenant/);

		const blocked = await loadAccount(user);
		assert.deepEqual([blocked.status, blocked.pausedBy, blocked.groundmail.tenantStatus], ["paused", "groundmail", "held"]);
		assert.equal(blocked.pauseReason, "Our email provider stopped this account's sending");
		assert.equal((await loadAccount(other)).status, "active", "other accounts keep sending");

		const admin = await signIn("admin@example.com");
		assert.match((await as(admin, () => m.admin.unblockAccountAction(String(user.accountId)))).error, /Groundmail paused this tenant \(automated\)/);
		assert.equal((await loadAccount(user)).status, "paused");

		Object.assign(fake.findTenant(externalId), { status: "active", pause_source: null });
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.deepEqual([(await loadAccount(user)).status, (await loadAccount(user)).groundmail.tenantStatus], ["active", "active"]);
	});

	test("an account's purge removes its domains and its tenant at Groundmail", async () => {
		const user = await customer("gm-purge@example.com", "gm-purge");
		const account = await loadAccount(user);
		await m.domainsLib.releaseDomains(account);
		await m.tenants.removeTenants(account);
		assert.equal(fake.findDomain("gm-purge.dev"), null);
		assert.equal(fake.findTenant(`mc-${user.accountId}`), null);
	});
});

describe("MailCheap's own emails through Groundmail", () => {
	const SELF_HOSTED = { MAILCHEAP_CLOUD: "", RESEND_API_KEY: "", EMAIL_FROM: "MailCheap <login@mail.selfhost.dev>", ALLOWED_EMAILS: "self-gm@example.com" };

	function requestCode(email) {
		const visitor = { jar: new Map(), ip: `203.0.113.${++visitors}` };
		return as(visitor, () => m.signin.sendSigninCode(null, form({ email })));
	}

	test("without Resend, sign-in codes are transactional email of the Groundmail account once EMAIL_FROM's domain is verified there", async () => {
		await withEnv(SELF_HOSTED, async () => {
			const logged = [];
			const error = console.error;
			console.error = (...args) => logged.push(args.join(" "));
			let result;
			try {
				result = await requestCode("self-gm@example.com");
			} finally {
				console.error = error;
			}
			assert.equal(result.error, "Couldn't send the code. Try again in a minute.");
			assert.match(logged.join("\n"), /Groundmail can't send from mail\.selfhost\.dev yet: add TXT _groundmail\.mail\.selfhost\.dev \S+ and .*CNAME rp\.mail\.selfhost\.dev rp\.groundmail\.test/);
			assert.equal(fake.findDomain("mail.selfhost.dev").tenant, null, "in no tenant");

			fake.publishDns("mail.selfhost.dev");
			const codes = () => fake.state.emails.filter(({ body }) => body.to === "self-gm@example.com");
			assert.equal(codes().length, 0);
			assert.deepEqual(await requestCode("self-gm@example.com"), { email: "self-gm@example.com" });
			assert.equal(codes().length, 1);
			const { body } = codes()[0];
			assert.deepEqual([body.category, body.tenant, body.to], ["transactional", undefined, "self-gm@example.com"]);
			assert.deepEqual(body.from, { email: "login@mail.selfhost.dev", name: "MailCheap" });
			assert.match(body.subject, /^\d{6} is your MailCheap code$/);
			assert.deepEqual(body.tags, [{ name: "kind", value: "platform" }]);
		});
	});
});
