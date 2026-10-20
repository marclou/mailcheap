import { isCloud, isSendingEnabled } from "./config.js";
import { formatDate, formatNumber } from "./format.js";
import { getAccountLimits, hasActiveFreePlan, isOnFreePlan, isPaidStatus } from "./plans.js";
import { getNextUsagePeriod } from "./usage-period.js";

export { isPaidStatus };

// Stable codes: the dashboard shows an upgrade link for them, the API and MCP will return them.
export const ERROR_CODES = {
	subscriptionRequired: "subscription_required",
	accountBlocked: "account_blocked",
	planLimitEmails: "plan_limit_emails",
	planLimitSubscribers: "plan_limit_subscribers",
};

// The owner deleted the account and it waits for its purge (lib/account-deletion.js).
export function isDeletionPending(account) {
	return Boolean(account?.deletion?.requestedAt);
}

// A self-hosted server has no billing: every account counts as paid. On MailCheap Cloud a free plan from an admin
// counts as paid too. An account waiting to be deleted counts as unpaid on both, so it sends nothing, takes no
// signups and its archive is offline.
export function hasActiveSubscription(account) {
	if (isDeletionPending(account)) return false;
	return !isCloud() || isPaidStatus(account?.subscriptionStatus) || hasActiveFreePlan(account);
}

// What hasActiveSubscription reads, for queries that load only that.
export const ACCESS_FIELDS = { subscriptionStatus: 1, comp: 1, deletion: 1 };

// Blocked after spam signals or by an admin (lib/account-blocks.js), stored as "paused".
export function isBlocked(account) {
	return account?.status === "paused";
}

// Who blocked it (account.pausedBy), for the admins.
export const BLOCKED_BY = {
	admin: "an admin",
	rates: "the 7-day check",
	campaign: "a campaign's rates",
	slice: "a first send's slice",
	trap: "a spam trap",
	ses: "SES",
	postshiba: "PostShiba",
	groundmail: "Groundmail",
	gmail: "Gmail's spam rate",
};
const PROVIDER_BLOCKERS = new Set(["ses", "postshiba", "groundmail"]);

// Who blocked an account, as the admin page says it: without naming the email provider.
export function describeBlocker(pausedBy) {
	return PROVIDER_BLOCKERS.has(pausedBy) ? "the email provider" : (BLOCKED_BY[pausedBy] ?? "an admin");
}

// On MailCheap Cloud the owner asks in the support chat, which the dashboard opens from its blocked bar; the API and
// emails give its address (supportUrl, lib/support.js).
export function getUnblockHint(supportUrl) {
	if (!isCloud()) return "An admin can unblock it on the admin page.";
	return supportUrl ? `Chat with us to unblock it: ${supportUrl}` : "Chat with us to unblock it.";
}

// What a blocked account's owner reads wherever something is refused: why, and who unblocks it.
export function getBlockedMessage(account, supportUrl) {
	const reason = account?.pauseReason?.trim().replace(/\.$/, "");
	return `This account is blocked${reason ? `: ${reason}` : ""}. ${getUnblockHint(supportUrl)}`;
}

// The account menu: whether the account sends, and what to do when it doesn't.
export function getSendingStatus(account) {
	if (isBlocked(account)) return { label: "Account blocked", hint: getBlockedMessage(account), tone: "red" };
	if (!hasActiveSubscription(account)) return { label: "No plan", hint: "Pick a plan to send", tone: "gray" };
	if (!isSendingEnabled()) return { label: "Sending off", hint: "Sending is off on this server", tone: "gray" };
	return { label: "Sending on", hint: null, tone: "green" };
}

export function isPlanLimitCode(code) {
	return code === ERROR_CODES.planLimitEmails || code === ERROR_CODES.planLimitSubscribers;
}

export function codedError({ code, message }) {
	return Object.assign(new Error(message), { code });
}

// For BadgeStatus: Stripe's status while the account can't use it, "blocked" when an admin or a spam signal blocked
// it, "active" on a free plan.
export function getAccountStatus(account) {
	if (isDeletionPending(account)) return "deleting";
	if (!isCloud()) return isBlocked(account) ? "blocked" : "active";
	if (hasActiveSubscription(account) && isBlocked(account)) return "blocked";
	if (isOnFreePlan(account)) return "active";
	return account?.subscriptionStatus || "no_plan";
}

// Every email the account sends needs both, welcome and confirmation emails included.
export function getAccountSendProblem(account) {
	if (isBlocked(account)) return { code: ERROR_CODES.accountBlocked, message: getBlockedMessage(account) };
	if (!hasActiveSubscription(account)) {
		return { code: ERROR_CODES.subscriptionRequired, message: "Pick a plan to send" };
	}
	return null;
}

// recipients: the emails this send adds. queued: emails other sends haven't sent yet.
export function getPlanLimitProblem({ account, emailsSent, queued = 0, recipients, activeContacts }) {
	const limits = getAccountLimits(account);
	if (!limits) return null;
	if (activeContacts > limits.subscribers) {
		return {
			code: ERROR_CODES.planLimitSubscribers,
			message: `You have ${formatNumber(activeContacts)} subscribers and your plan allows ${formatNumber(limits.subscribers)}. Upgrade to send.`,
		};
	}
	const left = Math.max(0, limits.emails - emailsSent - queued);
	if (recipients > left) {
		return {
			code: ERROR_CODES.planLimitEmails,
			message: `This send needs ${formatNumber(recipients)} emails and your plan has ${formatNumber(left)} left this month. Upgrade to send.`,
		};
	}
	return null;
}

// Welcome emails take room in the month's emails like campaign emails, and stop once it's used up until the month
// resets or the plan grows (lib/sending.js). A stored month that's over counts as reset, before rollUsagePeriod moves it.
export function areWelcomeEmailsPaused(account, now = new Date()) {
	const limits = getAccountLimits(account);
	if (!limits || !hasActiveSubscription(account)) return false;
	const emailsSent = getNextUsagePeriod(account.usage, now) ? 0 : (account.usage?.emailsSent ?? 0);
	return emailsSent >= limits.emails;
}

// What the owner reads once welcome emails stop: the email that tells them, and the dashboard's notices.
export function getWelcomePauseNotice({ emailsLimit, periodEnd }) {
	const resetsOn = formatDate(periodEnd);
	return {
		title: `Welcome emails paused: you've used this month's ${formatNumber(emailsLimit)} emails`,
		detail: `They resume when your emails reset${resetsOn ? ` on ${resetsOn}` : ""}, or as soon as you upgrade. Subscribers who join before then won't get one later.`,
	};
}
