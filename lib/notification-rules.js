// What the dashboard's bell shows of each kind of notification (lib/notifications.js), by its tone: "urgent", something
// stopped until its owner looks; "warning", worth a look while the rest carries on; "success", done; "info", nothing to
// do. An account's alerts (lib/alerts.js) are notifications too, of their key's kind (getAlertType):
// tests/notifications.test.mjs fails on one that isn't here.
export const NOTIFICATION_KINDS = {
	"account-blocked": "urgent",
	"blocked-plan-ended": "urgent",
	"campaign-paused": "urgent",
	"content-approved": "urgent",
	"content-rejected": "urgent",
	"domain-dns": "urgent",
	"payment-refunded": "urgent",
	"scheduled-send": "urgent",
	"signup-email-rejected": "urgent",
	"welcome-paused": "urgent",
	"account-signup-flood": "warning",
	"api-signup-flood": "warning",
	complaints: "warning",
	"embed-flood": "warning",
	"embed-flood-plain": "warning",
	"embed-plain-off": "warning",
	"gmail-warning": "warning",
	"rates-warning": "warning",
	"signup-flood": "warning",
	"welcome-cap": "warning",
	"account-unblocked": "success",
	// Only in the tray: nobody is emailed about these.
	"campaign-sent": "success",
	"import-started": "info",
	"import-done": "success",
	"import-stopped": "warning",
	"issue-approved": "success",
	"issue-review": "info",
};

export const NOTIFICATION_TONES = ["urgent", "warning", "success", "info"];

export function getNotificationTone(kind) {
	return NOTIFICATION_KINDS[kind] ?? "info";
}

// Whether a new look at the notifications rings the bell: more unread than before, or an unread one newer than any
// loaded, like an import that said it started, still unread, now saying how it went. Both lists go newest first.
export function hasNewNotifications(loaded, page) {
	const newest = loaded.notifications[0]?.at ?? "";
	return page.unread > loaded.unread || page.notifications.some(({ read, at }) => !read && at > newest);
}

// An alert's lines (what happened, what to do) as one text, each a sentence of its own. A line that starts with an
// address or a domain keeps it as it is.
export function joinSentences(parts) {
	return parts
		.map((part) => String(part ?? "").trim())
		.filter(Boolean)
		.map((part) => {
			const start = /^[a-z]+(?:'[a-z]+)?(?=[\s,;:]|$)/.test(part) ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part;
			return /[.!?:]$/.test(start) ? start : `${start}.`;
		})
		.join(" ");
}

// Only a page of the dashboard: a path of this site, never another one's (//example.com, /\example.com) or a script.
export function cleanNotificationPath(path) {
	const value = String(path ?? "").trim();
	if (!value.startsWith("/") || value.length > 500) return null;
	if (/^\/[/\\]/.test(value) || /[\s\\]/.test(value)) return null;
	return value;
}
