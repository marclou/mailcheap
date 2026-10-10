// List cleanup, checked when an issue is sent: contacts who ignored several issues in a row and showed
// no sign of life for months get one last-chance email instead of the issue. Whoever hasn't answered by
// a send at least LAST_CHANCE_DAYS later becomes dormant: never unsubscribed, never deleted.

const DAY_MS = 24 * 60 * 60 * 1000;
export const LAST_CHANCE_DAYS = 14;

// Six ignored issues and six months without a sign of life. A weekly newsletter can go lower on days.
const DEFAULTS = { issues: 6, days: 180 };

export const CLEANUP_LIMITS = { minIssues: 2, maxIssues: 100, minDays: 30, maxDays: 3650 };

// What the send reads from each contact to decide.
export const CLEANUP_FIELDS = [
	"email",
	"ignoredIssues",
	"lastEngagedAt",
	"lastOpenAt",
	"lastClickAt",
	"confirmedAt",
	"subscribedAt",
	"createdAt",
	"lastChanceAt",
];

function positiveInteger(value) {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
}

function toTime(value) {
	const time = value ? new Date(value).getTime() : Number.NaN;
	return Number.isFinite(time) ? time : 0;
}

export function getCleanupDefaults() {
	return DEFAULTS;
}

export function getCleanupSettings(newsletter) {
	const { enabled, issues, days } = newsletter?.cleanup ?? {};
	return {
		enabled: enabled === true,
		issues: positiveInteger(issues) ?? DEFAULTS.issues,
		days: positiveInteger(days) ?? DEFAULTS.days,
	};
}

// Opens, clicks, the "keep sending it" click, the confirmation click and signing up (again). Never
// engaged: the day they joined.
export function getLastSignOfLife(contact) {
	return Math.max(
		toTime(contact.lastEngagedAt),
		toTime(contact.lastOpenAt),
		toTime(contact.lastClickAt),
		toTime(contact.confirmedAt),
		toTime(contact.subscribedAt ?? contact.createdAt)
	);
}

// issue: gets it. lastChance: cold, gets the last-chance email instead. waiting: got that email and
// hasn't answered yet. dormant: didn't answer by a send LAST_CHANCE_DAYS or more after it.
export function getCleanupAction(contact, settings, now = Date.now()) {
	if (!settings?.enabled) return "issue";
	const time = toTime(now);
	const lastSignOfLife = getLastSignOfLife(contact);
	const lastChanceAt = toTime(contact.lastChanceAt);
	if (lastChanceAt && lastChanceAt >= lastSignOfLife) {
		return time - lastChanceAt >= LAST_CHANCE_DAYS * DAY_MS ? "dormant" : "waiting";
	}
	const isCold =
		(contact.ignoredIssues ?? 0) >= settings.issues && time - lastSignOfLife >= settings.days * DAY_MS;
	return isCold ? "lastChance" : "issue";
}

// previous: the kind of message this campaign already sent each contact (an earlier step of a send
// in steps, or an attempt that stopped halfway). Those contacts aren't judged again.
function classify(contact, { settings, previous, now }) {
	const kind = previous?.get(String(contact._id));
	if (kind === "campaign") return "received";
	if (kind) return null;
	return getCleanupAction(contact, settings, now);
}

// One stretch of the audience, most engaged first. The issue stops at the limit, which counts contacts
// who already got it, and so does the walk: cold contacts past it are left for a later step.
export function splitAudience(contacts, { settings, limit, previous, now = Date.now() }) {
	const split = { issue: [], received: 0, lastChance: [], waiting: [], dormant: [] };
	const reach = limit ?? Infinity;
	for (const contact of contacts) {
		if (split.issue.length + split.received >= reach) break;
		const action = classify(contact, { settings, previous, now });
		if (action === "received") split.received += 1;
		else if (action) split[action].push(contact);
	}
	return split;
}

export function emptyPreview() {
	return { issue: 0, lastChance: [], waiting: [], dormant: [] };
}

// For the send dialogs: each skipped contact is stored as the number of issue recipients before it, so
// a send capped at any limit can be counted without walking the list again.
export function addToPreview(preview, contacts, { settings, previous, now = Date.now() }) {
	for (const contact of contacts) {
		const action = classify(contact, { settings, previous, now });
		if (action === "issue" || action === "received") preview.issue += 1;
		else if (action) preview[action].push(preview.issue);
	}
	return preview;
}

export function summarizePreview(preview, limit) {
	const reach = positiveInteger(limit) ?? Infinity;
	const within = (ranks) => ranks.filter((rank) => rank < reach).length;
	return {
		issue: Math.min(preview.issue, reach),
		lastChance: within(preview.lastChance),
		waiting: within(preview.waiting),
		dormant: within(preview.dormant),
	};
}
