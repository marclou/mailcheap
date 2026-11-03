import "server-only";
import { scoped } from "@/lib/account-scope";
import { getAlertType } from "@/lib/alert-rules";
import { connectDb } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { cleanNotificationPath, getNotificationTone } from "@/lib/notification-rules";
import { getNewsletterPagePath } from "@/lib/newsletters";
import { isObjectIdString } from "@/lib/validation";
import Newsletter from "@/models/Newsletter";
import Notification from "@/models/Notification";

export const NOTIFICATIONS_PAGE_SIZE = 20;
const SORT = { at: -1, _id: -1 };
const MAX_TITLE = 200;
const MAX_BODY = 1000;

// What the API and the tray show of a notification.
export function toNotificationView(notification) {
	return {
		id: String(notification._id),
		kind: notification.kind,
		tone: getNotificationTone(notification.kind),
		title: notification.title,
		body: notification.body || null,
		path: notification.path || null,
		domain: notification.domain || null,
		at: new Date(notification.at).toISOString(),
		read: Boolean(notification.readAt),
	};
}

// Never throws: a notification that can't be saved must not stop what it tells of. The same key again brings it back on
// top, unread, saying what it says now, cleared or not. kind: by default, the kind of an alert's key.
export async function notify({ accountId, key, kind = getAlertType(key), title, body = "", path = "", domain = "", at = new Date() }) {
	if (!isObjectIdString(String(accountId ?? "")) || !key || !title) return;
	const cleanPath = cleanNotificationPath(path);
	const set = {
		kind,
		title: String(title).slice(0, MAX_TITLE),
		body: String(body ?? "").slice(0, MAX_BODY),
		at,
		...(cleanPath && { path: cleanPath }),
		...(domain && { domain: String(domain).slice(0, 253) }),
	};
	const update = { $set: set, $unset: { readAt: 1, clearedAt: 1, ...(!cleanPath && { path: 1 }), ...(!domain && { domain: 1 }) } };
	const save = () => Notification.updateOne(scoped(accountId, { key: String(key).slice(0, 200) }), update, { upsert: true });
	try {
		await connectDb();
		// Two at once for a new key: one inserts, the other finds it on its second try.
		await save().catch((error) => (error?.code === 11000 ? save() : Promise.reject(error)));
	} catch (error) {
		// Without the message: a database error can quote what the notification says.
		console.error(`[notifications] Could not save ${getAlertType(key)}: ${error?.code ?? error?.name ?? "error"}`);
	}
}

export function countUnreadNotifications(account) {
	return Notification.countDocuments(scoped(account, { readAt: null, clearedAt: null }));
}

// Newest first. filter: where the page starts (lib/actions/shared.js afterCursor on "at").
export async function listNotifications(account, { limit = NOTIFICATIONS_PAGE_SIZE, filter = {} } = {}) {
	await connectDb();
	const [found, unread] = await Promise.all([
		Notification.find(scoped(account, { ...filter, clearedAt: null })).sort(SORT).limit(limit + 1).lean(),
		countUnreadNotifications(account),
	]);
	return { notifications: found.slice(0, limit).map(toNotificationView), unread, hasMore: found.length > limit };
}

// ids: the ones the tray showed, or every unread one without them. Another account's ids match nothing.
export async function markNotificationsRead(account, { ids = null } = {}) {
	await connectDb();
	const only = ids ? { _id: { $in: ids.filter(isObjectIdString) } } : {};
	const { modifiedCount } = await Notification.updateMany(scoped(account, { readAt: null, clearedAt: null, ...only }), {
		$set: { readAt: new Date() },
	});
	return { marked: modifiedCount, unread: await countUnreadNotifications(account) };
}

// ids: the ones to clear, or every one without them. until: only those that last happened by then, so one that came in
// or came back on top since stays. Cleared ones are kept, out of sight, until they happen again or expire.
export async function clearNotifications(account, { ids = null, until = null } = {}) {
	await connectDb();
	const filter = { clearedAt: null, ...(ids && { _id: { $in: ids.filter(isObjectIdString) } }), ...(until && { at: { $lte: until } }) };
	const { modifiedCount } = await Notification.updateMany(scoped(account, filter), { $set: { clearedAt: new Date() } });
	return { cleared: modifiedCount, unread: await countUnreadNotifications(account) };
}

// Every import, from the dashboard or the API (lib/import-jobs.js), is one notification on the Contacts page of the
// newsletter it goes to: it says the import started, then how it went once it's done or stopped, back on top, unread.
export async function notifyImportStarted(contactImport) {
	const { accountId, _id, newsletterId, fileName, total } = contactImport;
	const newsletterName = await findNewsletterName(accountId, newsletterId);
	await notify({
		accountId,
		key: `import:${_id}`,
		kind: "import-started",
		title: `Importing ${fileName || "contacts"}`,
		body: into(total > 0 && `${formatNumber(total)} ${total === 1 ? "row" : "rows"}`, newsletterName),
		path: getNewsletterPagePath(newsletterId, "/contacts"),
	});
}

export async function notifyImportEnded(contactImport) {
	const { accountId, _id, newsletterId, status, fileName } = contactImport;
	if (status !== "done" && status !== "failed") return;
	const newsletterName = await findNewsletterName(accountId, newsletterId);
	const created = contactImport.created ?? 0;
	const existing = contactImport.existing ?? 0;
	const leftOut = Object.values(contactImport.dropped ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
	const path = getNewsletterPagePath(newsletterId, "/contacts");
	if (status === "failed") {
		await notify({
			accountId,
			key: `import:${_id}`,
			kind: "import-stopped",
			title: `Import of ${fileName || "contacts"} stopped`,
			body: [
				`${String(contactImport.error ?? "It stopped before the end of the file").replace(/\.$/, "")}.`,
				created > 0 && `${formatNumber(created)} added before it stopped.`,
				"Import the file again for the rest: the contacts already in stay as they are.",
			]
				.filter(Boolean)
				.join(" "),
			path,
		});
		return;
	}
	await notify({
		accountId,
		key: `import:${_id}`,
		kind: "import-done",
		title: `Imported ${formatNumber(created)} new ${created === 1 ? "contact" : "contacts"}`,
		body: [
			into(fileName, newsletterName),
			existing > 0 && `${formatNumber(existing)} already there`,
			leftOut > 0 && `${formatNumber(leftOut)} left out`,
		]
			.filter(Boolean)
			.join(" · "),
		path,
	});
}

// Null when it can't be read: the notification goes without it rather than not at all.
async function findNewsletterName(accountId, newsletterId) {
	try {
		await connectDb();
		const newsletter = await Newsletter.findOne(scoped(accountId, { _id: newsletterId })).select({ name: 1 }).lean();
		return newsletter?.name ?? null;
	} catch {
		return null;
	}
}

// "readers.csv into Weekly notes", or "Into Weekly notes" without what went in.
function into(what, newsletterName) {
	if (!newsletterName) return what || "";
	return what ? `${what} into ${newsletterName}` : `Into ${newsletterName}`;
}

// An issue's emails all went out (lib/sending.js settleCampaign): its report fills in from there.
export async function notifyCampaignSent({ accountId, _id, subject, stats }) {
	const sent = stats?.sent ?? 0;
	await notify({
		accountId,
		key: `campaign-sent:${_id}`,
		kind: "campaign-sent",
		title: "Campaign sent",
		body: `${quote(subject, "Your issue")} went out to ${formatNumber(sent)} ${sent === 1 ? "contact" : "contacts"}.`,
		path: `/campaigns/${_id}`,
	});
}

// The content check holds an issue for a person (lib/content-review.js), then they let it go
// (lib/content-review-decisions.js): one notification, brought back on top by the decision. Never the check's reasons.
export async function notifyIssueReview({ accountId, _id, subject }, { isApproved = false } = {}) {
	await notify({
		accountId,
		key: `issue-review:${_id}`,
		kind: isApproved ? "issue-approved" : "issue-review",
		title: isApproved ? "Issue approved" : "Issue under review",
		body: isApproved
			? `${quote(subject, "Your issue")} passed its review and is on its way.`
			: `A person checks ${quote(subject, "your issue")} before it goes out, usually within a few hours.`,
		path: `/campaigns/${_id}`,
	});
}

// An issue by its subject, or in words when it has none yet.
function quote(subject, fallback) {
	return subject?.trim() ? `“${subject.trim()}”` : fallback;
}
