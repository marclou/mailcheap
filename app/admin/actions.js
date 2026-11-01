"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { blockAccount, unblockAccount } from "@/lib/account-blocks";
import { setLimitOverrides } from "@/lib/accounts";
import { dismissAlertType, dismissAttention, getAttentionDetails } from "@/lib/admin-alerts";
import { requireAdmin } from "@/lib/auth";
import { grantFreePlan, revokeFreePlan } from "@/lib/billing";
import { isCloud } from "@/lib/config";
import { approveReview, approveSignupEmailReview, rejectReview, rejectSignupEmailReview } from "@/lib/content-review-decisions";
import { getGlobalSuppression, removeGlobalSuppression } from "@/lib/global-suppressions";
import { getPlan } from "@/lib/plans";
import { serialize } from "@/lib/serialize";
import { normalizeEmail } from "@/lib/validation";

const MAX_REASON_LENGTH = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Empty means the plan's number; anything else must be a whole number.
function readLimit(value) {
	const text = String(value ?? "")
		.replaceAll(",", "")
		.trim();
	if (!text) return undefined;
	const number = Number(text);
	return Number.isInteger(number) && number >= 0 ? number : Number.NaN;
}

// A day from the date field: the plan ends as that day starts, at midnight UTC. Empty means no end.
function readEndDate(value) {
	const text = String(value ?? "").trim();
	if (!text) return null;
	return DATE_PATTERN.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(Number.NaN);
}

// An item of "Needs a look" (kind: alert, account or campaign) for its dialog: what happened, who was told, and
// what happened around it.
export async function loadAttention(kind, id) {
	await requireAdmin();
	const details = await getAttentionDetails({ kind: String(kind), id: String(id) });
	return details ? { details: serialize(details) } : { error: "Not found" };
}

// It leaves "Needs a look" until it happens again.
export async function dismissAttentionAction(kind, id) {
	const admin = await requireAdmin();
	if (!(await dismissAttention({ kind: String(kind), id: String(id), by: admin.email }))) return { error: "Not found" };
	console.info(`[admin] ${admin.email} dismissed ${kind} ${id}`);
	revalidatePath("/admin");
	return { ok: true };
}

// The alert and every other one of its kind still showing.
export async function dismissAlertTypeAction(id) {
	const admin = await requireAdmin();
	const count = await dismissAlertType({ id: String(id), by: admin.email });
	if (count === null) return { error: "Not found" };
	console.info(`[admin] ${admin.email} dismissed ${count} alerts like ${id}`);
	revalidatePath("/admin");
	return { ok: true, count };
}

// reason: what the account's owner reads on their dashboard.
export async function blockAccountAction(accountId, reason) {
	const admin = await requireAdmin();
	if (!isValidObjectId(accountId)) return { error: "Account not found" };
	const text = String(reason ?? "").trim().slice(0, MAX_REASON_LENGTH);
	const isBlocked = await blockAccount(accountId, { reason: text, by: "admin", detail: `Blocked by ${admin.email}` });
	console.info(`[admin] ${admin.email} blocked account ${accountId}`);
	revalidatePath("/admin");
	return isBlocked ? { ok: true } : { error: "Already blocked" };
}

// An issue the content check held (lib/content-review.js): approving sends it now, as its owner sent it.
export async function approveContentReview(campaignId) {
	const admin = await requireAdmin();
	if (!isValidObjectId(campaignId)) return { error: "Campaign not found" };
	const result = await approveReview({ campaignId: String(campaignId), admin });
	revalidatePath("/admin");
	revalidatePath(`/admin/campaigns/${campaignId}`);
	return result;
}

// note: what its owner reads. block: the account too, as blocking it from the admin page does.
export async function rejectContentReview(campaignId, { note, block } = {}) {
	const admin = await requireAdmin();
	if (!isValidObjectId(campaignId)) return { error: "Campaign not found" };
	const result = await rejectReview({ campaignId: String(campaignId), admin, note: typeof note === "string" ? note : "", block: block === true });
	revalidatePath("/admin");
	revalidatePath(`/admin/campaigns/${campaignId}`);
	return result;
}

// A newsletter's own welcome, confirmation or last-chance email the content check holds (lib/signup-email-review.js):
// approving lets it go out.
export async function approveSignupEmail(newsletterId, kind) {
	const admin = await requireAdmin();
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	const result = await approveSignupEmailReview({ newsletterId: String(newsletterId), kind: String(kind), admin });
	revalidatePath("/admin");
	revalidatePath(`/admin/newsletters/${newsletterId}`);
	return result;
}

// note: what its owner reads. block: the account too.
export async function rejectSignupEmail(newsletterId, kind, { note, block } = {}) {
	const admin = await requireAdmin();
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	const result = await rejectSignupEmailReview({
		newsletterId: String(newsletterId),
		kind: String(kind),
		admin,
		note: typeof note === "string" ? note : "",
		block: block === true,
	});
	revalidatePath("/admin");
	revalidatePath(`/admin/newsletters/${newsletterId}`);
	return result;
}

// The only way a block ends. Its campaigns stay paused until their owner resumes them.
export async function unblockAccountAction(accountId) {
	const admin = await requireAdmin();
	if (!isValidObjectId(accountId)) return { error: "Account not found" };
	try {
		if (!(await unblockAccount(accountId))) return { error: "Not blocked" };
	} catch (error) {
		console.error(`[admin] The provider didn't resume account ${accountId}:`, error);
		return { error: `Still blocked, the tenant wasn't resumed: ${error.message}` };
	}
	console.info(`[admin] ${admin.email} unblocked account ${accountId}`);
	revalidatePath("/admin");
	return { ok: true };
}

export async function saveLimits(_state, formData) {
	const admin = await requireAdmin();
	const accountId = String(formData.get("accountId") ?? "");
	if (!isValidObjectId(accountId)) return { error: "Account not found" };
	const limits = { emailsPerMonth: readLimit(formData.get("emailsPerMonth")), subscribers: readLimit(formData.get("subscribers")) };
	if (Object.values(limits).some(Number.isNaN)) return { error: "Use whole numbers, or leave empty for the plan's" };

	if (!(await setLimitOverrides(accountId, limits))) return { error: "Account not found" };
	console.info(`[admin] ${admin.email} set limits for account ${accountId}: ${JSON.stringify(limits)}`);
	revalidatePath("/admin");
	return { ok: true, savedAt: Date.now() };
}

export async function giveFreePlan(_state, formData) {
	const admin = await requireAdmin();
	if (!isCloud()) return { error: "There are no plans on a self-hosted server" };
	const accountId = String(formData.get("accountId") ?? "");
	if (!isValidObjectId(accountId)) return { error: "Account not found" };
	const plan = getPlan(String(formData.get("plan") ?? ""));
	if (!plan) return { error: "Pick a plan" };
	const until = readEndDate(formData.get("until"));
	if (until && !(until > new Date())) return { error: "Pick an end date after today, or none" };

	if (!(await grantFreePlan({ accountId, plan: plan.id, until, by: admin.email }))) return { error: "Account not found" };
	console.info(`[admin] ${admin.email} gave account ${accountId} a free ${plan.name} plan${until ? ` until ${until.toISOString()}` : ""}`);
	revalidatePath("/admin");
	return { ok: true, savedAt: Date.now() };
}

export async function endFreePlan(accountId) {
	const admin = await requireAdmin();
	if (!isValidObjectId(accountId)) return { error: "Account not found" };
	if (!(await revokeFreePlan(accountId))) return { error: "No free plan to end" };
	console.info(`[admin] ${admin.email} ended the free plan of account ${accountId}`);
	revalidatePath("/admin");
	return { ok: true };
}

// The never-email list's entry for an address. The address is a reader's, so the logs never name it.
export async function findUndeliverableAddress(email) {
	await requireAdmin();
	const address = normalizeEmail(email);
	if (!address) return { error: "Enter a valid email" };
	const entry = await getGlobalSuppression(address);
	if (!entry) return { email: address, entry: null };
	const { reason, detail, createdAt, expiresAt } = entry;
	return { email: address, entry: { reason, detail: detail ?? null, listedAt: createdAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null } };
}

// For a false positive: the contacts the list stopped with this address, in every account, are active again.
export async function removeUndeliverableAddress(email) {
	const admin = await requireAdmin();
	const address = normalizeEmail(email);
	if (!address) return { error: "Enter a valid email" };
	const removed = await removeGlobalSuppression(address);
	if (!removed) return { error: "Not on the list" };
	console.info(`[admin] ${admin.email} took an address off the never-email list: ${removed.restored} contacts active again`);
	revalidatePath("/admin");
	return { ok: true, restored: removed.restored };
}
