"use server";

import { runAccountAction, toFormError } from "@/lib/actions/dashboard";

// The bell in the sidebar and the phone's top bar (components/ProviderNotifications.jsx), on every dashboard page, so in
// a route group of its own: a page of notifications, then the older ones from cursor. They're the user's own account's,
// whichever newsletter is open.
export async function getNotifications(cursor) {
	const { output, failure } = await runAccountAction("list_notifications", cursor ? { cursor: String(cursor) } : {});
	if (failure) return toFormError(failure);
	return output;
}

// The ones the tray showed, once it opens.
export async function markNotificationsRead(ids) {
	const { output, failure } = await runAccountAction("mark_notifications_read", {
		ids: Array.isArray(ids) ? ids.slice(0, 100).map(String) : [],
	});
	if (failure) return toFormError(failure);
	return output;
}

// Clear all: the newest the tray showed and every older one. What came in since stays.
export async function clearNotifications(until) {
	const { output, failure } = await runAccountAction("clear_notifications", until ? { until: String(until) } : {});
	if (failure) return toFormError(failure);
	return output;
}
