import { cleanTag } from "./contact-fields.js";

// A segment picks some of a newsletter's contacts with a few conditions, kept as written and compiled here into one
// MongoDB filter on contacts. Sending, counts, the contacts list, its export, the API and MCP all use compileSegment,
// so a segment picks the same contacts everywhere. No database code: the dashboard's segment editor reads the fields.
// Conditions on the account's own fields name them fields.<key>; checking those needs the account's fields.

const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTOM_FIELD_PATTERN = /^fields\.[a-z][a-z0-9_]{0,29}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const SEGMENT_MATCHES = ["all", "any"];
export const SEGMENT_DELETED = "Its segment was deleted: pick who gets it";
export const MAX_SEGMENT_CONDITIONS = 10;
export const MAX_SEGMENT_NAME = 60;

const VALUES = {
	days: { max: 3650, problem: "a whole number of days, 1 to 3,650" },
	count: { max: 100_000, problem: "a whole number, 1 to 100,000" },
	date: { problem: "a date, YYYY-MM-DD" },
	source: { max: 100, problem: "a source, 100 characters at most" },
	text: { max: 254, problem: "some text, 254 characters at most" },
	tag: { problem: "a tag, 40 characters at most, without commas" },
	number: { problem: "a number" },
};

// Each field's ops, in the order the editor offers them. A date field's ops count days back from the moment the segment
// is used, so "in the last 30 days" moves with time. A contact without the date never did it: missing values count as
// "never" and as 0.
export const SEGMENT_FIELDS = {
	opened: {
		label: "Opened",
		path: "lastOpenAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "not in the last", value: "days", unit: "days" },
			never: { label: "never" },
		},
	},
	clicked: {
		label: "Clicked",
		path: "lastClickAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "not in the last", value: "days", unit: "days" },
			never: { label: "never" },
		},
	},
	missed_issues: {
		label: "Missed",
		path: "ignoredIssues",
		ops: {
			at_least: { label: "at least", value: "count", unit: "issues in a row" },
			less_than: { label: "fewer than", value: "count", unit: "issues in a row" },
		},
	},
	emails_opened: {
		label: "Emails opened",
		path: "stats.opens",
		ops: {
			at_least: { label: "at least", value: "count" },
			less_than: { label: "fewer than", value: "count" },
		},
	},
	signed_up: {
		label: "Signed up",
		path: "subscribedAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "more than", value: "days", unit: "days ago" },
			before: { label: "before", value: "date" },
			since: { label: "since", value: "date" },
		},
	},
	source: {
		label: "Source",
		path: "source",
		ops: {
			is: { label: "is", value: "source" },
			is_not: { label: "isn't", value: "source" },
		},
	},
	email: {
		label: "Email",
		path: "email",
		ops: {
			contains: { label: "contains", value: "text" },
			ends_with: { label: "ends with", value: "text" },
		},
	},
	tag: {
		label: "Tag",
		path: "tags",
		ops: {
			has: { label: "is", value: "tag" },
			has_not: { label: "isn't", value: "tag" },
		},
	},
	first_name: {
		label: "First name",
		path: "firstName",
		ops: {
			is_set: { label: "is known" },
			not_set: { label: "is unknown" },
		},
	},
};

// The ops of the account's own fields, by type. Text compares without case; a contact without a value meets only "isn't
// set".
export const CUSTOM_FIELD_OPS = {
	text: {
		is: { label: "is", value: "text" },
		contains: { label: "contains", value: "text" },
		is_set: { label: "is set" },
		not_set: { label: "isn't set" },
	},
	number: {
		at_least: { label: "at least", value: "number" },
		less_than: { label: "less than", value: "number" },
		is_set: { label: "is set" },
		not_set: { label: "isn't set" },
	},
	date: {
		before: { label: "before", value: "date" },
		since: { label: "since", value: "date" },
		is_set: { label: "is set" },
		not_set: { label: "isn't set" },
	},
};

export const SEGMENT_FIELD_NAMES = Object.keys(SEGMENT_FIELDS);
export const SEGMENT_OPS = [
	...new Set([...Object.values(SEGMENT_FIELDS), ...Object.values(CUSTOM_FIELD_OPS).map((ops) => ({ ops }))].flatMap(({ ops }) => Object.keys(ops))),
];

// A built-in field's name, or fields.<key> for one of the account's own.
export function isSegmentFieldName(name) {
	return Object.hasOwn(SEGMENT_FIELDS, name) || CUSTOM_FIELD_PATTERN.test(String(name ?? ""));
}

function isCustomField(name) {
	return CUSTOM_FIELD_PATTERN.test(String(name ?? ""));
}

// What the editor and the checks know of a field: its label, path and ops. fields: the account's own (Account.
// contactFields). null for a name that's neither.
export function getSegmentField(name, fields = []) {
	if (Object.hasOwn(SEGMENT_FIELDS, name)) return SEGMENT_FIELDS[name];
	if (!isCustomField(name)) return null;
	const definition = fields.find(({ key }) => `fields.${key}` === name);
	return definition ? { label: definition.label, path: name, ops: CUSTOM_FIELD_OPS[definition.type], type: definition.type } : null;
}

// The sources MailCheap sets itself (Contact.source). An API caller's own source, like "podcast", shows as written.
export const CONTACT_SOURCES = {
	website: { label: "Signup form", phrase: "the signup form" },
	embed: { label: "Form on your site", phrase: "the form on your site" },
	import: { label: "Import", phrase: "an import" },
	dashboard: { label: "Added by hand", phrase: "the dashboard" },
	api: { label: "API", phrase: "the API" },
};

// Starting points in the segment editor.
export const SEGMENT_PRESETS = [
	{ name: "Engaged", match: "all", conditions: [{ field: "opened", op: "within", value: 30 }] },
	{ name: "New", match: "all", conditions: [{ field: "signed_up", op: "within", value: 30 }] },
	{ name: "Inactive", match: "all", conditions: [{ field: "missed_issues", op: "at_least", value: 5 }] },
	{
		name: "Never opened",
		match: "all",
		conditions: [
			{ field: "opened", op: "never" },
			{ field: "signed_up", op: "not_within", value: 30 },
		],
	},
];

function readValue(type, value) {
	if (type === "days" || type === "count") {
		const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
		return Number.isInteger(number) && number >= 1 && number <= VALUES[type].max ? number : null;
	}
	if (type === "number") {
		const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
		return typeof number === "number" && Number.isFinite(number) ? number : null;
	}
	if (typeof value !== "string") return null;
	if (type === "tag") return cleanTag(value);
	if (type === "date") {
		const text = value.trim();
		const date = DATE_PATTERN.test(text) ? startOfDay(text) : null;
		return date && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text) ? text : null;
	}
	const text = type === "text" ? value.trim().toLowerCase() : value.trim();
	return text && text.length <= VALUES[type].max ? text : null;
}

// The rules as stored, or what's wrong with them, for people (the editor) and agents (the API) alike. fields: the
// account's own, which conditions on fields.<key> need.
export function checkSegmentRules({ match = "all", conditions } = {}, { fields = [] } = {}) {
	if (!SEGMENT_MATCHES.includes(match)) return { problem: "match must be all or any" };
	if (!Array.isArray(conditions) || conditions.length === 0) return { problem: "Add a condition" };
	if (conditions.length > MAX_SEGMENT_CONDITIONS) return { problem: `${MAX_SEGMENT_CONDITIONS} conditions at most` };
	const checked = [];
	for (const [index, condition] of conditions.entries()) {
		const where = conditions.length > 1 ? `Condition ${index + 1}: ` : "";
		const field = getSegmentField(condition?.field, fields);
		if (!field && isCustomField(condition?.field)) return { problem: `${where}${condition.field}: the account has no such field` };
		if (!field) return { problem: `${where}field must be one of ${SEGMENT_FIELD_NAMES.join(", ")}, or fields.<key> for a field of the account` };
		const op = Object.hasOwn(field.ops, String(condition.op)) ? field.ops[condition.op] : null;
		if (!op) return { problem: `${where}${condition.field} takes ${Object.keys(field.ops).join(", ")}` };
		if (!op.value) {
			checked.push({ field: condition.field, op: condition.op });
			continue;
		}
		const value = readValue(op.value, condition.value);
		if (value === null) return { problem: `${where}${condition.field} ${condition.op} needs ${VALUES[op.value].problem}` };
		checked.push({ field: condition.field, op: condition.op, value });
	}
	return { rules: { match, conditions: checked } };
}

// One filter on contacts for checked rules, the dates counted back from now. It goes inside $and next to the account,
// newsletter and status, so it can't widen a query. Mongoose casts its values, so it's for Contact queries only.
export function compileSegment({ match, conditions }, { now = new Date() } = {}) {
	const filters = conditions.map((condition) => compileCondition(condition, now));
	if (filters.length === 1) return filters[0];
	return { [match === "any" ? "$or" : "$and"]: filters };
}

function compileCondition({ field, op, value }, now) {
	if (isCustomField(field)) return compileCustomCondition({ path: field, op, value });
	const { path } = SEGMENT_FIELDS[field];
	switch (op) {
		case "within":
			return { [path]: { $gte: daysBefore(now, value) } };
		// Not opened lately includes never opened; a signup date is always there.
		case "not_within":
			return field === "signed_up" ? { [path]: { $lt: daysBefore(now, value) } } : { [path]: { $not: { $gte: daysBefore(now, value) } } };
		case "never":
			return { [path]: null };
		case "at_least":
			return { [path]: { $gte: value } };
		case "less_than":
			return { [path]: { $not: { $gte: value } } };
		case "before":
			return { [path]: { $lt: startOfDay(value) } };
		case "since":
			return { [path]: { $gte: startOfDay(value) } };
		case "is":
			return { [path]: value };
		case "is_not":
			return { [path]: { $ne: value } };
		case "contains":
			return { [path]: { $regex: escapeRegex(value) } };
		case "ends_with":
			return { [path]: { $regex: `${escapeRegex(value)}$` } };
		// A tag in the contact's list, or not in it (a contact without tags too).
		case "has":
			return { [path]: value };
		case "has_not":
			return { [path]: { $ne: value } };
		// null also matches a contact without the property.
		case "is_set":
			return { [path]: { $nin: [null, ""] } };
		case "not_set":
			return { [path]: { $in: [null, ""] } };
		default:
			throw new Error(`Unknown segment op ${op}`);
	}
}

// A field of the account: text without case, and a contact without a value never meets a comparison.
function compileCustomCondition({ path, op, value }) {
	switch (op) {
		case "is":
			return { [path]: { $regex: `^${escapeRegex(value)}$`, $options: "i" } };
		case "contains":
			return { [path]: { $regex: escapeRegex(value), $options: "i" } };
		case "at_least":
			return { [path]: { $gte: value } };
		case "less_than":
			return { [path]: { $lt: value } };
		case "before":
			return { [path]: { $lt: startOfDay(value) } };
		case "since":
			return { [path]: { $gte: startOfDay(value) } };
		case "is_set":
			return { [path]: { $nin: [null, ""] } };
		case "not_set":
			return { [path]: { $in: [null, ""] } };
		default:
			throw new Error(`Unknown segment op ${op}`);
	}
}

const DESCRIPTIONS = {
	opened: {
		within: (value) => `Opened in the last ${plural(value, "day")}`,
		not_within: (value) => `Not opened in the last ${plural(value, "day")}`,
		never: () => "Never opened",
	},
	clicked: {
		within: (value) => `Clicked in the last ${plural(value, "day")}`,
		not_within: (value) => `Not clicked in the last ${plural(value, "day")}`,
		never: () => "Never clicked",
	},
	missed_issues: {
		at_least: (value) => `Missed at least ${plural(value, "issue")} in a row`,
		less_than: (value) => `Missed fewer than ${plural(value, "issue")} in a row`,
	},
	emails_opened: {
		at_least: (value) => `Opened at least ${plural(value, "email")}`,
		less_than: (value) => `Opened fewer than ${plural(value, "email")}`,
	},
	signed_up: {
		within: (value) => `Signed up in the last ${plural(value, "day")}`,
		not_within: (value) => `Signed up more than ${plural(value, "day")} ago`,
		before: (value) => `Signed up before ${formatDay(value)}`,
		since: (value) => `Signed up since ${formatDay(value)}`,
	},
	source: {
		is: (value) => `Came from ${describeSource(value)}`,
		is_not: (value) => `Didn't come from ${describeSource(value)}`,
	},
	email: {
		contains: (value) => `Email contains "${value}"`,
		ends_with: (value) => `Email ends with "${value}"`,
	},
	tag: {
		has: (value) => `Tagged "${value}"`,
		has_not: (value) => `Not tagged "${value}"`,
	},
	first_name: {
		is_set: () => "First name known",
		not_set: () => "First name unknown",
	},
};

const CUSTOM_DESCRIPTIONS = {
	is: (label, value) => `${label} is "${value}"`,
	contains: (label, value) => `${label} contains "${value}"`,
	at_least: (label, value) => `${label} at least ${value.toLocaleString("en-US")}`,
	less_than: (label, value) => `${label} less than ${value.toLocaleString("en-US")}`,
	before: (label, value) => `${label} before ${formatDay(value)}`,
	since: (label, value) => `${label} since ${formatDay(value)}`,
	is_set: (label) => `${label} set`,
	not_set: (label) => `${label} not set`,
};

// For checked conditions: "Opened in the last 30 days". fields: the account's own, for their names.
export function describeCondition({ field, op, value }, fields = []) {
	if (isCustomField(field)) {
		const label = fields.find(({ key }) => `fields.${key}` === field)?.label ?? field.slice("fields.".length);
		return CUSTOM_DESCRIPTIONS[op]?.(label, value) ?? "";
	}
	return DESCRIPTIONS[field]?.[op]?.(value) ?? "";
}

// The rules in one sentence: "Opened in the last 30 days and signed up since Oct 1, 2026".
export function describeSegment({ match, conditions }, fields = []) {
	const parts = conditions.map((condition) => describeCondition(condition, fields));
	if (parts.length === 0) return "";
	const joined = parts.map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)));
	if (joined.length === 1) return joined[0];
	return `${joined.slice(0, -1).join(", ")} ${match === "any" ? "or" : "and"} ${joined.at(-1)}`;
}

function plural(count, noun) {
	return `${count.toLocaleString("en-US")} ${count === 1 ? noun : `${noun}s`}`;
}

function describeSource(value) {
	return CONTACT_SOURCES[value]?.phrase ?? `"${value}"`;
}

function daysBefore(now, days) {
	return new Date(now.getTime() - days * DAY_MS);
}

function startOfDay(date) {
	return new Date(`${date}T00:00:00.000Z`);
}

function formatDay(date) {
	return DATE_FORMAT.format(startOfDay(date));
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
