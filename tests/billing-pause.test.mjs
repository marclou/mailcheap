import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BannerBlocked from "../components/BannerBlocked.jsx";
import { getPlanDetails } from "../components/CardSubscription.jsx";
import { formatDate } from "../lib/format.js";
import { activate, addSentIssue, as, callApi, catchRedirect, form, listPlanPrices, mockStripe, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";

// What a block does to the account's plan (lib/billing-pause.js): Stripe stops billing it and voids what's waiting,
// while the plan and the website stay on, and unblocking bills it again. Stripe is a fake that keeps the invoices of
// each subscription and records every request.
const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const DAY_MS = 86_400_000;
let app;
let m;
let stripe;

// The portal set up in Stripe's dashboard: its business details and customer updates carry over to a blocked account's.
const DEFAULT_PORTAL = {
	id: "bpc_default",
	object: "billing_portal.configuration",
	is_default: true,
	active: true,
	business_profile: { headline: null, privacy_policy_url: "https://example.com/privacy", terms_of_service_url: "https://example.com/terms" },
	features: {
		customer_update: { enabled: true, allowed_updates: ["email", "address"] },
		subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "always_invoice" },
	},
	metadata: {},
};

// A starter plan paused by a block, or canceled.
function subscriptionFor(id, status) {
	const start = Math.floor(Date.now() / 1000) - 40 * 86_400;
	return {
		id,
		object: "subscription",
		customer: `cus_${id.slice("sub_".length)}`,
		status,
		metadata: {},
		cancel_at: null,
		cancel_at_period_end: false,
		pause_collection: status === "canceled" ? null : { behavior: "void", resumes_at: null },
		items: {
			object: "list",
			data: [
				{
					id: "si_1",
					object: "subscription_item",
					price: { id: "price_1", object: "price", lookup_key: "mailcheap_starter_monthly" },
					current_period_start: start,
					current_period_end: start + 30 * 86_400,
				},
			],
		},
	};
}

function fakeStripe() {
	const state = { requests: [], invoices: [], portals: [DEFAULT_PORTAL], canceled: new Set(), isDown: false };
	state.handle = (request) => {
		state.requests.push(request);
		if (state.isDown) return { status: 400, error: { type: "invalid_request_error", message: "Stripe is down" } };
		const { method, path, query } = request;
		if (method === "GET" && path === "/v1/prices") return listPlanPrices(query);
		const subscription = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(path)?.[1];
		if (method === "POST" && subscription) return { id: subscription, object: "subscription" };
		if (method === "GET" && subscription) return subscriptionFor(subscription, state.canceled.has(subscription) ? "canceled" : "active");
		if (method === "DELETE" && subscription) {
			state.canceled.add(subscription);
			return subscriptionFor(subscription, "canceled");
		}
		if (method === "GET" && path === "/v1/invoices") {
			const data = state.invoices.filter(({ subscription }) => subscription === query.get("subscription"));
			return { object: "list", data, has_more: false, url: "/v1/invoices" };
		}
		const step = /^\/v1\/invoices\/(in_\w+)\/(finalize|void)$/.exec(path);
		if (method === "POST" && step) return { ...state.invoices.find(({ id }) => id === step[1]), status: step[2] === "void" ? "void" : "open" };
		if (method === "GET" && path === "/v1/billing_portal/configurations") return { object: "list", data: state.portals, has_more: false };
		if (method === "POST" && path === "/v1/billing_portal/configurations") {
			const portal = { id: "bpc_blocked", object: "billing_portal.configuration", is_default: false, active: true, metadata: { purpose: request.body.get("metadata[purpose]") } };
			state.portals.push(portal);
			return portal;
		}
		if (method === "POST" && path === "/v1/billing_portal/sessions") {
			return { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/bps_1" };
		}
		return { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } };
	};
	return state;
}

// "POST /v1/subscriptions/sub_1 pause_collection[behavior]=void": what Stripe was asked, with its fields.
function describeRequest({ method, path, query, body }) {
	const fields = [...(method === "POST" ? body : query)].map(([name, value]) => `${name}=${value}`).join("&");
	return `${method} ${path}${fields ? ` ${fields}` : ""}`;
}

function requestsFor(user) {
	return stripe.requests.map(describeRequest).filter((line) => line.includes(`sub_${user.accountId}`) || line.includes("/v1/invoices/in_"));
}

async function quietly(run) {
	const error = console.error;
	console.error = () => {};
	try {
		return await run();
	} finally {
		console.error = error;
	}
}

const loadAccount = (user) => m.Account.findById(user.accountId).lean();
const emailsTo = (since, email, subject) => platformEmails.slice(since).filter(({ to, subject: sent }) => to.includes(email) && sent === subject);

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	const slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent" })))).key;
	return user;
}

function block(user) {
	return m.blocks.blockAccount(user.accountId, { reason: "Complaint rate of 1.00% over the last 7 days (limit 0.30%)", by: "rates" });
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		billingActions: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		hourly: await import("../app/api/cron/hourly/route.js"),
		blocks: await import("../lib/account-blocks.js"),
		archive: await import("../lib/archive-data.js"),
		billing: await import("../lib/billing.js"),
		pause: await import("../lib/billing-pause.js"),
		state: await import("../lib/account-state.js"),
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
	};
});

beforeEach(() => {
	stripe = fakeStripe();
	mockStripe(stripe.handle);
});

after(() => app?.stop());

describe("blocking", () => {
	test("pauses the plan's billing and voids the invoices waiting for payment; the plan and the website stay on", async () => {
		const user = await customer("paused-billing@example.com");
		await addSentIssue(user);
		const sub = `sub_${user.accountId}`;
		stripe.invoices.push(
			{ id: "in_paid", object: "invoice", status: "paid", subscription: sub },
			{ id: "in_open", object: "invoice", status: "open", subscription: sub },
			{ id: "in_draft", object: "invoice", status: "draft", subscription: sub }
		);
		const emailsBefore = platformEmails.length;

		assert.equal(await block(user), true);
		assert.deepEqual(requestsFor(user), [
			`POST /v1/subscriptions/${sub} pause_collection[behavior]=void`,
			`GET /v1/invoices subscription=${sub}&limit=10`,
			"POST /v1/invoices/in_open/void",
			"POST /v1/invoices/in_draft/finalize auto_advance=false",
			"POST /v1/invoices/in_draft/void",
		]);
		const account = await loadAccount(user);
		assert.ok(account.billingPausedAt);
		assert.equal(account.subscriptionStatus, "active");
		assert.equal(m.state.hasActiveSubscription(account), true, "the plan stays on");
		assert.ok(await m.archive.getArchiveNewsletter(user.slug), "and so does the website");

		const planEnds = formatDate(new Date(account.billingPausedAt.getTime() + 30 * DAY_MS));
		const [toOwner] = emailsTo(emailsBefore, "paused-billing@example.com", "[MailCheap] Account blocked");
		assert.ok(
			toOwner.text.includes(`and imports and changes are off. Your plan isn't billed while it's blocked, and ends on ${planEnds} if it's still blocked then. Chat with us to unblock it.`),
			toOwner.text
		);
		const [toAdmins] = emailsTo(emailsBefore, "admin@example.com", "[MailCheap] Account blocked");
		assert.ok(toAdmins.text.includes(`(limit 0.30%). Its plan isn't billed until it's unblocked, and ends on ${planEnds} if it's still blocked.`), toAdmins.text);

		assert.deepEqual(getPlanDetails(account), ["$19 per month", "Not billed while blocked", `Ends ${planEnds} unless unblocked`]);
		const canceledSooner = new Date(Date.now() + 5 * DAY_MS);
		assert.deepEqual(getPlanDetails({ ...account, cancelAt: canceledSooner }), ["$19 per month", `Ends ${formatDate(canceledSooner)}`], "a cancel that comes first");
		assert.match(renderToStaticMarkup(createElement(BannerBlocked, { account })), /Nothing is sent or billed until it&#x27;s unblocked/);
		const billing = await callApi("GET", "/api/v1/billing", { key: user.key });
		assert.deepEqual([billing.status, billing.body.status, billing.body.isActive, billing.body.billingPaused], [200, "blocked", true, true]);
	});

	test("a renewal while billing is paused starts no month: its invoice is voided, never paid", async () => {
		const user = await customer("voided-renewal@example.com");
		await block(user);
		const blocked = await loadAccount(user);
		const start = Math.floor(blocked.usage.paidThrough.getTime() / 1000) + 30 * 86_400;
		const renewed = {
			id: `sub_${user.accountId}`,
			object: "subscription",
			customer: `cus_${user.accountId}`,
			status: "active",
			metadata: { accountId: String(user.accountId) },
			cancel_at: null,
			cancel_at_period_end: false,
			pause_collection: { behavior: "void", resumes_at: null },
			items: {
				object: "list",
				data: [
					{
						id: "si_1",
						object: "subscription_item",
						price: { id: "price_1", object: "price", lookup_key: "mailcheap_starter_monthly" },
						current_period_start: start,
						current_period_end: start + 30 * 86_400,
					},
				],
			},
		};
		await m.billing.applySubscription(blocked, renewed);
		assert.deepEqual((await loadAccount(user)).usage, blocked.usage, "two renewals later, still the paid month");
	});

	test("a self-hosted server has no billing to pause", async () => {
		const user = await customer("self-hosted-block@example.com");
		await withEnv({ MAILCHEAP_CLOUD: "" }, () => block(user));
		assert.deepEqual(requestsFor(user), []);
		assert.equal((await loadAccount(user)).billingPausedAt, undefined);
	});

	test("Stripe failing doesn't hold the block up: the admins hear of it, and the hourly check pauses it later", async () => {
		const user = await customer("stripe-down@example.com");
		stripe.isDown = true;
		const emailsBefore = platformEmails.length;
		assert.equal(await quietly(() => block(user)), true);
		stripe.isDown = false;
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.billingPausedAt], ["paused", undefined]);
		const [toOwner] = emailsTo(emailsBefore, "stripe-down@example.com", "[MailCheap] Account blocked");
		assert.doesNotMatch(toOwner.text, /isn't billed/, "the owner is told only what happened");
		const [failed] = emailsTo(emailsBefore, "admin@example.com", "[MailCheap] Blocked account still billed");
		assert.match(failed.text, new RegExp(`Account ${user.accountId} is blocked, but Stripe didn't pause its plan's billing: Stripe is down`));

		const response = await withEnv({ CRON_SECRET }, () =>
			m.hourly.GET(new Request("http://localhost:3000/api/cron/hourly", { headers: { authorization: `Bearer ${CRON_SECRET}` } }))
		);
		assert.equal(response.status, 200);
		assert.ok((await response.json()).billing.paused >= 1);
		assert.ok((await loadAccount(user)).billingPausedAt, "paused an hour later");
	});
});

describe("unblocking", () => {
	test("within the paid month, the plan is billed again from its next renewal", async () => {
		const user = await customer("resumed@example.com");
		await block(user);
		stripe.requests.length = 0;
		const emailsBefore = platformEmails.length;

		assert.equal(await m.blocks.unblockAccount(user.accountId), true);
		assert.deepEqual(requestsFor(user), [`POST /v1/subscriptions/sub_${user.accountId} pause_collection=`]);
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.billingPausedAt], ["active", undefined]);
		const renewal = account.currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
		const [toOwner] = emailsTo(emailsBefore, "resumed@example.com", "[MailCheap] Account unblocked");
		assert.ok(toOwner.text.startsWith(`Account unblocked\nYour account can send again. Your plan is billed again from its renewal on ${renewal}.\nhttp://localhost:3000/`), toOwner.text);
		assert.deepEqual(getPlanDetails(account), ["$19 per month", `Renews ${renewal}`]);
	});

	test("after a skipped renewal, the plan starts a new month that day, charged once", async () => {
		const user = await customer("restarted@example.com");
		await block(user);
		const { billingPausedAt } = await loadAccount(user);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.paidThrough": new Date(Date.now() - DAY_MS) } });
		stripe.requests.length = 0;
		const emailsBefore = platformEmails.length;

		assert.equal(await m.blocks.unblockAccount(user.accountId), true);
		const sub = `sub_${user.accountId}`;
		assert.deepEqual(requestsFor(user), [`POST /v1/subscriptions/${sub} pause_collection=`, `POST /v1/subscriptions/${sub} billing_cycle_anchor=now&proration_behavior=none`]);
		assert.equal(stripe.requests.at(-1).headers.get("idempotency-key"), `restart-${sub}-${billingPausedAt.getTime()}`, "the same restart is never charged twice");
		const [toOwner] = emailsTo(emailsBefore, "restarted@example.com", "[MailCheap] Account unblocked");
		assert.match(toOwner.text, /Your account can send again\. Your plan starts a new month today, billed now\./);

		stripe.requests.length = 0;
		await m.pause.reconcileBillingPauses();
		assert.deepEqual(requestsFor(user), [], "nothing left for the hourly check");
	});

	test("a plan canceled during the block isn't billed again", async () => {
		const user = await customer("canceled-while-blocked@example.com");
		await block(user);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
		stripe.requests.length = 0;
		const emailsBefore = platformEmails.length;

		assert.equal(await m.blocks.unblockAccount(user.accountId), true);
		assert.deepEqual(requestsFor(user), []);
		assert.equal((await loadAccount(user)).billingPausedAt, undefined);
		const [toOwner] = emailsTo(emailsBefore, "canceled-while-blocked@example.com", "[MailCheap] Account unblocked");
		assert.doesNotMatch(toOwner.text, /billed/);
	});
});

describe("the hourly check", () => {
	test("pauses blocked accounts Stripe still bills, like those blocked before this, and bills again unblocked ones still paused", async () => {
		const blocked = await customer("blocked-before@example.com");
		await m.Account.updateOne({ _id: blocked.accountId }, { $set: { status: "paused", pausedAt: new Date(), pausedBy: "admin" } });
		const unblocked = await customer("unblocked-since@example.com");
		await m.Account.updateOne({ _id: unblocked.accountId }, { $set: { billingPausedAt: new Date() } });
		const free = await signIn("blocked-without-plan@example.com");
		await m.Account.updateOne({ _id: free.accountId }, { $set: { status: "paused", pausedAt: new Date(), pausedBy: "admin" } });

		const result = await m.pause.reconcileBillingPauses();
		assert.ok(result.paused >= 1 && result.resumed >= 1, JSON.stringify(result));
		assert.deepEqual(requestsFor(blocked).slice(0, 2), [
			`POST /v1/subscriptions/sub_${blocked.accountId} pause_collection[behavior]=void`,
			`GET /v1/invoices subscription=sub_${blocked.accountId}&limit=10`,
		]);
		assert.deepEqual(requestsFor(unblocked), [`POST /v1/subscriptions/sub_${unblocked.accountId} pause_collection=`]);
		assert.deepEqual(requestsFor(free), [], "nothing to pause without a plan Stripe bills");
		assert.ok((await loadAccount(blocked)).billingPausedAt);
		assert.equal((await loadAccount(unblocked)).billingPausedAt, undefined);
	});
});

describe("30 days blocked", () => {
	const blockedSince = (user, days) =>
		m.Account.updateOne({ _id: user.accountId }, { $set: { billingPausedAt: new Date(Date.now() - days * DAY_MS - 60_000) } });

	test("the hourly check ends the plan, once and without a refund: the owner gets an email, the admins see it on their page", async () => {
		const user = await customer("blocked-for-good@example.com");
		await addSentIssue(user);
		await block(user);
		await blockedSince(user, 30);
		const { billingPausedAt } = await loadAccount(user);
		const lately = await customer("blocked-lately@example.com");
		await block(lately);
		await blockedSince(lately, 29);
		stripe.requests.length = 0;
		const emailsBefore = platformEmails.length;

		const result = await m.pause.reconcileBillingPauses();
		assert.ok(result.ended >= 1, JSON.stringify(result));
		const sub = `sub_${user.accountId}`;
		assert.deepEqual(requestsFor(user), [`GET /v1/subscriptions/${sub}`, `DELETE /v1/subscriptions/${sub} cancellation_details[comment]=Blocked for 30 days`]);
		assert.equal(stripe.requests.find(({ method }) => method === "DELETE").headers.get("idempotency-key"), `end-${sub}-${billingPausedAt.getTime()}`);
		assert.equal(stripe.requests.some(({ path }) => path === "/v1/refunds"), false, "nothing refunded");
		assert.deepEqual(requestsFor(lately), [], "29 days in, the plan goes on");

		const account = await loadAccount(user);
		assert.deepEqual(
			[account.status, account.subscriptionStatus, account.billingPausedAt, account.planEndingAt],
			["paused", "canceled", undefined, undefined]
		);
		assert.equal(m.state.hasActiveSubscription(account), false);
		assert.ok(!(await m.archive.getArchiveNewsletter(user.slug)), "the website goes offline, like any plan's that ended");

		const [toOwner] = emailsTo(emailsBefore, "blocked-for-good@example.com", "[MailCheap] Your plan ended");
		assert.ok(
			toOwner.text.includes(
				"Your account has been blocked for 30 days, so we ended its plan, which wasn't billed meanwhile. Your newsletters, contacts and campaigns are kept, and you can pick a plan again once it's unblocked. Chat with us to unblock it."
			),
			toOwner.text
		);
		assert.deepEqual(emailsTo(emailsBefore, "admin@example.com", "[MailCheap] Blocked account's plan ended"), [], "only on the admin page");
		assert.ok(await m.Alert.exists({ key: `blocked-plan-ended:${user.accountId}` }));

		stripe.requests.length = 0;
		await m.pause.reconcileBillingPauses();
		assert.deepEqual(requestsFor(user), [], "once");
	});

	test("an account unblocked since the check found it keeps its plan", async () => {
		const user = await customer("unblocked-in-time@example.com");
		await block(user);
		await blockedSince(user, 31);
		const found = await loadAccount(user);
		await m.blocks.unblockAccount(user.accountId);
		stripe.requests.length = 0;

		assert.equal(await m.pause.endBlockedPlan(found), false);
		assert.deepEqual(requestsFor(user), []);
		assert.equal((await loadAccount(user)).subscriptionStatus, "active");
	});

	test("unblocking waits while the plan ends, and a hold left by a run that died doesn't stop it", async () => {
		const user = await customer("unblocked-while-ending@example.com");
		await block(user);
		await blockedSince(user, 31);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { planEndingAt: new Date() } });

		await assert.rejects(m.blocks.unblockAccount(user.accountId), { message: m.pause.PLAN_ENDING_MESSAGE });
		assert.equal((await loadAccount(user)).status, "paused");
		stripe.requests.length = 0;
		assert.equal(await m.pause.endBlockedPlan(await loadAccount(user)), false, "one end at a time");
		assert.deepEqual(requestsFor(user), []);

		await m.Account.updateOne({ _id: user.accountId }, { $set: { planEndingAt: new Date(Date.now() - 6 * 60_000) } });
		assert.equal(await m.blocks.unblockAccount(user.accountId), true);
	});

	test("a plan Stripe already ended is only mirrored, without an email", async () => {
		const user = await customer("ended-in-stripe@example.com");
		await block(user);
		await blockedSince(user, 31);
		stripe.canceled.add(`sub_${user.accountId}`);
		stripe.requests.length = 0;
		const emailsBefore = platformEmails.length;

		await m.pause.reconcileBillingPauses();
		assert.deepEqual(requestsFor(user), [`GET /v1/subscriptions/sub_${user.accountId}`]);
		const account = await loadAccount(user);
		assert.deepEqual([account.subscriptionStatus, account.billingPausedAt], ["canceled", undefined]);
		assert.deepEqual(emailsTo(emailsBefore, "ended-in-stripe@example.com", "[MailCheap] Your plan ended"), []);
	});

	test("Stripe failing reaches the admins, and the next hour ends it", async () => {
		const user = await customer("end-fails@example.com");
		await block(user);
		await blockedSince(user, 31);
		stripe.isDown = true;
		const emailsBefore = platformEmails.length;

		await quietly(() => m.pause.reconcileBillingPauses());
		stripe.isDown = false;
		const [failed] = emailsTo(emailsBefore, "admin@example.com", "[MailCheap] Blocked account's plan not ended");
		assert.ok(failed.text.includes(`Account ${user.accountId} was blocked 30 days ago, but Stripe didn't cancel its plan: Stripe is down`), failed.text);
		const waiting = await loadAccount(user);
		assert.deepEqual(
			[waiting.subscriptionStatus, Boolean(waiting.billingPausedAt), waiting.planEndingAt],
			["active", true, undefined],
			"still paused, without being billed, and unblocking isn't held"
		);

		await m.pause.reconcileBillingPauses();
		assert.equal((await loadAccount(user)).subscriptionStatus, "canceled");
	});
});

describe("plans while blocked", () => {
	test("a blocked account picks or changes no plan until it's unblocked, and keeps the billing portal, without plan changes", async () => {
		const user = await customer("no-plan-change@example.com");
		await block(user);

		const refused = await callApi("POST", "/api/v1/billing/change-plan", { key: user.key, body: { plan: "growth" } });
		assert.deepEqual([refused.status, refused.body.error.code], [403, "account_blocked"]);
		assert.equal(await as(user, () => catchRedirect(m.billingActions.choosePlan(form({ plan: "growth", interval: "month" })))), "/billing?interval=month&error=blocked");
		assert.equal(await as(user, () => catchRedirect(m.billingActions.openBillingPortal())), "https://billing.stripe.com/p/session/bps_1");
		const portal = stripe.requests.find(({ method, path }) => method === "POST" && path === "/v1/billing_portal/configurations").body;
		const fields = (prefix) => [...portal].filter(([name]) => name.startsWith(prefix)).map(([, value]) => value);
		assert.equal(portal.get("features[subscription_update][enabled]"), "false", "no plan changes");
		assert.deepEqual(
			[portal.get("features[payment_method_update][enabled]"), portal.get("features[invoice_history][enabled]"), portal.get("features[subscription_cancel][mode]")],
			["true", "true", "at_period_end"],
			"the card, invoices and canceling"
		);
		assert.deepEqual(fields("features[customer_update][allowed_updates]"), ["email", "address"]);
		assert.deepEqual(fields("business_profile["), ["https://example.com/privacy", "https://example.com/terms"]);
		assert.equal(stripe.requests.at(-1).body.get("configuration"), "bpc_blocked");

		stripe.requests.length = 0;
		await as(user, () => catchRedirect(m.billingActions.openBillingPortal()));
		assert.deepEqual(
			stripe.requests.map(({ method, path }) => `${method} ${path}`),
			["POST /v1/billing_portal/sessions"],
			"made once"
		);
		assert.equal(stripe.requests[0].body.get("configuration"), "bpc_blocked");

		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
		const checkout = await as(user, () => catchRedirect(m.checkoutRoute.GET(new Request("http://localhost:3000/billing/checkout?plan=growth&interval=month"))));
		assert.equal(checkout, "/billing?interval=month&error=blocked", "no Checkout either once its plan ended");
		assert.equal(stripe.requests.some(({ path }) => path === "/v1/checkout/sessions"), false);
	});
});
