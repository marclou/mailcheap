import "server-only";
import Stripe from "stripe";
import { isBlocked } from "@/lib/account-state";
import { getAppUrl } from "@/lib/config";
import { INTERVALS, PLANS, getLookupKey, getPlan, getPrice } from "@/lib/plans";

let stripe;
const priceIds = new Map();
let plansOnSale = null;

const PLANS_ON_SALE_MS = 10 * 60_000;
const PLANS_ON_SALE_RETRY_MS = 60_000;
// Stripe takes 10 lookup keys a request.
const LOOKUP_KEYS_PER_REQUEST = 10;

export function isStripeConfigured() {
	return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe() {
	if (!isStripeConfigured()) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
	stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
	return stripe;
}

function getExpectedAmount(planId, interval) {
	return getPrice(getPlan(planId), interval) * 100;
}

function isPlanPrice(price, planId, interval) {
	return price.currency === "usd" && price.unit_amount === getExpectedAmount(planId, interval) && price.recurring?.interval === interval;
}

// Prices are found by lookup key, and refused when Stripe and lib/plans.js disagree on the amount.
export async function findPriceId(planId, interval) {
	const lookupKey = getLookupKey(planId, interval);
	if (priceIds.has(lookupKey)) return priceIds.get(lookupKey);
	const { data } = await getStripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
	const price = data[0];
	if (!price) throw new Error(`No active Stripe price has the lookup key ${lookupKey}`);
	if (!isPlanPrice(price, planId, interval)) {
		throw new Error(`Stripe price ${price.id} (${lookupKey}) should be ${getExpectedAmount(planId, interval)} USD cents every ${interval}`);
	}
	priceIds.set(lookupKey, price.id);
	return price.id;
}

// The plans Stripe has both prices of, by lookup key and at lib/plans.js's amounts, in plan order: a plan whose prices
// aren't there yet stays off the pricing pages, the paywall and billing, and can't be picked. Static pages read it when
// they're built, the rest every 10 minutes at most. When Stripe can't be read, every plan: Checkout still checks the price.
export async function findPlansOnSale() {
	if (!isStripeConfigured()) return PLANS;
	if (plansOnSale && Date.now() < plansOnSale.until) return plansOnSale.plans;
	try {
		const lookupKeys = PLANS.flatMap(({ id }) => INTERVALS.map((interval) => getLookupKey(id, interval)));
		const prices = [];
		for (let start = 0; start < lookupKeys.length; start += LOOKUP_KEYS_PER_REQUEST) {
			const lookup = { lookup_keys: lookupKeys.slice(start, start + LOOKUP_KEYS_PER_REQUEST), active: true, limit: 100 };
			prices.push(...(await getStripe().prices.list(lookup, { timeout: 5000, maxNetworkRetries: 0 })).data);
		}
		const findPrice = (planId, interval) => prices.find((price) => price.lookup_key === getLookupKey(planId, interval));
		const plans = PLANS.filter(({ id }) =>
			INTERVALS.every((interval) => {
				const price = findPrice(id, interval);
				return Boolean(price) && isPlanPrice(price, id, interval);
			})
		);
		plansOnSale = { plans, until: Date.now() + PLANS_ON_SALE_MS };
	} catch (error) {
		console.error("[billing] Couldn't read the plans' prices from Stripe, so every plan shows:", error.message);
		plansOnSale = { plans: PLANS, until: Date.now() + PLANS_ON_SALE_RETRY_MS };
	}
	return plansOnSale.plans;
}

// The account id travels on the session and the subscription, so every webhook finds its account.
export async function createCheckoutSession({ account, user, planId, interval, attribution = {} }) {
	const price = await findPriceId(planId, interval);
	const accountId = String(account._id);
	const appUrl = getAppUrl();
	const session = await getStripe().checkout.sessions.create({
		mode: "subscription",
		line_items: [{ price, quantity: 1 }],
		client_reference_id: accountId,
		metadata: { ...attribution, accountId },
		subscription_data: { metadata: { accountId } },
		...(account.stripeCustomerId ? { customer: account.stripeCustomerId } : { customer_email: user.email }),
		allow_promotion_codes: true,
		success_url: `${appUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${appUrl}/billing?interval=${interval}`,
	});
	return session.url;
}

// A blocked account's portal: its card, invoices and canceling, without the plan changes the default portal offers,
// since Stripe would void an upgrade's invoice while its billing is paused (lib/billing-pause.js). Made once, with the
// default portal's business details and customer updates, then found by its metadata.
const BLOCKED_PORTAL = "blocked-accounts";
let blockedPortalId = null;

async function findBlockedPortalId() {
	if (blockedPortalId) return blockedPortalId;
	const { data } = await getStripe().billingPortal.configurations.list({ active: true, limit: 100 });
	const found = data.find(({ metadata }) => metadata?.purpose === BLOCKED_PORTAL);
	if (found) return (blockedPortalId = found.id);
	const base = data.find(({ is_default }) => is_default);
	const profile = Object.fromEntries(Object.entries(base?.business_profile ?? {}).filter(([, value]) => value));
	const updates = base?.features?.customer_update;
	const created = await getStripe().billingPortal.configurations.create(
		{
			...(Object.keys(profile).length > 0 && { business_profile: profile }),
			features: {
				customer_update: updates?.enabled ? { enabled: true, allowed_updates: updates.allowed_updates } : { enabled: false },
				invoice_history: { enabled: true },
				payment_method_update: { enabled: true },
				subscription_cancel: { enabled: true, mode: "at_period_end" },
				subscription_update: { enabled: false },
			},
			metadata: { purpose: BLOCKED_PORTAL },
		},
		{ idempotencyKey: `portal-${BLOCKED_PORTAL}` }
	);
	return (blockedPortalId = created.id);
}

// With a plan, Stripe's page to confirm that exact change (it needs plan changes on in the portal's
// settings); without one, or when that page isn't available, the portal's home.
export async function createPortalSession({ account, planId, interval }) {
	const returnUrl = `${getAppUrl()}/billing`;
	const base = { customer: account.stripeCustomerId, return_url: returnUrl };
	if (isBlocked(account)) return (await getStripe().billingPortal.sessions.create({ ...base, configuration: await findBlockedPortalId() })).url;
	if (planId && account.stripeSubscriptionId) {
		try {
			const [price, subscription] = await Promise.all([
				findPriceId(planId, interval),
				getStripe().subscriptions.retrieve(account.stripeSubscriptionId),
			]);
			const session = await getStripe().billingPortal.sessions.create({
				...base,
				flow_data: {
					type: "subscription_update_confirm",
					subscription_update_confirm: {
						subscription: subscription.id,
						items: [{ id: subscription.items.data[0].id, price, quantity: 1 }],
					},
					after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
				},
			});
			return session.url;
		} catch (error) {
			console.error("[billing] The plan change page isn't available, opening the portal:", error.message);
		}
	}
	return (await getStripe().billingPortal.sessions.create(base)).url;
}
