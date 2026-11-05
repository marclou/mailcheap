import "server-only";
import { BLOCKED_BY, ERROR_CODES, getBlockedPlanEnd, getUnblockHint, isBlocked } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import {
	BILLING_PAUSE_FIELDS,
	PLAN_ENDING_MESSAGE,
	isPlanEnding,
	notPlanEnding,
	pauseBillingQuietly,
	resumeBillingQuietly,
} from "@/lib/billing-pause";
import { connectDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { siteExtensions } from "@/lib/site-extensions";
import { resumeTenant, suspendTenantQuietly } from "@/lib/tenants";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";

export const BLOCKED_CAMPAIGN_REASON = "the account is blocked";

// Every block, whatever set it off, reaches the admins and the owner at once: no cooldown, and the block's time in
// the key makes each one an alert of its own. An admin's own block only shows on the admin page.
async function alertBlock(accountId, { reason, by, detail, at, planEndsAt }) {
	const why = [reason, detail].filter(Boolean).join(". ") || "no reason given";
	const ends = planEndsAt && formatDate(planEndsAt);
	await Promise.all([
		sendAlert({
			accountId: null,
			key: `${by === "admin" ? "account-blocked-by-admin" : "account-blocked"}:${accountId}:${at.getTime()}`,
			title: "Account blocked",
			detail: `Account ${accountId}, blocked by ${BLOCKED_BY[by] ?? by}: ${why}.${ends ? ` Its plan isn't billed until it's unblocked, and ends on ${ends} if it's still blocked.` : ""}`,
			action: "Review it on the admin page, and unblock it once it's sorted out.",
			path: "/admin",
			cooldownMinutes: 0,
		}),
		sendAlert({
			accountId,
			key: "account-blocked",
			title: "Account blocked",
			detail: `${reason ? `${reason}. ` : ""}Nothing is sent from this account, welcome emails included, and imports and changes are off. ${ends ? `Your plan isn't billed while it's blocked, and ends on ${ends} if it's still blocked then. ` : ""}${getUnblockHint()}`,
			path: siteExtensions.supportChatPath ?? "/",
			cooldownMinutes: 0,
			isUrgent: true,
		}),
	]);
}

// The owner hears that sending is back, what the block left paused, and when the plan is billed again.
async function alertUnblock(account, billing) {
	const stopped = await Campaign.countDocuments({ accountId: account._id, status: "paused", pauseCode: ERROR_CODES.accountBlocked });
	await sendAlert({
		accountId: account._id,
		key: "account-unblocked",
		title: "Account unblocked",
		detail: [
			"Your account can send again.",
			stopped === 1 && "The campaign the block paused waits for you to resume it from its page.",
			stopped > 1 && `The ${stopped} campaigns the block paused wait for you to resume them from their pages.`,
			describeResumedBilling(account, billing),
		]
			.filter(Boolean)
			.join(" "),
		path: stopped > 0 ? "/campaigns" : "/",
		cooldownMinutes: 0,
	});
}

function describeResumedBilling(account, billing) {
	if (!billing || account.cancelAt) return null;
	if (billing.restarted) return `Your plan starts a new ${account.interval === "year" ? "year" : "month"} today, billed now.`;
	return account.currentPeriodEnd ? `Your plan is billed again from its renewal on ${formatDate(account.currentPeriodEnd)}.` : null;
}

// Spam signals stop the whole account at once: every newsletter's sends, welcome and confirmation emails, imports,
// new contacts and every change but stopping things (lib/actions/run-action.js), its tracked links (app/c) and its
// tenant at the provider. Its plan isn't billed meanwhile (lib/billing-pause.js) but stays active, and so does its
// website: a block protects sending, and the website sends nothing. The plan ends if it's still blocked
// BLOCKED_PLAN_DAYS later.
// Nothing lifts it but an admin (unblockAccount). reason: what the owner reads. detail: for the admins only, like a
// provider's own answer. True when this call blocked it.
export async function blockAccount(accountId, { reason, by = "admin", detail } = {}) {
	await connectDb();
	const pausedAt = new Date();
	const { modifiedCount } = await Account.updateOne(
		{ _id: accountId, status: { $ne: "paused" } },
		{ $set: { status: "paused", pausedAt, pauseReason: reason || undefined, pausedBy: by } }
	);
	if (modifiedCount === 0) return false;
	await Campaign.updateMany(
		{ accountId, status: "sending" },
		{ $set: { status: "paused", pauseReason: BLOCKED_CAMPAIGN_REASON, pauseCode: ERROR_CODES.accountBlocked } }
	);
	await suspendTenantQuietly(accountId);
	const account = await Account.findById(accountId).select(BILLING_PAUSE_FIELDS).lean();
	const isBillingPaused = await pauseBillingQuietly(account, pausedAt);
	await alertBlock(accountId, { reason, by, detail, at: pausedAt, planEndsAt: isBillingPaused ? getBlockedPlanEnd(pausedAt) : null });
	return true;
}

// From the admin page only. The provider lifts its own pause on the tenant first, and throws while it holds it
// (PostShiba's operator_hold), so a provider's hold waits for the provider too. So does the hourly check ending the
// plan of an account blocked too long (lib/billing-pause.js): it throws while that holds the account, and the tenant
// stays suspended. True when this call unblocked it.
export async function unblockAccount(accountId) {
	await connectDb();
	const now = new Date();
	const account = await Account.findById(accountId).select(BILLING_PAUSE_FIELDS).lean();
	if (!isBlocked(account)) return false;
	if (isPlanEnding(account, now)) throw new Error(PLAN_ENDING_MESSAGE);
	await resumeTenant(accountId);
	const { modifiedCount } = await Account.updateOne(
		{ _id: accountId, status: "paused", ...notPlanEnding(now) },
		{ $set: { status: "active", unblockedAt: now }, $unset: { pausedAt: 1, pauseReason: 1, pausedBy: 1 } }
	);
	if (modifiedCount === 0) {
		if (!(await Account.exists({ _id: accountId, status: "paused" }))) return false;
		await suspendTenantQuietly(accountId);
		throw new Error(PLAN_ENDING_MESSAGE);
	}
	const billing = await resumeBillingQuietly(account);
	await alertUnblock(account, billing);
	return true;
}
