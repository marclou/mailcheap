// Admin alerts (sendAlert without an account, to ADMIN_ALERT_EMAILS or else ADMIN_EMAILS) by kind: their key up to the
// first ":". Only what an admin can act on is emailed. "telegram": something is broken or waits for an admin, so it
// reaches Telegram too when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. "email": worth a look, by email only.
// "dashboard": nothing for an admin to do, because MailCheap handles it on its own or whoever needs to know already
// does: only on the admin page, neither emailed nor on Telegram. An account's own alerts go to its owner and never to
// Telegram.
export const ADMIN_ALERTS = {
	"account-blocked": "telegram",
	"account-blocked-by-admin": "dashboard",
	"affiliate-ads": "telegram",
	"affiliate-event-failed": "telegram",
	"affiliate-payouts": "telegram",
	"affiliate-review": "telegram",
	"content-check-failed": "telegram",
	"content-check-limit": "telegram",
	"content-draft-review": "email",
	"content-flagged": "email",
	"content-review": "telegram",
	"credential-refused": "dashboard",
	"customer-blocked": "telegram",
	"deleted-email-signup": "email",
	"dns-helper-cap": "telegram",
	"dns-helper-down": "telegram",
	"gmail-backoff": "dashboard",
	"gmail-spam-rate": "telegram",
	"inbound-cap": "telegram",
	"job-failing": "telegram",
	"platform-email-failed": "telegram",
	"postmaster-refused": "telegram",
	"postshiba-cap": "telegram",
	"postshiba-kyc": "telegram",
	"postshiba-status-refused": "telegram",
	"postshiba-suspended": "telegram",
	"purge-postponed": "telegram",
	"qstash-refused": "telegram",
	"rate-limit-unavailable": "telegram",
	"send-refused": "telegram",
	"shared-sender-failed": "telegram",
	"shared-sender-left": "telegram",
	"shared-sender-waiting": "dashboard",
	"signup-email-flagged": "email",
	"signup-email-review": "telegram",
	"stripe-webhook-failed": "telegram",
	"tenant": "email",
	"tenant-failed": "email",
	"tenant-hold": "telegram",
	"tenant-resume-failed": "telegram",
	"tenant-suspend-failed": "telegram",
	"web-page-flagged": "email",
	"web-page-review": "telegram",
	"webhook-failing": "telegram",
};

// How many of an alert's latest occurrences its document keeps (lib/alerts.js).
export const ALERT_OCCURRENCES_KEPT = 20;

export function getAlertKind(key) {
	return String(key ?? "").split(":")[0];
}

// The kind without an id glued to it: campaign-paused-<campaign id> and scheduled-send-<campaign id> are both one
// kind each.
export function getAlertType(key) {
	return getAlertKind(key).replace(/-[a-f0-9]{24}$/, "");
}

// What an alert said, kept for the admins: an address shows its first letter and its domain, j…@example.com.
export function maskEmails(text) {
	return String(text ?? "").replace(/([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, "$1…@$2");
}

export function isTelegramAlert({ accountId, key }) {
	return !accountId && ADMIN_ALERTS[getAlertKind(key)] === "telegram";
}

export function isDashboardAlert({ accountId, key }) {
	return !accountId && ADMIN_ALERTS[getAlertKind(key)] === "dashboard";
}
