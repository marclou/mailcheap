import "server-only";
import { hasActiveSubscription, isPaidStatus } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { connectDb } from "@/lib/db";
import { formatUsdCents } from "@/lib/format";
import { hasActiveFreePlan, isOnFreePlan, parseLookupKey } from "@/lib/plans";
import { syncSharedSenders } from "@/lib/shared-sender";
import { siteExtensions } from "@/lib/site-extensions";
import { getStripe } from "@/lib/stripe";
import { getTenant, provisionTenantQuietly } from "@/lib/tenants";
import { startFreePlanUsage, startUsagePeriod } from "@/lib/usage-period";
import { isObjectIdString } from "@/lib/validation";
import Account from "@/models/Account";

function stripeId(value) {
	return typeof value === "string" ? value : (value?.id ?? null);
}

function toDate(seconds) {
	return seconds ? new Date(seconds * 1000) : null;
}

// The accountId our checkout puts in metadata, else the Stripe ids already stored on the account.
async function findAccountFor({ accountId, subscriptionId, customerId }) {
	if (isObjectIdString(accountId)) {
		const account = await Account.findById(accountId).lean();
		if (account) return account;
	}
	if (subscriptionId) {
		const account = await Account.findOne({ stripeSubscriptionId: subscriptionId }).lean();
		if (account) return account;
	}
	return customerId ? Account.findOne({ stripeCustomerId: customerId }).lean() : null;
}

// Mirrors a subscription, as Stripe has it now, on its account. An older subscription ending never
// cancels the current one.
export async function applySubscription(account, subscription) {
	const isCurrent = !account.stripeSubscriptionId || account.stripeSubscriptionId === subscription.id;
	const grantsAccess = isPaidStatus(subscription.status);
	if (!isCurrent && !grantsAccess) return { ignored: "an older subscription" };

	// Since API version 2025-03-31, the period lives on the subscription's items.
	const item = subscription.items?.data?.[0];
	const price = parseLookupKey(item?.price?.lookup_key);
	if (!price) console.error(`[billing] ${subscription.id} has a price with an unknown lookup key: ${item?.price?.lookup_key}`);
	const periodStart = toDate(item?.current_period_start ?? subscription.current_period_start);
	const periodEnd = toDate(item?.current_period_end ?? subscription.current_period_end);
	const cancelAt = toDate(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? periodEnd : null);
	// A first plan, a new one after a canceled one, or one after a free plan, which pays nothing: the month starts
	// now. Renewals wait for invoice.paid, and nothing starts while billing is paused (lib/billing-pause.js): Stripe
	// voids those periods' invoices.
	const paidThrough = account.usage?.paidThrough;
	const isBillingPaused = Boolean(subscription.pause_collection || account.billingPausedAt);
	const startsUsage = grantsAccess && !isBillingPaused && periodStart && periodEnd && (!paidThrough || paidThrough < periodStart);
	// A paid plan ending hands over to a free plan still running, with the free plan's months.
	const startsFreeUsage = !grantsAccess && isPaidStatus(account.subscriptionStatus) && hasActiveFreePlan(account);

	await Account.updateOne(
		{ _id: account._id },
		{
			$set: {
				stripeCustomerId: stripeId(subscription.customer),
				stripeSubscriptionId: subscription.id,
				subscriptionStatus: subscription.status,
				currentPeriodStart: periodStart,
				currentPeriodEnd: periodEnd,
				...(cancelAt && { cancelAt }),
				...(price && { plan: price.plan, interval: price.interval }),
				...(startsUsage && { usage: startUsagePeriod({ start: periodStart, end: periodEnd }) }),
				...(startsFreeUsage && { usage: startFreePlanUsage(account.comp.grantedAt) }),
			},
			...(!cancelAt && { $unset: { cancelAt: 1 } }),
		}
	);
	await applyAccessChange(account, { ...account, subscriptionStatus: subscription.status });
	return { updated: true, status: subscription.status };
}

// A plan starting, paid or free, gets the account its tenant at the email provider, and newsletters set up before it
// their shared address. The archive goes offline when the account loses its plan and comes back with the next one.
async function applyAccessChange(before, after) {
	const hadAccess = hasActiveSubscription(before);
	const hasAccess = hasActiveSubscription(after);
	if (hadAccess !== hasAccess) revalidateArchive();
	if (hasAccess && !getTenant(after)) await provisionTenantQuietly(after._id);
	if (hasAccess && !hadAccess) await syncSharedSenders(after);
}

// A free plan from an admin (account.comp) starts what a paid plan starts, without Stripe. While Stripe bills a plan,
// that one stays in charge with its own month. Giving one again changes its plan and end, and keeps its month.
export async function grantFreePlan({ accountId, plan, until = null, by }) {
	await connectDb();
	const account = await Account.findById(accountId).lean();
	if (!account) return null;
	const now = new Date();
	const current = hasActiveFreePlan(account, now) ? account.comp : null;
	const comp = { plan, grantedAt: current?.grantedAt ?? now, by, ...(until && { until }) };
	const startsUsage = !current && !isPaidStatus(account.subscriptionStatus);
	await Account.updateOne({ _id: account._id }, { $set: { comp, ...(startsUsage && { usage: startFreePlanUsage(now) }) } });
	await applyAccessChange(account, { ...account, comp });
	return comp;
}

// Ending a free plan early works like reaching its end: the data stays, and sending stops unless Stripe bills a plan.
export async function revokeFreePlan(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).lean();
	const now = new Date();
	if (!hasActiveFreePlan(account, now)) return false;
	await Account.updateOne({ _id: account._id }, { $set: { "comp.until": now } });
	await applyAccessChange(account, { ...account, comp: { ...account.comp, until: now } });
	return true;
}

async function handleCheckoutCompleted(session) {
	if (session.mode !== "subscription" || !session.subscription) return { ignored: "not a subscription checkout" };
	const account = await findAccountFor({
		accountId: session.client_reference_id ?? session.metadata?.accountId,
		customerId: stripeId(session.customer),
	});
	if (!account) {
		console.error(`[billing] Checkout ${session.id} has no account`);
		return { ignored: "no account" };
	}
	const subscription = await getStripe().subscriptions.retrieve(stripeId(session.subscription));
	return applySubscription(account, subscription);
}

// Events can arrive out of order, so the subscription is read fresh from Stripe every time.
async function handleSubscriptionChange({ id }) {
	const subscription = await getStripe().subscriptions.retrieve(id);
	const account = await findAccountFor({
		accountId: subscription.metadata?.accountId,
		subscriptionId: subscription.id,
		customerId: stripeId(subscription.customer),
	});
	if (!account) {
		console.error(`[billing] Subscription ${subscription.id} has no account`);
		return { ignored: "no account" };
	}
	return applySubscription(account, subscription);
}

// A paid invoice that pays further than before starts a new period, with the email count at zero. The
// same invoice delivered twice, or a mid-period upgrade, pays no further and changes nothing.
async function handleInvoicePaid(invoice) {
	const details = invoice.parent?.subscription_details;
	const subscriptionId = stripeId(details?.subscription ?? invoice.subscription);
	if (!subscriptionId) return { ignored: "not a subscription invoice" };
	const account = await findAccountFor({
		accountId: details?.metadata?.accountId,
		subscriptionId,
		customerId: stripeId(invoice.customer),
	});
	if (!account) return { ignored: "no account" };
	if (account.stripeSubscriptionId && account.stripeSubscriptionId !== subscriptionId) {
		return { ignored: "an older subscription" };
	}
	// The free plan's months count until a subscription is on again, which starts its own month.
	if (isOnFreePlan(account)) return { ignored: "on a free plan" };

	const periods = (invoice.lines?.data ?? []).map(({ period }) => period).filter((period) => period?.end);
	if (periods.length === 0) return { ignored: "no period" };
	const end = Math.max(...periods.map((period) => period.end));
	const start = Math.min(...periods.filter((period) => period.end === end).map((period) => period.start));
	const usage = startUsagePeriod({ start: toDate(start), end: toDate(end) });
	const { modifiedCount } = await Account.updateOne(
		{ _id: account._id, $or: [{ "usage.paidThrough": null }, { "usage.paidThrough": { $lt: usage.paidThrough } }] },
		{ $set: { usage } }
	);
	return { reset: modifiedCount > 0 };
}

// An early fraud warning: the card's bank says a payment was fraud, and a chargeback usually follows. Refunding it first
// heads the chargeback off, and as "fraudulent" it puts the card and the email on Radar's block lists. The plan it paid
// for ends at once, before a renewal charges the same card. Whether to block the account is the admins' call. Stripe
// retries a failed delivery, and each step checks what's done, so a retry finishes the rest.
async function handleEarlyFraudWarning(warning) {
	const stripe = getStripe();
	const charge = await stripe.charges.retrieve(stripeId(warning.charge));
	const refunds = !charge.refunded && !charge.disputed;
	if (refunds) await stripe.refunds.create({ charge: charge.id, reason: "fraudulent" }, { idempotencyKey: `efw-refund-${warning.id}` });
	const subscriptionId = await findPaidSubscriptionId(charge);
	const account = await findAccountFor({ subscriptionId, customerId: stripeId(charge.customer) });
	const isCurrent = Boolean(subscriptionId) && account?.stripeSubscriptionId === subscriptionId;
	const cancels = isCurrent && isPaidStatus((await stripe.subscriptions.retrieve(subscriptionId)).status);
	if (cancels) {
		await stripe.subscriptions.cancel(subscriptionId, {
			cancellation_details: { comment: "Early fraud warning on a payment, refunded" },
		});
	}
	if (refunds || cancels) await alertFraudWarning({ account, charge, warning, refunds, cancels });
	return { refunded: refunds, ...(cancels && { canceled: subscriptionId }) };
}

// The subscription whose invoice a charge paid, if any.
async function findPaidSubscriptionId(charge) {
	const paymentIntent = stripeId(charge.payment_intent);
	if (!paymentIntent) return null;
	const stripe = getStripe();
	const { data } = await stripe.invoicePayments.list({
		payment: { type: "payment_intent", payment_intent: paymentIntent },
		status: "paid",
		limit: 1,
	});
	const invoiceId = stripeId(data[0]?.invoice);
	if (!invoiceId) return null;
	const invoice = await stripe.invoices.retrieve(invoiceId);
	return stripeId(invoice.parent?.subscription_details?.subscription);
}

async function alertFraudWarning({ account, charge, warning, refunds, cancels }) {
	const amount = formatUsdCents(charge.amount / 100);
	const done = [refunds && "refunded it", cancels && "ended the plan it paid for"].filter(Boolean).join(" and ");
	await Promise.all([
		sendAlert({
			accountId: null,
			key: `fraud-warning:${charge.id}`,
			title: "Payment refunded after a fraud warning",
			detail: `${account ? `Account ${account._id}` : "A payment without an account"}: the card's bank reported a ${amount} payment as fraud (${warning.fraud_type ?? "no type given"}), and MailCheap ${done}.`,
			action: account ? "Look at the account on the admin page, and block it if it's abuse." : "Look at the payment in Stripe.",
			path: "/admin",
			cooldownMinutes: 0,
		}),
		cancels &&
			sendAlert({
				accountId: account._id,
				key: "payment-refunded",
				title: "Your plan ended",
				detail: `Your card's bank reported a ${amount} payment to MailCheap as unauthorized, so we refunded it and ended the plan it paid for. Your newsletters, contacts and campaigns are kept. If you made this payment, chat with us.`,
				path: siteExtensions.supportChatPath ?? "/billing",
				cooldownMinutes: 0,
			}),
	]);
}

export async function handleStripeEvent(event) {
	await connectDb();
	switch (event.type) {
		case "checkout.session.completed":
			return handleCheckoutCompleted(event.data.object);
		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted":
			return handleSubscriptionChange(event.data.object);
		case "invoice.paid":
			return handleInvoicePaid(event.data.object);
		case "radar.early_fraud_warning.created":
			return handleEarlyFraudWarning(event.data.object);
		default:
			return { ignored: event.type };
	}
}

// Coming back from Checkout: the plan is on before the webhook arrives, so the dashboard opens right away.
export async function syncCheckoutSession({ account, sessionId }) {
	await connectDb();
	const session = await getStripe().checkout.sessions.retrieve(sessionId);
	if (session.client_reference_id !== String(account._id)) return { ignored: "another account's checkout" };
	if (session.status !== "complete") return { ignored: "checkout not complete" };
	return handleCheckoutCompleted(session);
}
