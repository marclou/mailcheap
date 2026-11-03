import { cleanTag } from "@/lib/contact-fields";
import { CONTACT_SOURCES } from "@/lib/segments";
import { formatDateKey, formatDateKeyRange, readDateKey, shiftDateKey } from "@/lib/time-zone";

// The contacts lists' filters, in their address with the API's names: status, tag, source, and the signup date as
// signedUpSince (that day included) and signedUpBefore (that day left out), YYYY-MM-DD in UTC like the list's dates.
// q searches the addresses.
export const FILTER_PARAMS = ["status", "tag", "source", "signedUpSince", "signedUpBefore"];

// The statuses in the status filter: who gets emails, who may, then who left.
export const LIST_STATUSES = ["active", "pending", "dormant", "unsubscribed", "bounced", "complained"];

export const SIGNUP_MODES = [
	{ value: "before", label: "Before" },
	{ value: "after", label: "After" },
	{ value: "between", label: "Between" },
];

const LONG_DAY = { month: "short", day: "numeric", year: "numeric" };

// The filters an address gives, each null when it's missing or isn't one. statuses: the ones the list knows.
export function readContactFilters(params, statuses) {
	return {
		status: statuses.includes(params.status) ? params.status : null,
		query: typeof params.q === "string" ? params.q.trim().toLowerCase().slice(0, 254) : "",
		tag: typeof params.tag === "string" ? cleanTag(params.tag) : null,
		source: typeof params.source === "string" ? params.source.trim().slice(0, 100) || null : null,
		signedUpSince: readDateKey(params.signedUpSince),
		signedUpBefore: readDateKey(params.signedUpBefore),
	};
}

export function hasContactFilters(filters) {
	return Boolean(filters.query) || FILTER_PARAMS.some((key) => filters[key]);
}

// "?q=jane&status=active" for filters, with what's added, like a page; "" without any.
export function toFilterQuery(filters, added = {}) {
	const entries = [["q", filters.query], ...FILTER_PARAMS.map((key) => [key, filters[key]]), ...Object.entries(added)];
	const params = new URLSearchParams(entries.filter(([, value]) => value).map(([key, value]) => [key, String(value)]));
	return params.size ? `?${params}` : "";
}

// The filters as the contacts queries take them (lib/contacts.js): each signup day as the instant it starts.
export function toListQuery({ signedUpSince, signedUpBefore, ...filters }) {
	return { ...filters, signedUpSince: startOfDayKey(signedUpSince), signedUpBefore: startOfDayKey(signedUpBefore) };
}

function startOfDayKey(key) {
	return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

// A signup date as the list picks it, before a day, after one or between two (both included), as the days it filters by.
export function toSignupDays({ mode, day, endDay }) {
	if (mode === "before") return { signedUpSince: null, signedUpBefore: day };
	if (mode === "after") return { signedUpSince: shiftDateKey(day, 1), signedUpBefore: null };
	return { signedUpSince: day, signedUpBefore: shiftDateKey(endDay, 1) };
}

// The other way, for the filter to show what it picked. null without a day.
export function fromSignupDays({ signedUpSince, signedUpBefore }) {
	if (signedUpSince && signedUpBefore) return { mode: "between", day: signedUpSince, endDay: shiftDateKey(signedUpBefore, -1) };
	if (signedUpSince) return { mode: "after", day: shiftDateKey(signedUpSince, -1), endDay: null };
	if (signedUpBefore) return { mode: "before", day: signedUpBefore, endDay: null };
	return null;
}

// "Before Oct 1, 2026", "After Oct 1, 2026", "Oct 1 – Oct 15, 2026", "Dec 20, 2025 – Jan 5, 2026".
export function describeSignupDays(days) {
	const picked = fromSignupDays(days);
	if (!picked) return null;
	if (picked.mode !== "between") return `${picked.mode === "before" ? "Before" : "After"} ${formatDateKey(picked.day, LONG_DAY)}`;
	return formatDateKeyRange(picked.day, picked.endDay);
}

// "Signup form" for website; a source an API caller gave stays as it is.
export function getSourceLabel(source) {
	return Object.hasOwn(CONTACT_SOURCES, source) ? CONTACT_SOURCES[source].label : source;
}
