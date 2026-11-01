import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decryptSecret } from "../lib/credentials.js";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp, telegramMessages, withEnv } from "./helpers/app.mjs";
import { POSTSHIBA, POSTSHIBA_ENV, createFakePostshiba } from "./helpers/postshiba.mjs";
import { txts } from "./stubs/dns-check.mjs";
import { published } from "./stubs/qstash.mjs";
import { dnsRecords } from "./stubs/dns-broker.mjs";

// PostShiba as the provider, through the real actions and jobs, with PostShiba answered in memory.
const TELEGRAM = { TELEGRAM_BOT_TOKEN: "123456:test-bot-token-never-logged", TELEGRAM_CHAT_ID: "424242" };
const REFUSED_LOGIN = { path: /^\/inject$/, status: 401, body: { error: "authentication failed" } };
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

async function welcomeNewContact(user, email) {
	const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
	const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "active" });
	return m.sending.queueWelcomeEmail({ newsletter, contact });
}

const subscription = (id) => ({
	id: `sub_${id}`,
	status: "active",
	customer: `cus_${id}`,
	items: { data: [{ price: { lookup_key: "starter_month" }, current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
});

async function createNewsletter(user, slug, fields = {}) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, fromName: "Jane", postalAddress: "1 Main St, Paris", ...fields })))
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
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello {{ name }}</p>" }));
	return id;
}

async function loadAccount(user) {
	return m.Account.findById(user.accountId).lean();
}

// PostShiba's webhook as it posts in production: one signed event per request, naming the message by its own id.
function postWebhook(event) {
	const body = JSON.stringify([event]);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = `sha256=${crypto.createHmac("sha256", POSTSHIBA.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;
	return m.webhookRoute.POST(
		new Request("http://localhost:3000/api/webhooks/postshiba", {
			method: "POST",
			headers: { "content-type": "application/json", "x-capsule-timestamp": timestamp, "x-capsule-signature": signature },
			body,
		})
	);
}

// A paying customer whose newsletter sends from its own domain, verified at PostShiba.
async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	await createNewsletter(user, slug);
	const domain = `${slug}.dev`;
	assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain }))), { ok: true, domain });
	fake.verifyDomain(domain);
	await m.Domain.updateOne({ accountId: user.accountId, domain }, { $unset: { checkedAt: 1 } });
	const stored = await m.Domain.findOne({ accountId: user.accountId, domain }).lean();
	assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(stored._id))), { ok: true, verified: true });
	assert.equal((await saveFrom(user, `hello@${domain}`)).ok, true);
	user.account = await loadAccount(user);
	return user;
}

async function importContacts(user, emails) {
	await as(user, () =>
		m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: emails.map((email) => ({ email, status: "active" })) })
	);
}

before(async () => {
	app = await startTestApp({ ...POSTSHIBA_ENV, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	fake = createFakePostshiba();
	fake.install();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		domainsPage: await import("../app/(app)/domains/page.js"),
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		dashboard: await import("../lib/actions/dashboard.js"),
		admin: await import("../app/admin/actions.js"),
		sending: await import("../lib/sending.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		webhookRoute: await import("../app/api/webhooks/postshiba/route.js"),
		billing: await import("../lib/billing.js"),
		accounts: await import("../lib/accounts.js"),
		tenants: await import("../lib/tenants.js"),
		providers: await import("../lib/email-provider/index.js"),
		postshibaAdapter: await import("../lib/email-provider/postshiba.js"),
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

// A failure a test set up and didn't reach never lands on the next one.
afterEach(() => fake.state.failures.splice(0));

after(() => app?.stop());

describe("PostShiba tenants", () => {
	test("a plan starting creates one tenant with a credential on each cluster, and the SMTP password stays encrypted", async () => {
		const user = await signIn("ps-tenant@example.com");
		await m.billing.applySubscription(await loadAccount(user), subscription("ps-tenant"));
		await m.billing.applySubscription(await loadAccount(user), subscription("ps-tenant"));

		const slug = `mc-${user.accountId}`;
		const tenants = [...fake.state.tenants.values()].filter((tenant) => tenant.slug === slug);
		assert.equal(tenants.length, 1, "only once");
		const credentials = [...fake.state.credentials.values()].filter((item) => item.tenant_id === tenants[0].id);
		assert.deepEqual(credentials.map(({ cluster_id }) => cluster_id).sort(), [POSTSHIBA.bulkClusterId, POSTSHIBA.transactionalClusterId].sort());

		const { postshiba } = await loadAccount(user);
		assert.equal(postshiba.tenantId, tenants[0].id);
		assert.equal(postshiba.tenantSlug, slug);
		assert.equal(postshiba.tenantStatus, "active");
		assert.ok(postshiba.provisionedAt);
		assert.equal(postshiba.bulkCredential.clusterId, POSTSHIBA.bulkClusterId);
		assert.equal(postshiba.bulkCredential.password, undefined, "reads leave the password out");
		assert.equal(postshiba.transactionalCredential.password, undefined, "never stored for the transactional cluster");

		const raw = await mongoose.connection.db.collection("accounts").findOne({ _id: user.accountId });
		const bulk = credentials.find(({ cluster_id }) => cluster_id === POSTSHIBA.bulkClusterId);
		assert.match(raw.postshiba.bulkCredential.password, /^v1\./);
		assert.ok(!JSON.stringify(raw).includes(bulk.password), "never in plain text");
		assert.equal(decryptSecret(raw.postshiba.bulkCredential.password, { context: `postshiba-smtp:${user.accountId}:${POSTSHIBA.bulkClusterId}` }), bulk.password);

		const listed = (await m.accounts.listAccountsForAdmin()).find(({ _id }) => String(_id) === String(user.accountId));
		assert.equal(listed.postshiba.tenantId, tenants[0].id);
		assert.equal(listed.postshiba.bulkCredential.password, undefined, "the admin list leaves it out too");
		const provider = m.providers.getEmailProvider();
		assert.equal(provider.name, "PostShiba");
		assert.deepEqual(provider.describeTenant(listed), { id: tenants[0].id, slug, status: "active", detail: null }, "what the admin page shows");
		assert.equal(provider.describeTenant({}), null);
		assert.deepEqual(
			m.providers.getProvider("ses").describeTenant({ ses: { tenantName: "mc-x", provisionedAt: new Date(), tenantStatus: "DISABLED", lastFinding: "Bounce (high impact)" } }),
			{ id: "mc-x", status: "DISABLED", detail: "Bounce (high impact)" }
		);
	});

	test("the admin page reads both clusters' plans and caps", async () => {
		const clusters = await m.postshibaAdapter.getClusters({ fresh: true });
		assert.deepEqual([clusters.bulk.classification, clusters.bulk.plan, clusters.bulk.emails_per_hour], ["bulk", "small", 40_000]);
		assert.deepEqual([clusters.transactional.classification, clusters.transactional.plan], ["transactional", "micro"]);
		fake.fail({ method: "GET", path: /\/clusters\//, status: 500, body: { error: "boom" } });
		assert.match((await m.postshibaAdapter.getClusters({ fresh: true })).error, /PostShiba GET/);
	});

	test("a setup that failed halfway finishes later, with no second tenant", async () => {
		const user = await signIn("ps-retry@example.com");
		fake.fail({ method: "POST", path: /\/smtp_credentials$/, status: 503, body: { error: "unavailable" }, times: 2 });
		await m.billing.applySubscription(await loadAccount(user), subscription("ps-retry"));
		let account = await loadAccount(user);
		assert.equal(account.subscriptionStatus, "active", "the plan starts anyway");
		assert.ok(account.postshiba.tenantId);
		assert.equal(account.postshiba.provisionedAt, undefined);

		// A lost write: PostShiba has the tenant, MailCheap forgot it.
		await m.Account.updateOne({ _id: user.accountId }, { $unset: { "postshiba.tenantId": 1 } });
		await m.tenants.provisionTenant(user.accountId);
		account = await loadAccount(user);
		const tenants = [...fake.state.tenants.values()].filter((tenant) => tenant.slug === `mc-${user.accountId}`);
		assert.equal(tenants.length, 1);
		assert.equal(account.postshiba.tenantId, tenants[0].id, "found by its slug");
		assert.ok(account.postshiba.provisionedAt);
	});

	test("when two plan starts race to create the tenant, the one that loses tries again and nobody is alerted", async () => {
		const user = await signIn("ps-race@example.com");
		const alerts = () => platformEmails.filter(({ subject }) => subject === "[MailCheap] PostShiba tenant not created").length;
		const before = alerts();
		fake.fail({ method: "POST", path: /\/tenants$/, status: 500, body: { error: "Internal Server Error" } });
		await m.billing.applySubscription(await loadAccount(user), subscription("ps-race"));
		const account = await loadAccount(user);
		assert.ok(account.postshiba.provisionedAt, "set up on the second try");
		assert.equal([...fake.state.tenants.values()].filter((tenant) => tenant.slug === `mc-${user.accountId}`).length, 1);
		assert.equal(alerts(), before, "no alert");
	});
});

describe("PostShiba domains", () => {
	test("a domain another PostShiba account verified is taken, said without naming PostShiba or asking to try again, and a subdomain goes through", async () => {
		const user = await signIn("ps-elsewhere@example.com");
		await activate(user);
		fake.fail({ method: "POST", path: /\/sending_domains$/, status: 422, body: { errors: ["Name is already verified on another account"] } });
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "elsewhere.dev" }))), {
			error: "elsewhere.dev is already taken. Add a subdomain instead, like mail.elsewhere.dev, or another domain.",
		});
		assert.equal(await m.Domain.exists({ accountId: user.accountId, domain: "elsewhere.dev" }), null, "nothing kept, so it can be added once it's free");
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "mail.elsewhere.dev" }))), { ok: true, domain: "mail.elsewhere.dev" });
	});

	test("an own domain gets PostShiba's DKIM and rp. CNAMEs, in the account's tenant, and Check now stays within the budget", async () => {
		const user = await signIn("ps-domain@example.com");
		await activate(user);
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "letters.dev" }))), { ok: true, domain: "letters.dev" });
		const domain = await m.Domain.findOne({ accountId: user.accountId }).lean();
		const atPostshiba = fake.state.domains.get(domain.providerDomainId);
		assert.equal(atPostshiba.tenant_id, (await loadAccount(user)).postshiba.tenantId, "in the account's own tenant");
		assert.equal(domain.provider, "postshiba");
		assert.equal(domain.mailFromDomain, "rp.letters.dev");
		assert.deepEqual(domain.records, [
			{ purpose: "dkim", type: "CNAME", name: "ps1._domainkey.letters.dev", value: `${domain.providerDomainId}.customers.postshiba.test` },
			{ purpose: "mail-from", type: "CNAME", name: "rp.letters.dev", value: "rp.postshiba.test" },
		]);
		const verifyCalls = () => fake.callsTo("POST", new RegExp(`/sending_domains/${domain.providerDomainId}/verify$`)).length;
		const reads = () => fake.callsTo("GET", new RegExp(`/sending_domains/${domain.providerDomainId}$`)).length;
		assert.equal(verifyCalls(), 0, "PostShiba checks a new domain on its own");

		const readsBefore = reads();
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: false });
		assert.deepEqual([verifyCalls(), reads()], [0, readsBefore], "checked a moment ago: no call");

		fake.verifyDomain("letters.dev");
		for (let index = 0; index < 6; index++) {
			await m.Domain.updateOne({ accountId: user.accountId, _id: domain._id }, { $set: { checkedAt: new Date(Date.now() - 120_000) } });
			assert.equal((await as(user, () => m.domains.checkDomainAction(String(domain._id)))).verified, true);
		}
		assert.equal(verifyCalls(), 6);
		await m.Domain.updateOne({ accountId: user.accountId, _id: domain._id }, { $set: { checkedAt: new Date(Date.now() - 120_000) } });
		await as(user, () => m.domains.checkDomainAction(String(domain._id)));
		assert.deepEqual([verifyCalls(), reads()], [6, readsBefore + 1], "over the account's share: a read instead");

		assert.deepEqual(await as(user, () => m.domains.removeDomainAction(String(domain._id))), { ok: true, removed: "letters.dev" });
		assert.equal(fake.state.domains.has(domain.providerDomainId), false);
	});

	test("a domain stays in its own account and tenant: another can't add, check or remove it", async () => {
		const owner = await customer("ps-owner@example.com", "ps-owner");
		const other = await customer("ps-other@example.com", "ps-other");
		const domain = await m.Domain.findOne({ accountId: owner.accountId, domain: "ps-owner.dev" }).lean();
		const domainsBefore = fake.state.domains.size;
		assert.deepEqual(await as(other, () => m.domains.addDomainAction(null, form({ domain: "ps-owner.dev" }))), {
			error: "ps-owner.dev is used by another MailCheap account",
		});
		assert.equal(fake.state.domains.size, domainsBefore, "PostShiba never heard of the second claim");
		assert.deepEqual(await as(other, () => m.domains.checkDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.deepEqual(await as(other, () => m.domains.removeDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.equal(fake.state.domains.get(domain.providerDomainId).tenant_id, owner.account.postshiba.tenantId);
		assert.match((await saveFrom(other, "hi@ps-owner.dev")).error, /Add ps-owner.dev on the Domains page first/);
	});

	test("a domain verified at SES before the switch sends again once its PostShiba records are in", async () => {
		const user = await customer("ps-switch@example.com", "switched");
		await m.Domain.create({ accountId: user.accountId, domain: "old-ses.dev", archiveHost: "news.old-ses.dev", mailFromDomain: "bounce.old-ses.dev", verified: true, dkimStatus: "SUCCESS" });
		assert.equal((await saveFrom(user, "hi@old-ses.dev")).ok, true);
		const id = await draft(user);
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /old-ses.dev isn't verified yet/);

		const domain = await m.Domain.findOne({ accountId: user.accountId, domain: "old-ses.dev" }).lean();
		await as(user, () => m.domains.checkDomainAction(String(domain._id)));
		const moved = await m.Domain.findOne({ accountId: user.accountId, _id: domain._id }).lean();
		assert.equal(moved.provider, "postshiba");
		assert.equal(moved.mailFromDomain, "rp.old-ses.dev");
		assert.equal(moved.verified, false);
		assert.ok(fake.state.domains.has(moved.providerDomainId));
		fake.verifyDomain("old-ses.dev");
		await m.Domain.updateOne({ accountId: user.accountId, _id: domain._id }, { $unset: { checkedAt: 1 } });
		await as(user, () => m.domains.checkDomainAction(String(domain._id)));
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	});

	test("every check looks up DMARC on the domain, else its parent, and a lookup that fails keeps the last answer", async () => {
		const user = await signIn("ps-dmarc@example.com");
		await activate(user);
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "mail.dmarc-parent.dev" }))), { ok: true, domain: "mail.dmarc-parent.dev" });
		const { _id } = await m.Domain.findOne({ accountId: user.accountId }).lean();
		async function check() {
			const { output } = await as(user, () => m.dashboard.runDashboardAction("check_domain", { id: String(_id) }));
			return output.setup.find(({ key }) => key === "dmarc").status;
		}

		assert.equal(await check(), "Recommended");
		txts.set("_dmarc.dmarc-parent.dev", [["v=DMARC1; p=quarantine; ", "rua=mailto:reports@dmarc-parent.dev"]]);
		assert.equal(await check(), "Found on dmarc-parent.dev", "the parent's record covers its subdomains");
		txts.set("_dmarc.mail.dmarc-parent.dev", [["v=DMARC1; p=none;"], ["v=DMARC1; p=reject;"]]);
		assert.equal(await check(), "More than one record, keep one", "the domain's own records come first");
		txts.set("_dmarc.mail.dmarc-parent.dev", [["v=DMARC1; p=none;"]]);
		assert.equal(await check(), "Found");
		txts.set("_dmarc.mail.dmarc-parent.dev", null);
		assert.equal(await check(), "Found", "the resolver failed: nothing changes");
		txts.delete("_dmarc.mail.dmarc-parent.dev");
		txts.delete("_dmarc.dmarc-parent.dev");
		assert.equal(await check(), "Recommended");
		assert.deepEqual((await m.Domain.findOne({ accountId: user.accountId, _id }).lean()).dmarc, { status: "missing" });
	});

	test("a return path PostShiba verifies after a check shows on the Domains page without another, and Check now still verifies", async () => {
		const user = await signIn("ps-refresh@example.com");
		await activate(user);
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "refresh.dev" }))), { ok: true, domain: "refresh.dev" });
		const { _id, providerDomainId } = await m.Domain.findOne({ accountId: user.accountId }).lean();
		const atPostshiba = fake.state.domains.get(providerDomainId);
		const verifyCalls = () => fake.callsTo("POST", new RegExp(`/sending_domains/${providerDomainId}/verify$`)).length;
		const reads = () => fake.callsTo("GET", new RegExp(`/sending_domains/${providerDomainId}$`)).length;
		const stored = () => m.Domain.findOne({ accountId: user.accountId, _id }).lean();
		const checkedLongAgo = () => m.Domain.updateOne({ accountId: user.accountId, _id }, { $set: { checkedAt: new Date(Date.now() - 120_000) } });
		const openPage = () => as(user, () => m.domainsPage.default());
		async function returnPathStatus() {
			const { output } = await as(user, () => m.dashboard.runDashboardAction("list_domains"));
			return output.domains[0].setup.find(({ key }) => key === "mail-from").status;
		}

		// PostShiba sends once DKIM is in: the return path can verify at a later round of its own checks.
		Object.assign(atPostshiba, { dkim_status: "verified", sending_allowed: true });
		await checkedLongAgo();
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(_id))), { ok: true, verified: true });
		assert.equal(await returnPathStatus(), "Waiting for DNS");
		atPostshiba.return_path_status = "verified";

		const before = { verifyCalls: verifyCalls(), reads: reads() };
		await openPage();
		assert.deepEqual([reads(), await returnPathStatus()], [before.reads, "Waiting for DNS"], "checked a moment ago: not read again yet");
		await checkedLongAgo();
		await openPage();
		assert.equal(await returnPathStatus(), "Found");
		assert.deepEqual([verifyCalls(), reads()], [before.verifyCalls, before.reads + 1], "a read, outside the verification budget");
		assert.ok((await stored()).readAt);
		await openPage();
		assert.equal(reads(), before.reads + 1, "read a moment ago: not again");

		await as(user, () => m.domains.checkDomainAction(String(_id)));
		assert.equal(verifyCalls(), before.verifyCalls + 1, "the page's reads don't hold Check now back");
	});

	test("the Domains page leaves a domain alone once PostShiba verified it and DMARC is found", async () => {
		const user = await signIn("ps-settled@example.com");
		await activate(user);
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "settled.dev" }))), { ok: true, domain: "settled.dev" });
		const { _id, providerDomainId } = await m.Domain.findOne({ accountId: user.accountId }).lean();
		const reads = () => fake.callsTo("GET", new RegExp(`/sending_domains/${providerDomainId}$`)).length;
		const stored = () => m.Domain.findOne({ accountId: user.accountId, _id }).lean();
		const longAgo = new Date(Date.now() - 120_000);
		fake.verifyDomain("settled.dev");
		txts.set("_dmarc.settled.dev", [["v=DMARC1; p=none;"]]);
		await m.Domain.updateOne({ accountId: user.accountId, _id }, { $set: { checkedAt: longAgo } });
		await as(user, () => m.domainsPage.default());
		const read = await stored();
		assert.deepEqual([read.verified, read.mailFromStatus, read.dmarc.status], [true, "SUCCESS", "found"]);

		const readsBefore = reads();
		await m.Domain.updateOne({ accountId: user.accountId, _id }, { $set: { checkedAt: longAgo, readAt: longAgo } });
		await as(user, () => m.domainsPage.default());
		assert.equal(reads(), readsBefore);
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(_id))), { ok: true, verified: true });
	});

	test("a verified domain is ready and nothing asks for a website record, on the page or in the API, with or without a website target", async () => {
		const user = await customer("ps-no-archive@example.com", "ps-no-archive");
		const listDomain = async () => (await as(user, () => m.dashboard.runDashboardAction("list_domains"))).output.domains[0];
		const renderPage = async () => renderToStaticMarkup(createElement(m.TooltipProvider, null, await as(user, () => m.domainsPage.default())));

		for (const target of ["", "cname.mailcheap.ai"]) {
			await withEnv({ ARCHIVE_CNAME_TARGET: target }, async () => {
				const domain = await listDomain();
				assert.equal(domain.status, "Ready", target);
				assert.deepEqual(domain.setup.map(({ key }) => key), ["dkim", "mail-from", "dmarc"]);
				const page = await renderPage();
				assert.doesNotMatch(page, /Website and links|website waiting|Waiting for DNS/);
				assert.match(page, /Send from an address at your domain\.</);
			});
		}
	});
});

describe("PostShiba on one cluster", () => {
	test("without a transactional cluster, each tenant gets one credential and every email goes out on the bulk cluster", async () => {
		await withEnv({ POSTSHIBA_TRANSACTIONAL_CLUSTER_ID: "" }, async () => {
			const user = await customer("ps-single@example.com", "ps-single");
			const { postshiba } = await loadAccount(user);
			const credentials = [...fake.state.credentials.values()].filter((item) => item.tenant_id === postshiba.tenantId);
			assert.deepEqual(credentials.map(({ cluster_id }) => cluster_id), [POSTSHIBA.bulkClusterId], "one credential, on the one cluster");
			assert.equal(postshiba.transactionalCredential.credentialId, postshiba.bulkCredential.credentialId);
			assert.equal(postshiba.transactionalCredential.clusterId, POSTSHIBA.bulkClusterId);

			const id = await draft(user);
			assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
			assert.equal(fake.state.sends.at(-1).clusterId, POSTSHIBA.bulkClusterId, "test emails too");

			const clusters = await m.postshibaAdapter.getClusters({ fresh: true });
			assert.equal(clusters.isSingle, true);
			assert.equal(clusters.transactional.id, POSTSHIBA.bulkClusterId);
		});
	});
});

describe("PostShiba sending", () => {
	test("test emails go through POST /sends on the transactional cluster, with the message id as Idempotency-Key", async () => {
		const user = await customer("ps-test@example.com", "ps-test");
		const id = await draft(user, "Issue 7");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });

		const message = await m.Message.findOne({ accountId: user.accountId, kind: "test" }).lean();
		const { clusterId, key, body, response } = fake.state.sends.at(-1);
		assert.equal(clusterId, POSTSHIBA.transactionalClusterId);
		assert.equal(key, String(message._id));
		assert.equal(body.tenant, user.account.postshiba.tenantId);
		assert.equal(body.from, '"Jane" <hello@ps-test.dev>');
		assert.deepEqual(body.to, ["ps-test@example.com"]);
		assert.equal(body.subject, "[Test] Issue 7");
		assert.match(body.headers["List-Unsubscribe"], /\/api\/unsubscribe\?token=/);
		assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
		assert.equal(body.headers["Feedback-ID"], `${id}:mc-${user.accountId}:test:mailcheap`, "PostShiba writes its own in its place, led by the same mc-<accountId>");
		assert.deepEqual(body.unique_args, { account_id: String(user.accountId), message_id: String(message._id), kind: "test", campaign_id: id });
		assert.ok(response.message_id);
		assert.equal(message.providerMessageId, undefined, "the Message-ID /sends answers with isn't the id PostShiba's events carry");
		assert.equal(message.status, "sent");
	});

	test("a test email's events from PostShiba, under PostShiba's own message id, mark it delivered", async () => {
		const user = await customer("ps-delivered@example.com", "ps-delivered");
		const id = await draft(user, "Issue 8");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		const { body } = fake.state.sends.at(-1);
		const sgMessageId = crypto.randomBytes(16).toString("hex");
		const event = (type, fields = {}) => ({
			event: type,
			email: "ps-delivered@example.com",
			timestamp: Math.floor(Date.now() / 1000),
			sg_event_id: `capsule-${crypto.randomUUID()}`,
			sg_message_id: sgMessageId,
			"smtp-id": `<${fake.state.sends.at(-1).response.message_id}>`,
			tenant_id: user.account.postshiba.tenantSlug,
			...body.unique_args,
			unique_args: body.unique_args,
			...fields,
		});

		for (const type of ["processed", "delivered"]) {
			const response = await postWebhook(event(type, type === "delivered" && { response: "250 2.0.0 OK gsmtp" }));
			assert.deepEqual(await response.json(), { ok: true, handled: 1 }, type);
		}
		const message = await m.Message.findOne({ accountId: user.accountId, kind: "test", campaignId: id }).lean();
		assert.equal(message.status, "delivered");
		assert.ok(message.deliveredAt);
		assert.equal(message.providerMessageId, sgMessageId, "matched from then on by PostShiba's id");
	});

	test("campaigns go out over HTTP inject on the bulk cluster with the tenant's SMTP login", async () => {
		const user = await customer("ps-campaign@example.com", "ps-campaign");
		await importContacts(user, ["one@example.org", "two@example.org"]);
		const id = await draft(user, "Weekly");
		const before = fake.state.injects.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await runJobs();

		const injects = fake.state.injects.slice(before);
		assert.deepEqual(injects.map(({ body }) => body.recipients[0].email).sort(), ["one@example.org", "two@example.org"]);
		assert.ok(injects.every(({ username, tenantId }) => username === user.account.postshiba.bulkCredential.username && tenantId === user.account.postshiba.tenantId));
		const [{ body }] = injects;
		assert.equal(body.envelope_sender, "hello@ps-campaign.dev");
		assert.equal(body.template_dialect, "Static");
		assert.match(body.content.html_body, /Hello \{\{ name \}\}/, "a {{ stays as written");
		const args = JSON.parse(body.content.headers["X-Capsule-Unique-Args"]);
		assert.deepEqual(Object.keys(args).sort(), ["account_id", "campaign_id", "kind", "message_id"]);
		assert.equal(args.account_id, String(user.accountId));
		assert.equal(args.kind, "campaign");
		assert.ok(await m.Message.exists({ accountId: user.accountId, _id: args.message_id, status: "sent" }));
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
	});

	test("a full bulk cluster puts the batch back, and QStash brings it after the cap resets", async () => {
		const user = await customer("ps-full@example.com", "ps-full");
		await importContacts(user, ["full1@example.org", "full2@example.org"]);
		const id = await draft(user, "Capped");
		fake.fail({ path: /^\/inject$/, status: 429, body: { error: "hourly send limit reached" } });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const response = await runNextJob();
		assert.equal(response.status, 200);
		assert.equal((await response.json()).republished, true);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2, "nothing lost");

		const retry = published.at(-1);
		assert.ok(retry.url.endsWith("/api/jobs/send-batch"));
		assert.ok(retry.notBefore >= Math.floor(Date.now() / 1000) + 60, "after the cap resets, not in a loop");
		assert.deepEqual(retry.flowControl, { key: `account-${user.accountId}`, parallelism: 1 });
		await runJobs();
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "sent" }), 2);
	});

	test("an address PostShiba suppresses is skipped and kept out of the account's next sends", async () => {
		const user = await customer("ps-suppressed@example.com", "ps-suppressed");
		fake.suppress(user.account.postshiba.tenantId, "gone@example.org");
		await importContacts(user, ["gone@example.org", "here@example.org"]);
		const id = await draft(user, "Hello");
		await as(user, () => m.campaigns.sendCampaign(id, {}));
		await runJobs();

		const messages = await m.Message.find({ accountId: user.accountId, campaignId: id }).lean();
		assert.deepEqual(Object.fromEntries(messages.map(({ email, status }) => [email, status])), { "gone@example.org": "suppressed", "here@example.org": "sent" });
		const suppression = await m.Suppression.findOne({ accountId: user.accountId, email: "gone@example.org" }).lean();
		assert.equal(suppression.reason, "provider");
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
	});

	test("before PostShiba approves production sending, a campaign pauses with the reason, and the admins hear of it once", async () => {
		const user = await customer("ps-kyc@example.com", "ps-kyc");
		await importContacts(user, ["kyc@example.org"]);
		const id = await draft(user, "Waiting");
		const emailsBefore = platformEmails.length;
		fake.fail({ path: /^\/inject$/, status: 200, body: { success_count: 0, fail_count: 1, failed_recipients: ["kyc@example.org"], errors: ["550 kyc_required"] } });
		await as(user, () => m.campaigns.sendCampaign(id, {}));
		await runJobs();
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.match(campaign.pauseReason, /hasn't approved production sending/);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "waits for the resume");

		fake.fail({ method: "POST", path: /\/sends$/, status: 403, body: { error: "kyc_required", field: "to" } });
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /hasn't approved production sending/);
		const toAdmins = platformEmails.slice(emailsBefore).filter(({ to }) => to.includes("admin@example.com"));
		assert.deepEqual(toAdmins.map(({ subject }) => subject), ["[MailCheap] PostShiba refuses MailCheap's sends"], "the campaign and the test are the same problem");
		assert.match(toAdmins[0].text, new RegExp(`Account ${user.accountId}: PostShiba hasn't approved production sending yet \\(kyc_required\\)\\.\\nReaders' emails are refused until PostShiba approves the team\\.`));
	});

	test("PostShiba refusing an account's login once puts the batch back 10 minutes later, and only the admin page hears of it", async () => {
		const user = await customer("ps-refused@example.com", "ps-refused");
		await importContacts(user, ["blip@example.org"]);
		const id = await draft(user, "Blip");
		await withEnv(TELEGRAM, async () => {
			const before = { emails: platformEmails.length, telegram: telegramMessages.length };
			fake.fail(REFUSED_LOGIN);
			assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
			const response = await runNextJob();
			assert.equal((await response.json()).republished, true);
			assert.ok(published.at(-1).notBefore >= Math.floor(Date.now() / 1000) + 590, "10 minutes later");
			assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sending", "not paused");
			assert.deepEqual(platformEmails.slice(before.emails), [], "neither its owner nor the admins are emailed");
			assert.equal(telegramMessages.length, before.telegram);
			const alert = await m.Alert.findOne({ accountId: null, key: `credential-refused:${user.accountId}` }).lean();
			assert.equal(alert.occurrences.at(-1).detail, `Account ${user.accountId}: PostShiba refused the account's SMTP credential (401).`);

			await runJobs();
			assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent", "it went out on the next try");
		});
	});

	test("refused three times within the hour, a campaign pauses for its owner, and a second account refused within the hour alerts the admins", async () => {
		await m.Alert.updateMany({ key: /^credential-refused:/ }, { $set: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
		const user = await customer("ps-refused-again@example.com", "ps-refused-again");
		const other = await customer("ps-refused-too@example.com", "ps-refused-too");
		await importContacts(user, ["again@example.org"]);
		await importContacts(other, ["too@example.org"]);
		const id = await draft(user, "Again");
		const otherId = await draft(other, "Too");
		await withEnv({ ...TELEGRAM, URGENT_REPLY_TO: "owner-help@example.com" }, async () => {
			const before = { emails: platformEmails.length, telegram: telegramMessages.length };
			fake.fail({ ...REFUSED_LOGIN, times: 3 });
			await as(user, () => m.campaigns.sendCampaign(id, {}));
			await runJobs();
			const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
			assert.deepEqual([campaign.status, campaign.pauseReason], ["paused", "PostShiba refused the account's SMTP credential (401)"]);
			assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "waits for the resume");
			const told = platformEmails.slice(before.emails).map(({ to, subject, reply_to }) => [to.join(), subject, reply_to]);
			assert.deepEqual(told, [["ps-refused-again@example.com", "[MailCheap] Campaign paused", "hello@mailcheap.ai"]], "its owner, not the admins, and a resume lifts it");
			assert.equal(telegramMessages.length, before.telegram);

			fake.fail(REFUSED_LOGIN);
			await as(other, () => m.campaigns.sendCampaign(otherId, {}));
			await runNextJob();
			const toAdmins = platformEmails.slice(before.emails).filter(({ to }) => to.includes("admin@example.com"));
			assert.deepEqual(toAdmins.map(({ subject }) => subject), ["[MailCheap] PostShiba refuses MailCheap's sends"]);
			assert.match(toAdmins[0].text, new RegExp(`It refused the logins of 2 accounts within the hour, account ${other.accountId} last`));
			assert.deepEqual(
				telegramMessages.slice(before.telegram).map(({ text }) => text.split("\n")[0]),
				["<b>MailCheap</b> · PostShiba refuses MailCheap's sends"]
			);
			await runJobs();
			assert.equal((await m.Campaign.findOne({ accountId: other.accountId, _id: otherId }).lean()).status, "sent");
		});
	});

	test("PostShiba refusing a paying customer's domain pauses their campaign and tells the admins on Telegram: the newsletter, its plan, the emails waiting and never a reader's address", async () => {
		const user = await customer("ps-suspended@example.com", "ps-suspended");
		await importContacts(user, ["first-reader@example.org", "second-reader@example.org"]);
		const id = await draft(user, "Suspended");
		await withEnv({ ...TELEGRAM, URGENT_REPLY_TO: "owner-help@example.com" }, async () => {
			const before = { emails: platformEmails.length, telegram: telegramMessages.length };
			const errors = ["first-reader@example.org: 550 domain_suspended\nstack traceback:\n\t[C]: in function 'kumo.reject'"];
			fake.fail({ path: /^\/inject$/, status: 200, body: { success_count: 0, fail_count: 1, failed_recipients: ["first-reader@example.org"], errors } });
			await as(user, () => m.campaigns.sendCampaign(id, {}));
			await runJobs();
			assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "paused");
			assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2, "both wait for the resume");

			const emails = platformEmails.slice(before.emails);
			const toOwner = emails.filter(({ to }) => to.includes("ps-suspended@example.com"));
			assert.deepEqual(toOwner.map(({ subject }) => subject), ["[MailCheap] Campaign paused"]);
			assert.equal(toOwner[0].reply_to, "owner-help@example.com", "they can't lift it: their reply reaches an admin's own inbox");
			const toAdmins = emails.filter(({ to }) => to.includes("admin@example.com"));
			assert.deepEqual(toAdmins.map(({ subject }) => subject), ["[MailCheap] A paying customer can't send"]);
			const telegram = telegramMessages.slice(before.telegram);
			assert.deepEqual(telegram.map(({ text }) => text.split("\n")[0]), ["<b>MailCheap</b> · A paying customer can't send"]);
			for (const text of [toAdmins[0].text, telegram[0].text]) {
				assert.match(text, /ps-suspended \(ps-suspended\.dev, Starter plan\): PostShiba refuses its emails \(domain_suspended\)\. Its campaign paused with 2 emails waiting\./);
				assert.match(text, /Nothing on their dashboard lifts it: ask PostShiba why, or lift it there\. Then they resume the campaign\./);
				assert.match(text, new RegExp(`/admin/campaigns/${id}`));
				assert.doesNotMatch(text, /reader@|stack traceback/);
			}
		});
	});

	test("PostShiba refusing a newsletter's signup emails tells the admins once a day, each refusal counted", async () => {
		const user = await customer("ps-signups@example.com", "ps-signups");
		await as(user, () =>
			m.newsletters.saveNewsletter(
				null,
				form({ id: user.newsletterId, name: user.slug, slug: user.slug, fromName: "Jane", fromEmail: "hello@ps-signups.dev", postalAddress: "1 Main St", welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeContent: "Thanks for joining." })
			)
		);
		await withEnv(TELEGRAM, async () => {
			const before = { emails: platformEmails.length, telegram: telegramMessages.length };
			fake.fail({ method: "POST", path: /\/sends$/, status: 403, body: { error: "domain_suspended", field: "from", message: "is suspended" }, times: 2 });
			await welcomeNewContact(user, "signup-one@example.org");
			await welcomeNewContact(user, "signup-two@example.org");
			assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: "welcome", status: "failed" }), 2);

			const alert = await m.Alert.findOne({ accountId: null, key: `customer-blocked:${user.newsletterId}` }).lean();
			assert.equal(alert.count, 2);
			const toAdmins = platformEmails.slice(before.emails).filter(({ to }) => to.includes("admin@example.com"));
			assert.deepEqual(toAdmins.map(({ subject }) => subject), ["[MailCheap] A paying customer can't send"], "once a day");
			assert.match(toAdmins[0].text, /ps-signups \(ps-signups\.dev, Starter plan\): PostShiba refuses its emails \(domain_suspended\)\. Its welcome emails fail\./);
			assert.match(toAdmins[0].text, new RegExp(`/admin/newsletters/${user.newsletterId}`));
			assert.equal(telegramMessages.length - before.telegram, 1);
		});
	});

	test("a welcome email PostShiba throttles is retried later with the same Idempotency-Key", async () => {
		const user = await customer("ps-welcome@example.com", "ps-welcome");
		await as(user, () =>
			m.newsletters.saveNewsletter(
				null,
				form({
					id: user.newsletterId,
					name: user.slug,
					slug: user.slug,
					fromName: "Jane",
					fromEmail: "hello@ps-welcome.dev",
					postalAddress: "1 Main St",
					welcomeEnabled: "on",
					welcomeSubject: "Welcome",
					welcomeContent: "Thanks for joining.",
				})
			)
		);
		fake.fail({ method: "POST", path: /\/sends$/, status: 429, body: { error: "throttled", field: "base", message: "This cluster hit its hourly send limit" } });
		const sendsBefore = fake.state.sends.length;
		const queued = await welcomeNewContact(user, "new-reader@example.org");
		assert.equal(queued.retry, true);
		const message = await m.Message.findOne({ accountId: user.accountId, kind: "welcome" }).lean();
		assert.equal(message.status, "queued", "kept for later");
		assert.equal(fake.state.sends.length, sendsBefore);
		const retry = published.at(-1);
		assert.deepEqual(retry.body, { accountId: String(user.accountId), messageIds: [String(message._id)] });
		assert.ok(retry.notBefore > Math.floor(Date.now() / 1000) + 60);

		await runJobs();
		assert.equal(fake.state.sends.at(-1).key, String(message._id));
		assert.equal((await m.Message.findOne({ accountId: user.accountId, _id: message._id }).lean()).status, "sent");
	});
});

describe("Feedback-ID on every email", () => {
	test("a campaign's steps and last-chance emails over inject, signup and test emails over /sends: the campaign or newsletter, the account, the kind", async () => {
		const user = await customer("ps-feedback@example.com", "ps-feedback");
		const account = `mc-${user.accountId}`;
		await importContacts(user, ["first@example.org", "second@example.org", "third@example.org"]);
		const id = await draft(user, "Feedback");
		const injected = fake.state.injects.length;

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, { audienceLimit: 1 })), { ok: true });
		await runJobs();
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaignToMore(id, { additional: 1 })), { ok: true });
		await runJobs();
		const steps = fake.state.injects.slice(injected);
		assert.equal(steps.length, 2, "the first step and the next");
		assert.deepEqual(
			steps.map(({ body }) => body.content.headers["Feedback-ID"]),
			[`${id}:${account}:campaign:mailcheap`, `${id}:${account}:campaign:mailcheap`],
			"the campaign's, the same on each of its emails"
		);

		const third = await m.Contact.findOne({ accountId: user.accountId, email: "third@example.org" }).lean();
		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { status: "sending" } });
		const lastChance = await m.Message.create({ accountId: user.accountId, campaignId: id, newsletterId: user.newsletterId, contactId: third._id, email: third.email, kind: "last-chance" });
		assert.equal((await m.sending.sendMessageBatch({ accountId: String(user.accountId), messageIds: [String(lastChance._id)] })).sent, 1);
		assert.equal(fake.state.injects.at(-1).body.content.headers["Feedback-ID"], `${id}:${account}:last-chance:mailcheap`);

		await as(user, () =>
			m.newsletters.saveNewsletter(
				null,
				form({ id: user.newsletterId, name: user.slug, slug: user.slug, fromName: "Jane", fromEmail: "hello@ps-feedback.dev", postalAddress: "1 Main St", welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeContent: "Thanks for joining." })
			)
		);
		const sent = fake.state.sends.length;
		assert.equal((await welcomeNewContact(user, "welcome-reader@example.org")).sent, 1);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const pending = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "pending-reader@example.org", status: "pending" });
		assert.equal((await m.sending.queueConfirmationEmail({ newsletter, contact: pending })).sent, 1);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.deepEqual(await as(user, () => m.newsletters.sendWelcomeTest(user.newsletterId)), { ok: true });
		assert.deepEqual(
			fake.state.sends.slice(sent).map(({ body }) => body.headers["Feedback-ID"]),
			[
				`${user.newsletterId}:${account}:welcome:mailcheap`,
				`${user.newsletterId}:${account}:confirmation:mailcheap`,
				`${id}:${account}:test:mailcheap`,
				`${user.newsletterId}:${account}:test:mailcheap`,
			]
		);
	});
});

describe("clusters", () => {
	test("last-chance emails go out like issues, over HTTP inject on the bulk cluster with the tenant's SMTP login", async () => {
		const user = await customer("ps-last-chance@example.com", "ps-last-chance");
		const provider = m.postshibaAdapter.postshibaProvider;
		const tenant = await provider.ensureTenant(user.account);
		const message = { _id: new mongoose.Types.ObjectId(), accountId: user.accountId, kind: "last-chance", campaignId: new mongoose.Types.ObjectId() };
		const email = { from: '"Jane" <hello@ps-last-chance.dev>', to: "cold@example.org", subject: "Still want it?", html: "<p>Keep it?</p>", text: "Keep it?", headers: {} };
		const before = { injects: fake.state.injects.length, sends: fake.state.sends.length };

		await provider.sendEmail({ tenant, message, email });
		assert.equal(fake.state.injects.length, before.injects + 1);
		assert.equal(fake.state.sends.length, before.sends, "nothing on the transactional cluster");
		const injected = fake.state.injects.at(-1);
		assert.deepEqual([injected.tenantId, injected.body.recipients], [tenant.tenantId, [{ email: "cold@example.org" }]]);
		assert.equal(JSON.parse(injected.body.content.headers["X-Capsule-Unique-Args"]).kind, "last-chance");
		assert.equal(provider.getSendLane("last-chance").name, "postshiba-bulk", "paced with the issues");
	});
});

describe("the shared address on PostShiba", () => {
	test("a newsletter without its own domain gets its own subdomain in its own tenant, with PostShiba's CNAMEs on Vercel DNS", async () => {
		const user = await signIn("ps-shared@example.com");
		await activate(user);
		await createNewsletter(user, "ps-shared");
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		const subdomain = "ps-shared.mailcheapmail.com";
		assert.equal(newsletter.fromEmail, `hello@${subdomain}`);
		const atPostshiba = fake.state.domains.get(newsletter.sharedSender.providerDomainId);
		assert.equal(atPostshiba.name, subdomain);
		assert.equal(atPostshiba.tenant_id, (await loadAccount(user)).postshiba.tenantId, "a domain belongs to one tenant: the account's");
		assert.deepEqual(
			newsletter.sharedSender.dnsRecordIds.map((id) => dnsRecords.get(id)).map(({ type, name, value }) => [type, name, value]),
			[
				["CNAME", `ps1._domainkey.${subdomain}`, `${atPostshiba.id}.customers.postshiba.test`],
				["CNAME", `rp.${subdomain}`, "rp.postshiba.test"],
				["CNAME", subdomain, "cname.mailcheap.ai"],
			]
		);
		assert.equal(fake.callsTo("POST", /\/verify$/).filter(({ path }) => path.includes(atPostshiba.id)).length, 0, "no verification budget used");

		const id = await draft(user, "From the shared address");
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		const { body } = fake.state.sends.at(-1);
		assert.equal(body.from, `"Jane" <hello@${subdomain}>`);
		assert.equal(body.reply_to, "ps-shared@example.com", "replies go to the owner");
		assert.match(body.headers["List-Unsubscribe"], /^<https:\/\/ps-shared\.mailcheapmail\.com\/api\/unsubscribe\?token=/);
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender.verified, true);
	});

	test("a newsletter set up before the plan gets nothing at PostShiba or in DNS, then its subdomain when the plan starts", async () => {
		const user = await signIn("ps-early@example.com");
		const before = { tenants: fake.state.tenants.size, domains: fake.state.domains.size, records: dnsRecords.size };
		await createNewsletter(user, "ps-early");
		let newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.equal(newsletter.fromEmail, "hello@ps-early.mailcheapmail.com");
		assert.equal(newsletter.sharedSender?.domain, undefined);
		assert.deepEqual({ tenants: fake.state.tenants.size, domains: fake.state.domains.size, records: dnsRecords.size }, before);

		await m.billing.applySubscription(await loadAccount(user), subscription("ps-early"));
		newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.equal(newsletter.sharedSender.domain, "ps-early.mailcheapmail.com");
		assert.equal(fake.state.domains.get(newsletter.sharedSender.providerDomainId).tenant_id, (await loadAccount(user)).postshiba.tenantId);
		assert.equal(newsletter.sharedSender.dnsRecordIds.length, 3);
	});

	test("a setup that failed is done again by the next send, which waits until PostShiba finds the records", async () => {
		const user = await signIn("ps-waiting@example.com");
		await activate(user);
		fake.fail({ method: "POST", path: /\/sending_domains$/, status: 503, body: { error: "unavailable" } });
		await createNewsletter(user, "ps-waiting");
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender, undefined, "the newsletter is saved anyway");

		fake.state.isDnsVisible = false;
		try {
			const id = await draft(user);
			assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /hello@ps-waiting.mailcheapmail.com is still being set up/);
			const { sharedSender } = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
			assert.equal(sharedSender.domain, "ps-waiting.mailcheapmail.com", "set up again by the send");
			assert.equal(sharedSender.verified, false);

			fake.state.isDnsVisible = true;
			assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /still being set up/, "looked at once a minute at most");
			await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { "sharedSender.checkedAt": new Date(Date.now() - 120_000) } });
			assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });

			await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { fromEmail: "hello@ps-shared.mailcheapmail.com" } });
			assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /The shared address for this newsletter is hello@ps-waiting/, "never another account's");
		} finally {
			fake.state.isDnsVisible = true;
		}
	});
});

describe("PostShiba blocks", () => {
	test("blocking an account suspends its tenant: nothing it sends goes out until an admin unblocks it", async () => {
		const user = await customer("ps-pause@example.com", "ps-pause");
		const id = await draft(user);
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { welcome: { enabled: true, subject: "Hi", markdown: "Welcome." } } });
		const admin = await signIn("admin@example.com");
		const emailsBefore = platformEmails.length;
		await withEnv({ URGENT_REPLY_TO: "owner-help@example.com" }, async () => {
			assert.deepEqual(await as(admin, () => m.admin.blockAccountAction(String(user.accountId), "Review")), { ok: true });
		});
		const blocked = platformEmails.slice(emailsBefore).find(({ to }) => to.includes("ps-pause@example.com"));
		assert.deepEqual([blocked.subject, blocked.reply_to], ["[MailCheap] Account blocked", "owner-help@example.com"], "its owner's reply reaches an admin's own inbox");
		const tenantId = user.account.postshiba.tenantId;
		assert.equal(fake.state.tenants.get(tenantId).suspended, true);
		assert.equal((await loadAccount(user)).postshiba.tenantStatus, "suspended");

		const sendsBefore = fake.state.sends.length;
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /This account is blocked: Review/);
		assert.deepEqual(await welcomeNewContact(user, "paused-reader@example.org"), { skipped: "account is blocked" });
		assert.equal(fake.state.sends.length, sendsBefore, "no call to a suspended tenant");

		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.equal(fake.state.tenants.get(tenantId).suspended, false);
		const resumed = await loadAccount(user);
		assert.deepEqual([resumed.status, resumed.postshiba.tenantStatus], ["active", "active"]);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	});

	test("PostShiba's abuse team holding a tenant blocks its account, and unblocking waits for PostShiba", async () => {
		const user = await customer("ps-hold@example.com", "ps-hold");
		const other = await customer("ps-hold-other@example.com", "ps-hold-other");
		fake.hold(user.account.postshiba.tenantId);
		const id = await draft(user);
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /operator_hold/);

		const blocked = await loadAccount(user);
		assert.equal(blocked.status, "paused");
		assert.equal(blocked.pausedBy, "postshiba");
		assert.equal(blocked.pauseReason, "Our email provider stopped this account's sending", "PostShiba's own words go to the admins");
		assert.equal(blocked.postshiba.tenantStatus, "operator_hold", "the suspend that followed didn't hide the hold");
		assert.equal((await loadAccount(other)).status, "active", "other accounts keep sending");

		const admin = await signIn("admin@example.com");
		const result = await as(admin, () => m.admin.unblockAccountAction(String(user.accountId)));
		assert.match(result.error, /^Still blocked, the tenant wasn't resumed: .*holds this tenant \(operator_hold\)/);
		assert.equal((await loadAccount(user)).status, "paused");

		fake.state.tenants.get(user.account.postshiba.tenantId).held = false;
		assert.equal((await loadAccount(user)).status, "paused", "PostShiba lifting its hold doesn't unblock the account");
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.equal((await loadAccount(user)).status, "active");
	});
});
