import "server-only";
import * as z from "zod";
import { BLOCKED_PLAN_DAYS, getAccountStatus, hasActiveSubscription, isPaidStatus } from "@/lib/account-state";
import { findOwnerEmail } from "@/lib/accounts";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import { UsageSchema, dateOutput, getUsageOutput, toIso } from "@/lib/actions/shared";
import { isCloud } from "@/lib/config";
import { INTERVALS, PLAN_IDS, getAccountPlan, getPlan, getPrice, hasActiveFreePlan, isOnFreePlan } from "@/lib/plans";
import { siteExtensions } from "@/lib/site-extensions";
import { createCheckoutSession, createPortalSession, findPlansOnSale, isStripeConfigured } from "@/lib/stripe";

const GROUP = "Billing";
const OFF_NOTE = " A self-hosted server has no billing and answers billing_off.";

function assertBillingOn() {
	if (!isCloud()) throw actionError("billing_off", "Billing is off on this server: every account has every feature, without plan limits");
}

function assertStripe() {
	if (!isStripeConfigured()) throw actionError("unavailable", "Billing isn't set up on this server");
}

async function openStripe(open) {
	assertStripe();
	try {
		return await open();
	} catch (error) {
		console.error("[billing] Couldn't open Stripe:", error.message);
		throw actionError("unavailable", "Stripe can't be reached right now. Try again in a minute.");
	}
}

function getFreePlanOutput(account) {
	if (!hasActiveFreePlan(account)) return null;
	const { id, name } = getPlan(account.comp.plan);
	return { id, name, grantedAt: toIso(account.comp.grantedAt), until: toIso(account.comp.until) };
}

export const billingActions = [
	defineAction({
		name: "get_billing",
		title: "Get the plan and usage",
		group: GROUP,
		description: `The account's plan, subscription status and this month's usage against the plan's limits, with every plan on sale for comparison. Works without an active plan.${OFF_NOTE}`,
		http: { method: "GET", path: "/billing" },
		readOnly: true,
		requiresPlan: false,
		output: z.object({
			plan: z
				.object({
					id: z.enum(PLAN_IDS),
					name: z.string(),
					interval: z.enum(INTERVALS),
					price: z.number().describe("USD per interval: 0 on a free plan"),
				})
				.nullable(),
			status: z.string().describe("active, trialing, past_due, canceled… blocked while the account is blocked, no_plan before the first payment"),
			isActive: z.boolean().describe("The plan is paid, or free from MailCheap: everything works"),
			freePlan: z
				.object({
					id: z.enum(PLAN_IDS),
					name: z.string(),
					grantedAt: dateOutput,
					until: dateOutput.describe("When it ends; null: no end date"),
				})
				.nullable()
				.describe("A plan MailCheap gave the account, without Stripe; null without one. A paid plan takes over while there's one"),
			currentPeriodEnd: dateOutput.describe("The paid period's end; null on a free plan"),
			cancelAt: dateOutput.describe("When a canceled plan stops"),
			billingPaused: z
				.boolean()
				.describe(
					`The account is blocked, so its plan isn't billed: renewals are skipped until it's unblocked, and the plan stays active meanwhile. It ends if the account is still blocked ${BLOCKED_PLAN_DAYS} days after the block paused it`
				),
			usage: UsageSchema,
			plans: z.array(
				z.object({
					id: z.enum(PLAN_IDS),
					name: z.string(),
					monthlyPrice: z.number(),
					yearlyPrice: z.number(),
					emailsPerMonth: z.number().int(),
					subscribers: z.number().int(),
				})
			),
		}),
		handler: async ({ account }) => {
			assertBillingOn();
			const isFree = isOnFreePlan(account);
			const plan = getAccountPlan(account);
			const interval = isFree ? "month" : (account.interval ?? "month");
			return {
				plan: plan ? { id: plan.id, name: plan.name, interval, price: isFree ? 0 : getPrice(plan, interval) } : null,
				status: getAccountStatus(account),
				isActive: hasActiveSubscription(account),
				freePlan: getFreePlanOutput(account),
				currentPeriodEnd: isFree ? null : toIso(account.currentPeriodEnd),
				cancelAt: isFree ? null : toIso(account.cancelAt),
				billingPaused: Boolean(account.billingPausedAt),
				usage: await getUsageOutput(account),
				plans: (await findPlansOnSale()).map(({ id, name, monthlyPrice, emailsPerMonth, subscribers }) => ({
					id,
					name,
					monthlyPrice,
					yearlyPrice: getPrice({ monthlyPrice }, "year"),
					emailsPerMonth,
					subscribers,
				})),
			};
		},
	}),
	defineAction({
		name: "change_plan",
		title: "Change plan",
		group: GROUP,
		description: `Returns a Stripe page where the account owner picks up the change: Checkout without a paid plan (on a free plan too: the paid plan takes over), the Customer Portal's confirmation page with one. Nothing changes until they confirm there. Give the URL to the user. A blocked account's plan can't change until it's unblocked.${OFF_NOTE}`,
		http: { method: "POST", path: "/billing/change-plan" },
		requiresPlan: false,
		openWorld: true,
		rateLimit: { limit: 30, window: "1 h" },
		example: { plan: "growth", interval: "year" },
		input: z.object({
			plan: z.enum(PLAN_IDS).describe("starter, growth, pro, scale, max or ultra"),
			interval: z.enum(INTERVALS).optional().describe("month (default) or year, which costs 10 months"),
		}),
		output: z.object({ url: z.string(), kind: z.enum(["checkout", "portal"]) }),
		handler: async ({ account, user, input, via }) => {
			assertBillingOn();
			if (!(await findPlansOnSale()).some(({ id }) => id === input.plan)) {
				throw actionError("validation_failed", `plan: ${getPlan(input.plan).name} isn't on sale yet. get_billing lists the plans on sale`);
			}
			const interval = input.interval ?? "month";
			if (isPaidStatus(account.subscriptionStatus)) {
				return { url: await openStripe(() => createPortalSession({ account, planId: input.plan, interval })), kind: "portal" };
			}
			const email = user?.email ?? (await findOwnerEmail(account._id));
			const attribution = via === "dashboard" ? await siteExtensions.readCheckoutAttribution() : {};
			return {
				url: await openStripe(() => createCheckoutSession({ account, user: { email }, planId: input.plan, interval, attribution })),
				kind: "checkout",
			};
		},
	}),
	defineAction({
		name: "open_billing_portal",
		title: "Open the billing portal",
		group: GROUP,
		description: `Returns a Stripe Customer Portal link for the account owner: payment method, invoices, plan changes and cancellation. A blocked account's portal has everything but plan changes.${OFF_NOTE}`,
		http: { method: "POST", path: "/billing/portal" },
		requiresPlan: false,
		whileBlocked: true,
		openWorld: true,
		rateLimit: { limit: 30, window: "1 h" },
		output: z.object({ url: z.string() }),
		handler: async ({ account }) => {
			assertBillingOn();
			if (!account.stripeCustomerId) throw actionError("conflict", "Pick a plan first: the account has no billing details yet");
			return { url: await openStripe(() => createPortalSession({ account })) };
		},
	}),
];
