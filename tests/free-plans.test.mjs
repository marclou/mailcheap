import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import Stripe from "stripe";
import { activate, addAuthor, addSentIssue, anonymous, as, callApi, catchNotFound, catchRedirect, form, jsonRequest, listPlanPrices, mockStripe, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";
import { state } from "./stubs/ses.mjs";

// Free plans an admin gives from /admin, through the real admin actions, sends, REST API, MCP and Stripe webhook,
// with SES, QStash and Stripe in memory.
let app;
let m;
let admin;
let processed = 0;
let calls;
let subscriptions;

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const TOMORROW = new Date(Date.now() + DAY * 1000).toISOString().slice(0, 10);
const GROWTH_MONTHLY = {
	id: "price_growth_monthly",
	object: "price",
	lookup_key: "mailcheap_growth_monthly",
	unit_amount: 3900,
	currency: "usd",
	recurring: { interval: "month" },
};

function stripeApi({ method, path, query }) {
	calls.push({ method, path });
	if (method === "GET" && path === "/v1/prices") return listPlanPrices(query);
	if (method === "GET" && path.startsWith("/v1/subscriptions/")) {
		return subscriptions.get(path.split("/").at(-1)) ?? { status: 404, error: { type: "invalid_request_error", message: "No such subscription" } };
	}
	if (method === "POST" && path === "/v1/checkout/sessions") return { id: "cs_free", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_free" };
	if (method === "POST" && path === "/v1/billing_portal/sessions") return { id: "bps_free", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/bps_free" };
	return { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } };
}

function subscription({ id, accountId, customer, status = "active" }) {
	return {
		id,
		object: "subscription",
		customer,
		status,
		metadata: { accountId: String(accountId) },
		cancel_at: null,
		cancel_at_period_end: false,
		items: {
			object: "list",
			data: [{ id: `si_${id}`, object: "subscription_item", price: GROWTH_MONTHLY, current_period_start: NOW, current_period_end: NOW + 30 * DAY }],
		},
	};
}

let eventCount = 0;
async function deliver(type, object) {
	const payload = JSON.stringify({ id: `evt_free_${++eventCount}`, object: "event", type, created: NOW, data: { object } });
	const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
	const response = await m.webhook.POST(
		new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload })
	);
	return response.json();
}

async function callTool(key, name) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result;
}

async function runSendJobs() {
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	}
}

// Signed up, with a newsletter on the shared address, and no plan yet.
async function customer(email, slug) {
	const user = await signIn(email);
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })))
	);
	user.newsletterId = url.split("/").at(-1);
	await addAuthor(user);
	user.slug = slug;
	return user;
}

async function draft(user) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

function give(user, fields) {
	return as(admin, () => m.admin.giveFreePlan(null, form({ accountId: String(user.accountId), ...fields })));
}

function end(user) {
	return as(admin, () => m.admin.endFreePlan(String(user.accountId)));
}

function load(user) {
	return m.Account.findById(user.accountId).lean();
}

async function createKey(user) {
	return as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent" })));
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		admin: await import("../app/admin/actions.js"),
		billing: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		webhook: await import("../app/api/webhooks/stripe/route.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		state: await import("../lib/account-state.js"),
		plans: await import("../lib/plans.js"),
		usage: await import("../lib/usage.js"),
		usagePeriod: await import("../lib/usage-period.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
	admin = await signIn("admin@example.com");
});

beforeEach(() => {
	calls = [];
	subscriptions = new Map();
	mockStripe(stripeApi);
});

after(() => app?.stop());

test("only admins give or end a free plan: anyone else gets a 404 and nothing changes", async () => {
	const user = await signIn("not-an-admin@example.com");
	const id = String(user.accountId);
	assert.equal(await as(user, () => catchNotFound(m.admin.giveFreePlan(null, form({ accountId: id, plan: "scale" })))), true);
	assert.equal(await anonymous(() => catchNotFound(m.admin.giveFreePlan(null, form({ accountId: id, plan: "scale" })))), true);
	assert.equal((await load(user)).comp, undefined);

	assert.equal((await give(user, { plan: "starter" })).ok, true);
	assert.equal(await as(user, () => catchNotFound(m.admin.endFreePlan(id))), true);
	const account = await load(user);
	assert.equal(account.comp.plan, "starter");
	assert.equal(account.comp.until, undefined, "still running");
	assert.deepEqual(await give(user, { plan: "enterprise" }), { error: "Pick a plan" });
});

test("a free plan opens what a paid one does: its limits, a tenant, the shared address, and the API and MCP report it", async () => {
	const user = await customer("free@example.com", "free-news");
	assert.equal((await load(user)).ses?.provisionedAt, undefined);
	assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender, undefined, "nothing before a plan");
	assert.equal((await createKey(user)).code, "subscription_required");

	assert.equal((await give(user, { plan: "scale" })).ok, true);
	const account = await load(user);
	assert.deepEqual([account.comp.plan, account.comp.by, account.comp.until], ["scale", "admin@example.com", undefined]);
	assert.equal(account.subscriptionStatus, undefined, "nothing on Stripe");
	assert.equal(m.state.hasActiveSubscription(account), true);
	assert.deepEqual(m.plans.getAccountLimits(account), { emails: 500_000, subscribers: 250_000 });
	assert.deepEqual([account.usage.emailsSent, account.usage.paidThrough], [0, null]);
	assert.equal(account.usage.periodStart.getTime(), account.comp.grantedAt.getTime(), "the month starts with the plan");
	assert.equal(account.ses.tenantName, `mc-${user.accountId}`);
	assert.ok(state.tenants.has(`mc-${user.accountId}`), "the tenant is at the email provider");
	const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
	assert.equal(newsletter.sharedSender.domain, "free-news.mailcheapmail.com", "the newsletter set up before gets its shared address");

	const { key } = await createKey(user);
	const billing = await callApi("GET", "/api/v1/billing", { key });
	assert.equal(billing.status, 200);
	assert.deepEqual(billing.body.plan, { id: "scale", name: "Scale", interval: "month", price: 0 });
	assert.deepEqual(
		{ status: billing.body.status, isActive: billing.body.isActive, currentPeriodEnd: billing.body.currentPeriodEnd },
		{ status: "active", isActive: true, currentPeriodEnd: null }
	);
	assert.deepEqual(billing.body.freePlan, { id: "scale", name: "Scale", grantedAt: account.comp.grantedAt.toISOString(), until: null });
	assert.deepEqual([billing.body.usage.emailsLimit, billing.body.usage.subscribersLimit], [500_000, 250_000]);
	const tool = await callTool(key, "get_billing");
	assert.deepEqual(tool.structuredContent.freePlan, billing.body.freePlan);
	assert.deepEqual(tool.structuredContent.plan, billing.body.plan);
});

test("on a free plan every email counts, and the count starts over each month from the day it was given", async () => {
	const user = await customer("monthly@example.com", "monthly-news");
	await give(user, { plan: "starter" });
	const rows = [
		{ email: "a@monthly.example.org", status: "active" },
		{ email: "b@monthly.example.org", status: "active" },
	];
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	const id = await draft(user);
	assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
	await runSendJobs();
	let account = await load(user);
	assert.equal(account.usage.emailsSent, 3, "the test and the two issues");

	const { addMonths } = m.usagePeriod;
	const { grantedAt } = account.comp;
	const at = (months, offset = 3_600_000) => new Date(addMonths(grantedAt, months).getTime() + offset);
	const next = await m.usage.getUsage(account, at(1));
	assert.deepEqual(
		[next.emailsSent, next.emailsLimit, next.periodStart.getTime(), next.periodEnd.getTime()],
		[0, 20_000, addMonths(grantedAt, 1).getTime(), addMonths(grantedAt, 2).getTime()],
		"a new month without any invoice"
	);

	await m.Account.updateOne({ _id: user.accountId }, { $inc: { "usage.emailsSent": 5 } });
	account = await load(user);
	assert.equal((await m.usage.getUsage(account, at(2, -3_600_000))).emailsSent, 5, "the same month keeps its count");
	const quiet = await m.usage.getUsage(account, at(5));
	assert.equal(quiet.emailsSent, 0);
	assert.equal(quiet.periodStart.getTime(), addMonths(grantedAt, 5).getTime(), "quiet months are skipped");
});

test("a free plan stops at its end date like a canceled plan: no sending, no signups, the archive offline, the data kept", async () => {
	const user = await customer("until@example.com", "until-news");
	assert.deepEqual(await give(user, { plan: "growth", until: "2020-01-01" }), { error: "Pick an end date after today, or none" });
	assert.equal((await load(user)).comp, undefined);
	assert.equal((await give(user, { plan: "growth", until: TOMORROW })).ok, true);
	assert.equal((await load(user)).comp.until.toISOString(), `${TOMORROW}T00:00:00.000Z`);
	const { key } = await createKey(user);
	assert.equal((await callApi("POST", "/api/v1/contacts", { key, body: { newsletter: user.slug, email: "early@until.example.org" } })).status, 201);
	const id = await draft(user);
	await addSentIssue(user);
	const { getArchiveNewsletter } = await import("../lib/archive-data.js");
	assert.ok(await getArchiveNewsletter(user.slug), "online before");

	await m.Account.updateOne({ _id: user.accountId }, { $set: { "comp.until": new Date(Date.now() - 1000) } });
	assert.equal(m.state.hasActiveSubscription(await load(user)), false);
	assert.equal((await as(user, () => m.campaigns.sendCampaign(id, {}))).code, "subscription_required");
	assert.equal((await callApi("POST", "/api/v1/contacts", { key, body: { newsletter: user.slug, email: "late@until.example.org" } })).status, 402);
	assert.equal(await getArchiveNewsletter(user.slug), null);
	const billing = await callApi("GET", "/api/v1/billing", { key });
	assert.deepEqual(
		{ status: billing.body.status, isActive: billing.body.isActive, freePlan: billing.body.freePlan },
		{ status: "no_plan", isActive: false, freePlan: null }
	);
	assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 1, "the contacts stay");
	assert.ok(await m.Campaign.exists({ accountId: user.accountId, _id: id }), "and the drafts");
});

test("ending a free plan stops sending at once and keeps the data; ending it again says there's none", async () => {
	const user = await customer("ended@example.com", "ended-news");
	await give(user, { plan: "pro" });
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: [{ email: "kept@ended.example.org", status: "active" }] }));
	const id = await draft(user);

	assert.deepEqual(await end(user), { ok: true });
	const account = await load(user);
	assert.ok(account.comp.until <= new Date(), "it ends now");
	assert.deepEqual([account.comp.plan, account.comp.by], ["pro", "admin@example.com"], "the record of it stays");
	assert.equal(m.state.hasActiveSubscription(account), false);
	assert.equal((await as(user, () => m.campaigns.sendTestCampaign(id))).code, "subscription_required");
	assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 1);
	assert.equal(await m.Campaign.countDocuments({ accountId: user.accountId }), 1);
	const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
	assert.equal(newsletter.sharedSender.domain, "ended-news.mailcheapmail.com", "the shared address waits for the next plan");
	assert.ok(state.tenants.has(`mc-${user.accountId}`), "and the tenant");
	assert.deepEqual(await end(user), { error: "No free plan to end" });
});

describe("with Stripe", () => {
	test("subscribing opens Checkout; the paid plan takes over with Stripe's month, and the free plan comes back when it ends", async () => {
		const user = await customer("upgrade@example.com", "upgrade-news");
		await give(user, { plan: "scale" });
		const picked = await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan: "growth", interval: "month" }))));
		assert.equal(picked, "https://checkout.stripe.com/c/pay/cs_free", "Checkout, not the portal: there's no subscription to change");
		const link = await as(user, () => catchRedirect(m.checkoutRoute.GET(new Request("http://localhost:3000/billing/checkout?plan=growth"))));
		assert.equal(link, "https://checkout.stripe.com/c/pay/cs_free", "the pricing page's buttons too");
		assert.equal(calls.some(({ path }) => path === "/v1/billing_portal/sessions"), false);

		await m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.emailsSent": 1_234 } });
		subscriptions.set("sub_up", subscription({ id: "sub_up", accountId: user.accountId, customer: "cus_up" }));
		const session = { id: "cs_up", object: "checkout.session", mode: "subscription", client_reference_id: String(user.accountId), customer: "cus_up", subscription: "sub_up" };
		await deliver("checkout.session.completed", session);
		let account = await load(user);
		assert.equal(account.subscriptionStatus, "active");
		assert.equal(m.plans.getAccountPlan(account).id, "growth");
		assert.deepEqual(m.plans.getAccountLimits(account), { emails: 75_000, subscribers: 40_000 });
		assert.deepEqual(
			[account.usage.emailsSent, account.usage.periodStart.getTime(), account.usage.paidThrough.getTime()],
			[0, NOW * 1000, (NOW + 30 * DAY) * 1000],
			"Stripe's month"
		);
		assert.equal(account.comp.plan, "scale", "the free plan waits behind it");

		const { key } = await createKey(user);
		const billing = await callApi("GET", "/api/v1/billing", { key });
		assert.deepEqual(billing.body.plan, { id: "growth", name: "Growth", interval: "month", price: 39 });
		assert.equal(billing.body.freePlan.id, "scale");
		assert.equal(billing.body.currentPeriodEnd, new Date((NOW + 30 * DAY) * 1000).toISOString());

		subscriptions.set("sub_up", subscription({ id: "sub_up", accountId: user.accountId, customer: "cus_up", status: "canceled" }));
		await deliver("customer.subscription.deleted", { id: "sub_up" });
		account = await load(user);
		assert.equal(account.subscriptionStatus, "canceled");
		assert.equal(m.state.hasActiveSubscription(account), true, "the free plan is still running");
		assert.equal(m.state.getAccountStatus(account), "active");
		assert.equal(m.plans.getAccountPlan(account).id, "scale");
		assert.deepEqual([account.usage.anchor.getTime(), account.usage.paidThrough], [account.comp.grantedAt.getTime(), null], "its months count from the grant again");

		const late = {
			id: "in_late",
			object: "invoice",
			customer: "cus_up",
			parent: { type: "subscription_details", subscription_details: { subscription: "sub_up", metadata: { accountId: String(user.accountId) } } },
			lines: { object: "list", data: [{ id: "il_late", object: "line_item", period: { start: NOW, end: NOW + 30 * DAY } }] },
		};
		assert.equal((await deliver("invoice.paid", late)).ignored, "on a free plan", "a late invoice leaves the free plan's months alone");
		assert.equal((await load(user)).usage.paidThrough, null);
	});

	test("a free plan given while Stripe bills one waits behind it, and giving it again keeps its start", async () => {
		const user = await signIn("paying@example.com");
		const paid = await activate(user, { plan: "growth" });
		assert.equal((await give(user, { plan: "scale" })).ok, true);
		let account = await load(user);
		assert.equal(m.plans.getAccountPlan(account).id, "growth");
		assert.deepEqual(account.usage, paid.usage, "the paid month is untouched");

		const { grantedAt } = account.comp;
		assert.equal((await give(user, { plan: "pro", until: TOMORROW })).ok, true);
		account = await load(user);
		assert.deepEqual([account.comp.plan, account.comp.grantedAt.getTime()], ["pro", grantedAt.getTime()]);
	});
});
