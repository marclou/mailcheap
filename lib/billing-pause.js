import "server-only";
import { BLOCKED_PLAN_DAYS, getUnblockHint, isPaidStatus } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { applySubscription } from "@/lib/billing";
import { isCloud } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { PAID_SUBSCRIPTION_STATUSES } from "@/lib/plans";
import { siteExtensions } from "@/lib/site-extensions";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import Account from "@/models/Account";

// What pausing and resuming read of an account.
export const BILLING_PAUSE_FIELDS = {
	status: 1,
	stripeSubscriptionId: 1,
	subscriptionStatus: 1,
	billingPausedAt: 1,
	planEndingAt: 1,
	interval: 1,
	currentPeriodEnd: 1,
	cancelAt: 1,
	"usage.paidThrough": 1,
};
// A subscription has one invoice a period: its latest ones hold every invoice still waiting to be paid.
const RECENT_INVOICES = 10;
const RECONCILED_PER_RUN = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
// Ending a plan holds its account for the second Stripe takes; a hold this old was left by a run that died midway.
const PLAN_ENDING_MS = 5 * 60_000;
export const PLAN_ENDING_MESSAGE = `its plan is ending right now, after ${BLOCKED_PLAN_DAYS} days blocked: try again in a minute`;
// The hourly check retries a failure every hour: its alert goes out at once, then once a day while it lasts.
const RETRY_ALERT_COOLDOWN_MINUTES = 24 * 60;

function isBilledByStripe(account) {
	return isCloud() && isStripeConfigured() && Boolean(account?.stripeSubscriptionId) && isPaidStatus(account.subscriptionStatus);
}

// A blocked account's plan isn't billed while the block lasts. Pausing collection keeps the subscription active, so its
// plan, limits and website stay as they are, and Stripe voids each renewal meanwhile. Invoices from before the pause
// would still be charged: an open one, which Stripe keeps retrying, is voided, and so is a draft, a renewal in its first
// hour, once it's finalized without charging. True when this call paused it.
export async function pauseBilling(account, now = new Date()) {
	if (account.billingPausedAt || !isBilledByStripe(account)) return false;
	const stripe = getStripe();
	const id = account.stripeSubscriptionId;
	await stripe.subscriptions.update(id, { pause_collection: { behavior: "void" } });
	const { data: invoices } = await stripe.invoices.list({ subscription: id, limit: RECENT_INVOICES });
	for (const invoice of invoices) {
		if (invoice.status === "draft") await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
		if (invoice.status === "draft" || invoice.status === "open") await stripe.invoices.voidInvoice(invoice.id);
	}
	const { modifiedCount } = await Account.updateOne({ _id: account._id, billingPausedAt: null }, { $set: { billingPausedAt: now } });
	return modifiedCount > 0;
}

// Unblocking bills the plan again. A renewal skipped during the block leaves nothing paid: the plan then starts a new
// period that day, charged at once, rather than running unpaid until its next renewal, most of a year away on a yearly
// plan. The restart's key is the pause's own, so running this again never charges twice. { restarted } once Stripe
// bills it again, or null when there's no plan left to bill, like one canceled during the block.
export async function resumeBilling(account, now = new Date()) {
	if (!account.billingPausedAt) return null;
	let resumed = null;
	if (isBilledByStripe(account)) {
		const stripe = getStripe();
		const id = account.stripeSubscriptionId;
		await stripe.subscriptions.update(id, { pause_collection: "" });
		const paidThrough = account.usage?.paidThrough;
		const restarted = !paidThrough || new Date(paidThrough) <= now;
		if (restarted) {
			await stripe.subscriptions.update(
				id,
				{ billing_cycle_anchor: "now", proration_behavior: "none" },
				{ idempotencyKey: `restart-${id}-${new Date(account.billingPausedAt).getTime()}` }
			);
		}
		resumed = { restarted };
	}
	await Account.updateOne({ _id: account._id, billingPausedAt: account.billingPausedAt }, { $unset: { billingPausedAt: 1 } });
	return resumed;
}

export function isPlanEnding(account, now = new Date()) {
	return Boolean(account?.planEndingAt) && now - new Date(account.planEndingAt) < PLAN_ENDING_MS;
}

// The accounts no plan end holds, for an update that mustn't cross one.
export function notPlanEnding(now = new Date()) {
	return { $or: [{ planEndingAt: null }, { planEndingAt: { $lte: new Date(now.getTime() - PLAN_ENDING_MS) } }] };
}

// A plan still blocked BLOCKED_PLAN_DAYS after its billing paused ends at once, like a canceled one: nothing is refunded,
// its data stays, and the account picks a plan again once it's unblocked. Stripe can't cancel on a condition, so the
// account is held while it does, and unblocking waits (lib/account-blocks.js). A plan Stripe already ended, which a
// missed event left active here, is only mirrored. The cancel's key is the pause's own, so it happens once. True when
// this call ended it.
export async function endBlockedPlan(account, now = new Date()) {
	const { modifiedCount } = await Account.updateOne(
		{ _id: account._id, status: "paused", billingPausedAt: account.billingPausedAt, ...notPlanEnding(now) },
		{ $set: { planEndingAt: now } }
	);
	if (modifiedCount === 0) return false;
	let ends;
	try {
		const stripe = getStripe();
		const id = account.stripeSubscriptionId;
		const current = await stripe.subscriptions.retrieve(id);
		ends = isPaidStatus(current.status);
		const subscription = ends
			? await stripe.subscriptions.cancel(
					id,
					{ cancellation_details: { comment: `Blocked for ${BLOCKED_PLAN_DAYS} days` } },
					{ idempotencyKey: `end-${id}-${new Date(account.billingPausedAt).getTime()}` }
				)
			: current;
		await applySubscription(account, subscription);
	} catch (error) {
		await Account.updateOne({ _id: account._id }, { $unset: { planEndingAt: 1 } });
		throw error;
	}
	await Account.updateOne({ _id: account._id }, { $unset: { planEndingAt: 1, billingPausedAt: 1 } });
	if (ends) await alertPlanEnded(account);
	return ends;
}

// The owner hears it at once, with what's kept; the admins only see it on the admin page, where a refund stays their call.
async function alertPlanEnded(account) {
	await Promise.all([
		sendAlert({
			accountId: account._id,
			key: "blocked-plan-ended",
			title: "Your plan ended",
			detail: `Your account has been blocked for ${BLOCKED_PLAN_DAYS} days, so we ended its plan, which wasn't billed meanwhile. Your newsletters, contacts and campaigns are kept, and you can pick a plan again once it's unblocked. ${getUnblockHint()}`,
			path: siteExtensions.supportChatPath ?? "/billing",
			cooldownMinutes: 0,
		}),
		sendAlert({
			accountId: null,
			key: `blocked-plan-ended:${account._id}`,
			title: "Blocked account's plan ended",
			detail: `Account ${account._id} was still blocked ${BLOCKED_PLAN_DAYS} days after its plan's billing paused, so MailCheap canceled the plan, without a refund.`,
			action: "Refund it in Stripe if its owner asks.",
			path: "/admin",
			cooldownMinutes: 0,
		}),
	]);
}

// Blocking never waits on Stripe: a failure reaches the admins, and the hourly check tries again.
export async function pauseBillingQuietly(account, now = new Date()) {
	try {
		return await pauseBilling(account, now);
	} catch (error) {
		console.error(`[billing] Stripe didn't pause account ${account._id}'s billing: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `billing-pause-failed:${account._id}`,
			title: "Blocked account still billed",
			detail: `Account ${account._id} is blocked, but Stripe didn't pause its plan's billing: ${error.message}`,
			action: "The hourly check tries again. If it renews before then, pause payment collection on its subscription in Stripe, voiding invoices.",
			path: "/admin",
			cooldownMinutes: RETRY_ALERT_COOLDOWN_MINUTES,
		});
		return false;
	}
}

export async function resumeBillingQuietly(account) {
	try {
		return await resumeBilling(account);
	} catch (error) {
		console.error(`[billing] Stripe didn't resume account ${account._id}'s billing: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `billing-resume-failed:${account._id}`,
			title: "Unblocked account not billed",
			detail: `Account ${account._id} was unblocked, but Stripe didn't resume its plan's billing: ${error.message}`,
			action: "The hourly check tries again. Until then its renewals are voided.",
			path: "/admin",
			cooldownMinutes: RETRY_ALERT_COOLDOWN_MINUTES,
		});
		return null;
	}
}

async function endBlockedPlanQuietly(account, now) {
	try {
		return await endBlockedPlan(account, now);
	} catch (error) {
		console.error(`[billing] Stripe didn't end blocked account ${account._id}'s plan: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `blocked-plan-end-failed:${account._id}`,
			title: "Blocked account's plan not ended",
			detail: `Account ${account._id} was blocked ${BLOCKED_PLAN_DAYS} days ago, but Stripe didn't cancel its plan: ${error.message}`,
			action: "The hourly check tries again, and its plan isn't billed meanwhile. If it keeps failing, cancel its subscription in Stripe.",
			path: "/admin",
			cooldownMinutes: RETRY_ALERT_COOLDOWN_MINUTES,
		});
		return false;
	}
}

// Every hour (app/api/cron/hourly), for what Stripe didn't answer at the time, and the accounts blocked before blocks
// paused billing: a blocked account Stripe still bills is paused, an unblocked one still paused is billed again, and one
// blocked for BLOCKED_PLAN_DAYS loses its plan.
export async function reconcileBillingPauses(now = new Date()) {
	if (!isCloud() || !isStripeConfigured()) return { skipped: "billing is off" };
	await connectDb();
	const [blocked, unblocked, expired] = await Promise.all([
		Account.find({
			status: "paused",
			billingPausedAt: null,
			stripeSubscriptionId: { $type: "string" },
			subscriptionStatus: { $in: PAID_SUBSCRIPTION_STATUSES },
		})
			.select(BILLING_PAUSE_FIELDS)
			.limit(RECONCILED_PER_RUN)
			.lean(),
		Account.find({ status: { $ne: "paused" }, billingPausedAt: { $ne: null } })
			.select(BILLING_PAUSE_FIELDS)
			.limit(RECONCILED_PER_RUN)
			.lean(),
		// Whole accounts: ending a plan mirrors it on the account, free plans and the website included.
		Account.find({
			status: "paused",
			billingPausedAt: { $lte: new Date(now.getTime() - BLOCKED_PLAN_DAYS * DAY_MS) },
			stripeSubscriptionId: { $type: "string" },
			subscriptionStatus: { $in: PAID_SUBSCRIPTION_STATUSES },
		})
			.limit(RECONCILED_PER_RUN)
			.lean(),
	]);
	let paused = 0;
	for (const account of blocked) if (await pauseBillingQuietly(account)) paused += 1;
	let resumed = 0;
	for (const account of unblocked) if (await resumeBillingQuietly(account)) resumed += 1;
	let ended = 0;
	for (const account of expired) if (await endBlockedPlanQuietly(account, now)) ended += 1;
	return { paused, resumed, ended };
}
