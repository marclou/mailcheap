import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import Stripe from "stripe";
import { activate, as, callApi, catchRedirect, form, mockStripe, platformEmails, readLookupKeys, signIn, startTestApp } from "./helpers/app.mjs";

// Stripe's API is answered by the handler each test gives mockStripe; events are signed like Stripe signs them.
let app;
let m;
let calls;
let subscriptions;

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

function price(lookupKey, unitAmount, interval) {
	return { id: `price_${lookupKey}`, object: "price", lookup_key: lookupKey, unit_amount: unitAmount, currency: "usd", recurring: { interval } };
}

// Scale has no prices in this Stripe, and Pro's monthly one is $99 instead of $79: neither is on sale.
const PRICES = {
	mailcheap_starter_monthly: price("mailcheap_starter_monthly", 1900, "month"),
	mailcheap_starter_yearly: price("mailcheap_starter_yearly", 19_000, "year"),
	mailcheap_growth_monthly: price("mailcheap_growth_monthly", 3900, "month"),
	mailcheap_growth_yearly: price("mailcheap_growth_yearly", 39_000, "year"),
	mailcheap_pro_monthly: price("mailcheap_pro_monthly", 9900, "month"),
	mailcheap_pro_yearly: price("mailcheap_pro_yearly", 79_000, "year"),
	mailcheap_max_monthly: price("mailcheap_max_monthly", 34_900, "month"),
	mailcheap_max_yearly: price("mailcheap_max_yearly", 349_000, "year"),
	mailcheap_ultra_monthly: price("mailcheap_ultra_monthly", 79_900, "month"),
	mailcheap_ultra_yearly: price("mailcheap_ultra_yearly", 799_000, "year"),
};

function subscription({ id, accountId, customer, status = "active", lookupKey = "mailcheap_starter_monthly", start = NOW, end = NOW + 30 * DAY, ...rest }) {
	return {
		id,
		object: "subscription",
		customer,
		status,
		metadata: accountId ? { accountId: String(accountId) } : {},
		cancel_at: null,
		cancel_at_period_end: false,
		items: {
			object: "list",
			data: [{ id: `si_${id}`, object: "subscription_item", price: PRICES[lookupKey] ?? price(lookupKey, 100, "month"), current_period_start: start, current_period_end: end }],
		},
		...rest,
	};
}

function stripeApi({ method, path, query, body }) {
	calls.push({ method, path, query, body });
	if (method === "GET" && path === "/v1/prices") {
		return { object: "list", data: readLookupKeys(query).flatMap((lookupKey) => PRICES[lookupKey] ?? []), has_more: false };
	}
	if (method === "GET" && path.startsWith("/v1/subscriptions/")) {
		const found = subscriptions.get(path.split("/").at(-1));
		return found ?? { status: 404, error: { type: "invalid_request_error", message: "No such subscription" } };
	}
	if (method === "POST" && path === "/v1/checkout/sessions") return { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
	if (method === "POST" && path === "/v1/billing_portal/sessions") return { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/bps_1" };
	if (method === "GET" && path.startsWith("/v1/checkout/sessions/")) return m.checkoutSessions.get(path.split("/").at(-1));
	return { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } };
}

function checkoutMetadata() {
	const { body } = calls.findLast(({ path }) => path === "/v1/checkout/sessions");
	return Object.fromEntries([...body].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice("metadata[".length, -1), value]));
}

let eventCount = 0;
async function deliver(type, object, { secret = process.env.STRIPE_WEBHOOK_SECRET } = {}) {
	const payload = JSON.stringify({ id: `evt_${++eventCount}`, object: "event", type, created: NOW, data: { object } });
	const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
	const response = await m.webhook.POST(new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
	return { status: response.status, body: await response.json() };
}

// An API key from the dashboard: only an account with a plan gets one.
async function createKey(user, name) {
	const { createApiKey } = await import("../app/(app)/api-keys/actions.js");
	return as(user, () => createApiKey(null, form({ name })));
}

async function account(user) {
	return m.Account.findById(user.accountId).lean();
}

function invoice({ subscriptionId, accountId, customer, start, end, reason = "subscription_cycle" }) {
	return {
		id: `in_${start}_${end}`,
		object: "invoice",
		customer,
		billing_reason: reason,
		parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId, metadata: { accountId: String(accountId) } } },
		lines: { object: "list", data: [{ id: `il_${start}`, object: "line_item", period: { start, end } }] },
	};
}

before(async () => {
	app = await startTestApp();
	m = {
		webhook: await import("../app/api/webhooks/stripe/route.js"),
		billing: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		returnRoute: await import("../app/(account)/billing/return/route.js"),
		auth: await import("../lib/auth.js"),
		plans: await import("../lib/plans.js"),
		stripe: await import("../lib/stripe.js"),
		Account: (await import("../models/Account.js")).default,
		checkoutSessions: new Map(),
	};
});

beforeEach(() => {
	calls = [];
	subscriptions = new Map();
	mockStripe(stripeApi);
});

after(() => app?.stop());

describe("webhook signatures", () => {
	test("an event with a wrong or missing signature is refused before anything changes", async () => {
		const forged = await deliver("customer.subscription.updated", { id: "sub_x" }, { secret: "whsec_someone_else" });
		assert.equal(forged.status, 400);
		const unsigned = await m.webhook.POST(new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", body: "{}" }));
		assert.equal(unsigned.status, 400);
		assert.equal(calls.length, 0, "Stripe's API wasn't called");
	});

	test("without the webhook secret the endpoint is off", async () => {
		const secret = process.env.STRIPE_WEBHOOK_SECRET;
		delete process.env.STRIPE_WEBHOOK_SECRET;
		try {
			const response = await m.webhook.POST(new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", body: "{}" }));
			assert.equal(response.status, 503);
		} finally {
			process.env.STRIPE_WEBHOOK_SECRET = secret;
		}
	});

	test("other event types are acknowledged and ignored", async () => {
		assert.deepEqual(await deliver("charge.refunded", { id: "ch_1" }), { status: 200, body: { received: true, ignored: "charge.refunded" } });
	});
});

describe("checkout", () => {
	test("picking a plan opens Checkout for the account's own subscription", async () => {
		const user = await signIn("checkout@example.com");
		const url = await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan: "growth", interval: "year" }))));
		assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_1");

		const created = calls.find(({ path }) => path === "/v1/checkout/sessions").body;
		assert.equal(created.get("mode"), "subscription");
		assert.equal(created.get("line_items[0][price]"), "price_mailcheap_growth_yearly");
		assert.equal(created.get("client_reference_id"), String(user.accountId));
		assert.equal(created.get("subscription_data[metadata][accountId]"), String(user.accountId));
		assert.equal(created.get("customer_email"), "checkout@example.com");
		assert.equal(created.get("success_url"), "http://localhost:3000/billing/return?session_id={CHECKOUT_SESSION_ID}");
	});

	test("without attribution cookies the session's metadata is the account id alone, from the plan links and the plan picker", async () => {
		const user = await signIn("metadata@example.com");
		const link = new Request("http://localhost:3000/billing/checkout?plan=growth&interval=year");
		assert.equal(await as(user, () => catchRedirect(m.checkoutRoute.GET(link))), "https://checkout.stripe.com/c/pay/cs_test_1");
		assert.deepEqual(checkoutMetadata(), { accountId: String(user.accountId) });

		const picked = await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan: "starter", interval: "month" }))));
		assert.equal(picked, "https://checkout.stripe.com/c/pay/cs_test_1");
		assert.deepEqual(checkoutMetadata(), { accountId: String(user.accountId) });
	});

	test("an API key's checkout names the account too", async () => {
		const user = await signIn("api-checkout@example.com");
		await activate(user);
		const { key } = await createKey(user, "Server");
		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });

		const response = await callApi("POST", "/api/v1/billing/change-plan", { key, body: { plan: "growth" } });
		assert.deepEqual(response.body, { url: "https://checkout.stripe.com/c/pay/cs_test_1", kind: "checkout" });
		assert.deepEqual(checkoutMetadata(), { accountId: String(user.accountId) });
	});

	test("a Stripe price that doesn't match the plan file, or a plan without its prices, is never offered nor reaches Checkout", async () => {
		const user = await signIn("mismatch@example.com");
		const real = PRICES.mailcheap_pro_monthly;
		assert.equal(real.unit_amount, 9900, "Stripe says $99, the plan says $79");
		for (const plan of ["pro", "scale"]) {
			const url = await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan, interval: "year" }))));
			assert.equal(url, "/billing", `${plan}: the billing page, which shows the plans on sale`);
			const link = await as(user, () => catchRedirect(m.checkoutRoute.GET(new Request(`http://localhost:3000/billing/checkout?plan=${plan}`))));
			assert.equal(link, "/billing?interval=month", `${plan}: the plan buttons too`);
		}
		assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false);
		assert.deepEqual(
			(await m.stripe.findPlansOnSale()).map(({ id }) => id),
			["starter", "growth", "max", "ultra"]
		);
	});

	test("Max and Ultra open Checkout with their own prices, like any plan on sale", async () => {
		const user = await signIn("max-checkout@example.com");
		for (const plan of ["max", "ultra"]) {
			for (const [interval, period] of [
				["year", "yearly"],
				["month", "monthly"],
			]) {
				assert.equal(await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan, interval })))), "https://checkout.stripe.com/c/pay/cs_test_1");
				assert.equal(calls.findLast(({ path }) => path === "/v1/checkout/sessions").body.get("line_items[0][price]"), `price_mailcheap_${plan}_${period}`);
			}
		}
	});

	test("checkout.session.completed turns the plan on and starts the month", async () => {
		const user = await signIn("paid@example.com");
		subscriptions.set("sub_paid", subscription({ id: "sub_paid", accountId: user.accountId, customer: "cus_paid", lookupKey: "mailcheap_growth_monthly" }));
		const result = await deliver("checkout.session.completed", {
			id: "cs_paid",
			object: "checkout.session",
			mode: "subscription",
			client_reference_id: String(user.accountId),
			customer: "cus_paid",
			subscription: "sub_paid",
		});
		assert.equal(result.status, 200);

		const paid = await account(user);
		assert.equal(paid.stripeCustomerId, "cus_paid");
		assert.equal(paid.stripeSubscriptionId, "sub_paid");
		assert.equal(paid.subscriptionStatus, "active");
		assert.equal(paid.plan, "growth");
		assert.equal(paid.interval, "month");
		assert.equal(paid.currentPeriodStart.getTime(), NOW * 1000);
		assert.equal(paid.currentPeriodEnd.getTime(), (NOW + 30 * DAY) * 1000);
		assert.equal(paid.usage.emailsSent, 0);
		assert.equal(paid.usage.paidThrough.getTime(), (NOW + 30 * DAY) * 1000);
		assert.ok((await createKey(user, "Paid")).key, "what needs a plan opens");
	});

	test("coming back from Checkout turns the plan on before the webhook, then opens the dashboard", async () => {
		const user = await signIn("returning@example.com");
		subscriptions.set("sub_return", subscription({ id: "sub_return", accountId: user.accountId, customer: "cus_return" }));
		m.checkoutSessions.set("cs_return", { id: "cs_return", object: "checkout.session", mode: "subscription", status: "complete", client_reference_id: String(user.accountId), customer: "cus_return", subscription: "sub_return" });
		const url = await as(user, () => catchRedirect(m.returnRoute.GET(new Request("http://localhost:3000/billing/return?session_id=cs_return"))));
		assert.equal(url, "/");
		assert.equal((await account(user)).subscriptionStatus, "active");
	});

	test("another account's checkout session doesn't turn a plan on", async () => {
		const owner = await signIn("owner@example.com");
		const visitor = await signIn("visitor@example.com");
		subscriptions.set("sub_owner", subscription({ id: "sub_owner", accountId: owner.accountId, customer: "cus_owner" }));
		m.checkoutSessions.set("cs_owner", { id: "cs_owner", object: "checkout.session", mode: "subscription", status: "complete", client_reference_id: String(owner.accountId), customer: "cus_owner", subscription: "sub_owner" });
		const url = await as(visitor, () => catchRedirect(m.returnRoute.GET(new Request("http://localhost:3000/billing/return?session_id=cs_owner"))));
		assert.equal(url, "/billing?checkout=pending");
		assert.equal((await account(visitor)).subscriptionStatus, undefined);
		assert.equal((await account(owner)).subscriptionStatus, undefined, "nothing changed for the owner either");
	});
});

describe("subscription changes", () => {
	let user;

	before(async () => {
		user = await signIn("lifecycle@example.com");
		subscriptions.set("sub_life", subscription({ id: "sub_life", accountId: user.accountId, customer: "cus_life" }));
		await deliver("customer.subscription.created", { id: "sub_life" });
	});

	test("an upgrade changes the plan; a scheduled cancel is shown, and undone", async () => {
		subscriptions.set("sub_life", subscription({ id: "sub_life", accountId: user.accountId, customer: "cus_life", lookupKey: "mailcheap_growth_yearly", end: NOW + 365 * DAY }));
		await deliver("customer.subscription.updated", { id: "sub_life" });
		let current = await account(user);
		assert.equal(current.plan, "growth");
		assert.equal(current.interval, "year");

		subscriptions.set("sub_life", { ...subscriptions.get("sub_life"), cancel_at_period_end: true });
		await deliver("customer.subscription.updated", { id: "sub_life" });
		current = await account(user);
		assert.equal(current.cancelAt.getTime(), (NOW + 365 * DAY) * 1000);

		subscriptions.set("sub_life", { ...subscriptions.get("sub_life"), cancel_at_period_end: false });
		await deliver("customer.subscription.updated", { id: "sub_life" });
		assert.equal((await account(user)).cancelAt, undefined);
	});

	test("the event's own copy is never trusted: the subscription is read from Stripe", async () => {
		subscriptions.set("sub_life", subscription({ id: "sub_life", accountId: user.accountId, customer: "cus_life", lookupKey: "mailcheap_growth_yearly", end: NOW + 365 * DAY }));
		const result = await deliver("customer.subscription.updated", { id: "sub_life", status: "canceled", items: { data: [] } });
		assert.deepEqual(result, { status: 200, body: { received: true, updated: true, status: "active" } });
		assert.equal((await account(user)).subscriptionStatus, "active");
	});

	test("when Stripe can't be read the webhook answers 500, so Stripe retries, and the admins hear of it", async () => {
		const error = console.error;
		console.error = () => {};
		const emailsBefore = platformEmails.length;
		try {
			const result = await deliver("customer.subscription.updated", { id: "sub_missing" });
			assert.equal(result.status, 500);
		} finally {
			console.error = error;
		}
		const [alert] = platformEmails.slice(emailsBefore);
		assert.deepEqual([alert.to, alert.subject], [["admin@example.com"], "[MailCheap] Stripe event not handled"]);
		assert.match(alert.text, new RegExp(`customer\\.subscription\\.updated evt_${eventCount}: No such subscription\\.\\nStripe retries it for 3 days`));
		assert.match(alert.text, /\nhttps:\/\/dashboard\.stripe\.com\/webhooks$/);
	});

	test("a price with an unknown lookup key keeps the plan and logs it", async () => {
		const logged = [];
		const error = console.error;
		console.error = (...args) => logged.push(args.join(" "));
		try {
			subscriptions.set("sub_life", subscription({ id: "sub_life", accountId: user.accountId, customer: "cus_life", lookupKey: "old_price_2024" }));
			await deliver("customer.subscription.updated", { id: "sub_life" });
		} finally {
			console.error = error;
		}
		assert.equal((await account(user)).plan, "growth");
		assert.ok(logged.some((line) => line.includes("unknown lookup key")));
	});

	test("an older subscription ending doesn't cancel the current one", async () => {
		subscriptions.set("sub_old", subscription({ id: "sub_old", accountId: user.accountId, customer: "cus_life", status: "canceled" }));
		const result = await deliver("customer.subscription.deleted", { id: "sub_old" });
		assert.equal(result.body.ignored, "an older subscription");
		assert.equal((await account(user)).subscriptionStatus, "active");
	});

	test("deletion ends access: what needs a plan opens the paywall on the dashboard, and the API answers 402", async () => {
		const { key } = await createKey(user, "Site");
		subscriptions.set("sub_life", subscription({ id: "sub_life", accountId: user.accountId, customer: "cus_life", status: "canceled", lookupKey: "mailcheap_growth_yearly" }));
		await deliver("customer.subscription.deleted", { id: "sub_life" });

		const ended = await account(user);
		assert.equal(ended.subscriptionStatus, "canceled");
		assert.equal(ended.plan, "growth", "the data and the last plan are kept");
		assert.equal((await createKey(user, "Another")).code, "subscription_required");
		const response = await callApi("POST", "/api/v1/contacts", { key, body: { newsletter: "x", email: "a@example.com" } });
		assert.equal(response.status, 402);
		assert.deepEqual(response.body, { error: { code: "subscription_required", message: "The account has no active plan" } });
	});
});

describe("Max and Ultra", () => {
	for (const [plan, name, yearlyPrice, emails, subscribers] of [
		["max", "Max", 3490, 2_000_000, 1_000_000],
		["ultra", "Ultra", 7990, 5_000_000, 2_500_000],
	]) {
		test(`a subscription to ${name}'s prices gives the account ${name} and its limits, and get_billing says so`, async () => {
			const user = await signIn(`${plan}-webhook@example.com`);
			const id = `sub_${plan}`;
			const customer = `cus_${plan}`;
			subscriptions.set(id, subscription({ id, accountId: user.accountId, customer, lookupKey: `mailcheap_${plan}_yearly`, end: NOW + 365 * DAY }));
			assert.deepEqual(await deliver("customer.subscription.created", { id }), { status: 200, body: { received: true, updated: true, status: "active" } });

			const paid = await account(user);
			assert.deepEqual([paid.plan, paid.interval, paid.subscriptionStatus], [plan, "year", "active"]);
			assert.deepEqual(m.plans.getAccountLimits(paid), { emails, subscribers });
			const { key } = await createKey(user, name);
			const billing = await callApi("GET", "/api/v1/billing", { key });
			assert.deepEqual(billing.body.plan, { id: plan, name, interval: "year", price: yearlyPrice });
			assert.deepEqual([billing.body.usage.emailsLimit, billing.body.usage.subscribersLimit], [emails, subscribers]);

			subscriptions.set(id, subscription({ id, accountId: user.accountId, customer, lookupKey: "mailcheap_growth_monthly" }));
			await deliver("customer.subscription.updated", { id });
			assert.equal((await account(user)).plan, "growth", "and a change away from it too");
		});
	}
});

describe("invoice.paid", () => {
	test("a payment for the next period starts the month over; the same invoice again doesn't", async () => {
		const user = await signIn("invoices@example.com");
		subscriptions.set("sub_inv", subscription({ id: "sub_inv", accountId: user.accountId, customer: "cus_inv" }));
		await deliver("customer.subscription.created", { id: "sub_inv" });
		await m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.emailsSent": 12_345 } });

		const first = invoice({ subscriptionId: "sub_inv", accountId: user.accountId, customer: "cus_inv", start: NOW, end: NOW + 30 * DAY, reason: "subscription_create" });
		assert.equal((await deliver("invoice.paid", first)).body.reset, false, "the first invoice pays the period already started");
		assert.equal((await account(user)).usage.emailsSent, 12_345);

		const renewal = invoice({ subscriptionId: "sub_inv", accountId: user.accountId, customer: "cus_inv", start: NOW + 30 * DAY, end: NOW + 60 * DAY });
		assert.equal((await deliver("invoice.paid", renewal)).body.reset, true);
		let current = await account(user);
		assert.equal(current.usage.emailsSent, 0);
		assert.equal(current.usage.periodStart.getTime(), (NOW + 30 * DAY) * 1000);

		await m.Account.updateOne({ _id: user.accountId }, { $inc: { "usage.emailsSent": 40 } });
		assert.equal((await deliver("invoice.paid", renewal)).body.reset, false, "redelivered");
		current = await account(user);
		assert.equal(current.usage.emailsSent, 40, "emails sent since the renewal still count");

		const upgrade = invoice({ subscriptionId: "sub_inv", accountId: user.accountId, customer: "cus_inv", start: NOW + 40 * DAY, end: NOW + 60 * DAY, reason: "subscription_update" });
		assert.equal((await deliver("invoice.paid", upgrade)).body.reset, false, "a mid-period upgrade keeps the count");

		const oldSubscription = invoice({ subscriptionId: "sub_gone", accountId: user.accountId, customer: "cus_inv", start: NOW + 60 * DAY, end: NOW + 90 * DAY });
		assert.equal((await deliver("invoice.paid", oldSubscription)).body.ignored, "an older subscription");
	});
});

describe("early fraud warnings", () => {
	const charges = new Map();

	function charge(id, fields = {}) {
		charges.set(id, { id, object: "charge", amount: 1900, amount_refunded: 0, refunded: false, disputed: false, customer: "cus_efw", payment_intent: `pi_${id}`, ...fields });
	}

	function warning(chargeId) {
		return { id: `issfr_${chargeId}`, object: "radar.early_fraud_warning", actionable: true, charge: chargeId, fraud_type: "made_with_stolen_card", livemode: false };
	}

	// Charges, their refunds, and which invoice of sub_efw each paid: only ch_paid paid one.
	function fraudApi(request) {
		const { method, path, query } = request;
		const record = (answer) => {
			calls.push(request);
			return answer;
		};
		if (method === "GET" && path.startsWith("/v1/charges/")) return record(charges.get(path.split("/").at(-1)));
		if (method === "POST" && path === "/v1/refunds") {
			const refunded = charges.get(request.body.get("charge"));
			charges.set(refunded.id, { ...refunded, refunded: true, amount_refunded: refunded.amount });
			return record({ id: "re_1", object: "refund", charge: refunded.id, status: "succeeded" });
		}
		if (method === "GET" && path === "/v1/invoice_payments") {
			const isPaid = query.get("payment[type]") === "payment_intent" && query.get("payment[payment_intent]") === "pi_ch_paid" && query.get("status") === "paid";
			return record({ object: "list", data: isPaid ? [{ id: "inpay_1", object: "invoice_payment", invoice: "in_efw", status: "paid" }] : [], has_more: false });
		}
		if (method === "GET" && path === "/v1/invoices/in_efw") {
			return record({ id: "in_efw", object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: "sub_efw" } } });
		}
		if (method === "DELETE" && path === "/v1/subscriptions/sub_efw") {
			subscriptions.set("sub_efw", { ...subscriptions.get("sub_efw"), status: "canceled" });
			return record(subscriptions.get("sub_efw"));
		}
		return stripeApi(request);
	}

	test("the payment is refunded as fraudulent, the plan it paid for ends at once, and the admins and the owner hear of it", async () => {
		const user = await signIn("fraud@example.com");
		subscriptions.set("sub_efw", subscription({ id: "sub_efw", accountId: user.accountId, customer: "cus_efw" }));
		await deliver("customer.subscription.created", { id: "sub_efw" });
		charge("ch_paid");
		mockStripe(fraudApi);
		const emailsBefore = platformEmails.length;

		const result = await deliver("radar.early_fraud_warning.created", warning("ch_paid"));
		assert.deepEqual(result, { status: 200, body: { received: true, refunded: true, canceled: "sub_efw" } });
		const refund = calls.find(({ method, path }) => method === "POST" && path === "/v1/refunds");
		assert.deepEqual([refund.body.get("charge"), refund.body.get("reason")], ["ch_paid", "fraudulent"]);
		assert.equal(refund.headers.get("idempotency-key"), "efw-refund-issfr_ch_paid");
		assert.ok(calls.some(({ method, path }) => method === "DELETE" && path === "/v1/subscriptions/sub_efw"));
		await deliver("customer.subscription.deleted", { id: "sub_efw" });
		assert.equal((await account(user)).subscriptionStatus, "canceled", "the plan is off, like any canceled one");

		const emails = platformEmails.slice(emailsBefore);
		const toAdmins = emails.find(({ to }) => to.includes("admin@example.com"));
		assert.equal(toAdmins.subject, "[MailCheap] Payment refunded after a fraud warning");
		assert.ok(
			toAdmins.text.includes(
				`Account ${user.accountId}: the card's bank reported a $19.00 payment as fraud (made_with_stolen_card), and MailCheap refunded it and ended the plan it paid for.`
			),
			toAdmins.text
		);
		const toOwner = emails.find(({ to }) => to.includes("fraud@example.com"));
		assert.equal(toOwner.subject, "[MailCheap] Your plan ended");
		assert.ok(
			toOwner.text.includes("Your card's bank reported a $19.00 payment to MailCheap as unauthorized, so we refunded it and ended the plan it paid for."),
			toOwner.text
		);

		calls = [];
		const emailsAfter = platformEmails.length;
		const again = await deliver("radar.early_fraud_warning.created", warning("ch_paid"));
		assert.deepEqual(again.body, { received: true, refunded: false }, "delivered again, nothing more to do");
		assert.equal(calls.some(({ method, path }) => path === "/v1/refunds" || method === "DELETE"), false);
		assert.equal(platformEmails.length, emailsAfter, "and nobody is told twice");
	});

	test("a payment that paid no plan is only refunded, and a disputed one is left to the dispute", async () => {
		const user = await signIn("fraud-other@example.com");
		subscriptions.set("sub_other", subscription({ id: "sub_other", accountId: user.accountId, customer: "cus_other" }));
		await deliver("customer.subscription.created", { id: "sub_other" });
		charge("ch_loose", { amount: 500, customer: "cus_other" });
		charge("ch_disputed", { disputed: true, customer: "cus_other" });
		mockStripe(fraudApi);

		assert.deepEqual((await deliver("radar.early_fraud_warning.created", warning("ch_loose"))).body, { received: true, refunded: true });
		assert.equal(calls.some(({ method }) => method === "DELETE"), false, "the plan goes on");
		calls = [];
		assert.deepEqual((await deliver("radar.early_fraud_warning.created", warning("ch_disputed"))).body, { received: true, refunded: false });
		assert.equal(calls.some(({ path }) => path === "/v1/refunds"), false);
		assert.equal((await account(user)).subscriptionStatus, "active");
	});
});

describe("customer portal", () => {
	test("manage billing opens the portal; picking another plan opens Stripe's confirm page for it", async () => {
		const user = await signIn("portal@example.com");
		subscriptions.set("sub_portal", subscription({ id: "sub_portal", accountId: user.accountId, customer: "cus_portal" }));
		await deliver("customer.subscription.created", { id: "sub_portal" });

		assert.equal(await as(user, () => catchRedirect(m.billing.openBillingPortal())), "https://billing.stripe.com/p/session/bps_1");
		const portal = calls.findLast(({ path }) => path === "/v1/billing_portal/sessions").body;
		assert.equal(portal.get("customer"), "cus_portal");
		assert.equal(portal.get("return_url"), "http://localhost:3000/billing");
		assert.equal(portal.get("configuration"), null, "the portal set up in Stripe's dashboard");

		assert.equal(await as(user, () => catchRedirect(m.billing.choosePlan(form({ plan: "growth", interval: "month" })))), "https://billing.stripe.com/p/session/bps_1");
		const change = calls.findLast(({ path }) => path === "/v1/billing_portal/sessions").body;
		assert.equal(change.get("flow_data[type]"), "subscription_update_confirm");
		assert.equal(change.get("flow_data[subscription_update_confirm][subscription]"), "sub_portal");
		assert.equal(change.get("flow_data[subscription_update_confirm][items][0][price]"), "price_mailcheap_growth_monthly");
		assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false, "a paying account never gets a second subscription");
	});

	test("an account that never paid has no portal", async () => {
		const user = await signIn("noportal@example.com");
		assert.equal(await as(user, () => catchRedirect(m.billing.openBillingPortal())), "/billing");
	});
});
