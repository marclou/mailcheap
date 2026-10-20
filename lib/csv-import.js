import {
	checkFieldDefinition,
	cleanFirstName,
	cleanTags,
	fieldKeyFromLabel,
	formatFieldValue,
	parseTagList,
	readFieldValue,
} from "./contact-fields.js";
import { normalizeAddress } from "./validation.js";

// Headers are compared without case, spaces or punctuation. Besides common names, these read the exports of
// Beehiiv, Substack, Mailchimp, Kit, MailerLite, Buttondown, Ghost and EmailOctopus as they are.
const COLUMN_ALIASES = {
	email: ["email", "emailaddress", "subscriberemail", "subscriber"],
	// Buttondown: subscriber_type.
	status: ["status", "subscriptionstatus", "subscriberstatus", "subscribertype"],
	subscribedAt: [
		"createdat",
		"created",
		"subscribedat",
		"subscribedate",
		"subscriptiondate",
		"datesubscribed",
		"signupdate",
		// Substack's subscribers page, Buttondown, Mailchimp.
		"startdate",
		"creationdate",
		"optintime",
		"confirmtime",
	],
	// beehiiv: total_delivered.
	emailsReceived: ["emailsreceived", "totalemailsreceived", "received", "totaldelivered"],
	openRate: ["openrate", "uniqueopenrate", "totalopenrate"],
	clickRate: ["clickrate", "clickthroughrate", "uniqueclickrate", "ctr"],
	// Engagement on the previous platform, so segments on opens and clicks work from the first day: beehiiv's
	// last_opened_at, last_clicked_at, total_unique_opened and total_unique_clicked.
	lastOpenAt: ["lastopenedat", "lastopenat", "lastopened", "lastopendate"],
	lastClickAt: ["lastclickedat", "lastclickat", "lastclicked", "lastclickdate"],
	opens: ["totaluniqueopened", "uniqueopens", "emailsopened"],
	clicks: ["totaluniqueclicked", "uniqueclicks", "emailsclicked"],
	// Columns some platforms use instead of a status. A date here means the person left: Beehiiv's
	// unsubscribed_at, the UNSUB_TIME of Mailchimp's unsubscribed file, Buttondown's unsubscription_date.
	unsubscribedAt: ["unsubscribedat", "unsubtime", "unsubscriptiondate", "canceledat", "cancelledat"],
	// Mailchimp's cleaned file: addresses that bounced.
	cleanedAt: ["cleantime"],
	// Ghost: false for members who get no newsletter.
	subscribedToEmails: ["subscribedtoemails"],
	// Substack: true for readers whose emails are off.
	emailDisabled: ["emaildisabled"],
};

// Columns the import offers to read into the contact's profile: a first name (Mailchimp's First Name, Kit and beehiiv's
// first_name), a whole name it takes the first word of (Ghost, MailerLite, Substack), and tags (Mailchimp's TAGS, Kit,
// beehiiv, MailerLite's groups).
const PROFILE_ALIASES = {
	firstName: ["firstname", "fname", "givenname", "first"],
	fullName: ["name", "fullname", "subscribername", "displayname", "contactname"],
	tags: ["tags", "tag", "labels", "groups"],
};

const STATUS_ALIASES = {
	active: "active",
	subscribed: "active",
	// Kit: cold readers are confirmed ones who stopped opening.
	confirmed: "active",
	cold: "active",
	// Buttondown's types for readers who get emails, paying or not.
	regular: "active",
	premium: "active",
	gifted: "active",
	trialed: "active",
	churning: "active",
	churned: "active",
	pastdue: "active",
	inactive: "unsubscribed",
	unsubscribed: "unsubscribed",
	cancelled: "unsubscribed",
	canceled: "unsubscribed",
	// Taken off the list by the writer (Buttondown, Kit).
	removed: "unsubscribed",
	blocked: "unsubscribed",
	bounced: "bounced",
	invalid: "bounced",
	hardbounce: "bounced",
	cleaned: "bounced",
	undeliverable: "bounced",
	complained: "complained",
	spam: "complained",
	spamreport: "complained",
	junk: "complained",
	pending: "dormant",
	unconfirmed: "dormant",
	unactivated: "dormant",
	validating: "dormant",
	needsattention: "dormant",
	dormant: "dormant",
};

// An import can only move a contact to a stricter status, never back to active.
export const STATUS_RANK = { active: 0, dormant: 1, unsubscribed: 2, bounced: 3, complained: 4 };

export const MAX_IMPORT_ROWS_PER_REQUEST = 1000;
export const MAX_IMPORT_ROWS = 250_000;
// Well under the 1 MB a server action takes, counted loosely (characters, not bytes).
const MAX_CHUNK_SIZE = 600_000;

// The requests a file's rows go in: 1,000 rows at most each, fewer when rows carry many fields.
export function splitImportChunks(rows, { maxRows = MAX_IMPORT_ROWS_PER_REQUEST, maxSize = MAX_CHUNK_SIZE } = {}) {
	const chunks = [];
	let current = [];
	let size = 0;
	for (const row of rows) {
		const rowSize = JSON.stringify(row).length + 1;
		if (current.length > 0 && (current.length >= maxRows || size + rowSize > maxSize)) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(row);
		size += rowSize;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

function normalizeKey(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

export function mapColumns(headers) {
	const normalized = headers.map((header) => [header, normalizeKey(header)]);
	return Object.fromEntries(
		Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
			field,
			normalized.find(([, key]) => aliases.includes(key))?.[0] ?? null,
		])
	);
}

// What the import reads each header as (a field of COLUMN_ALIASES), or null for a column it skips.
export function getColumnFields(headers) {
	const mapped = Object.entries(mapColumns(headers));
	return headers.map((column) => ({ column, field: mapped.find(([, header]) => header === column)?.[0] ?? null }));
}

// The columns left after the ones the import reads on its own, each with what it goes into by default: "first_name",
// "tags", "field:<key>" for an account field of that name or key, "new:<type>" for a column of the writer's own data
// (a platform's custom fields), or "skip". fields: the account's own. rows: the file's, for the values of a new field;
// without them nothing becomes a new field. New fields only fill the room the account has left, in column order.
export function suggestProfileColumns(headers, fields = [], rows = []) {
	const used = new Set(Object.values(mapColumns(headers)).filter(Boolean));
	const newFields = [];
	let hasName = false;
	let hasTags = false;
	return headers
		.filter((column) => column && !used.has(column))
		.map((column) => {
			const key = normalizeKey(column);
			const field = fields.find((item) => normalizeKey(item.key) === key || normalizeKey(item.label) === key);
			if (field) return { column, target: `field:${field.key}` };
			if (PROFILE_ALIASES.firstName.includes(key) || PROFILE_ALIASES.fullName.includes(key)) {
				if (hasName) return { column, target: "skip" };
				hasName = true;
				return { column, target: "first_name" };
			}
			if (PROFILE_ALIASES.tags.includes(key)) {
				if (hasTags) return { column, target: "skip" };
				hasTags = true;
				return { column, target: "tags" };
			}
			const values = rows.map((row) => row?.[column]);
			if (isPlatformColumn(column) || !values.some((value) => String(value ?? "").trim())) return { column, target: "skip" };
			const type = guessFieldType(values);
			if (checkFieldDefinition({ label: column, type }, [...fields, ...newFields]).problem) return { column, target: "skip" };
			newFields.push({ key: fieldKeyFromLabel(column) });
			return { column, target: `new:${type}` };
		});
}

// Columns the platforms add on their own rather than the writer's custom fields: ids, plans and payments, where readers
// came from, what the platform counted, network and location details, timestamps, notes and raw data. They stay on
// Skip until picked. Headers are compared like the others (normalizeKey); the endings are read on the header itself.
const PLATFORM_COLUMNS = new Set([
	...Object.values(COLUMN_ALIASES).flat(),
	"id",
	"uuid",
	"leid",
	"euid",
	"tier",
	"tiers",
	"freetier",
	"subscriptiontier",
	"subscriptionpremiumtiernames",
	"plan",
	"complimentaryplan",
	"activesubscription",
	"expiry",
	"memberrating",
	"activity",
	"lastchanged",
	"latitude",
	"longitude",
	"gmtoff",
	"dstoff",
	"timezone",
	"cc",
	"region",
	"subscribercountry",
	"devicetype",
	"acquisitionterm",
	"acquisitioncontent",
	"notes",
	"note",
	"metadata",
]);
const PLATFORM_KEY_PARTS = /^(utm|unsub|clean|optin|confirm|total)|referr|stripe|customerid|source|opened|opens|clicked|clicks|ipaddress/;
const PLATFORM_ENDINGS = /(^|[\s_-])(id|ip|at|time)$/;
// Where readers came from, which writers moving their list want to keep: beehiiv's acquisition columns and the utm
// ones other exports use. They default to new fields, like custom fields.
const ACQUISITION_COLUMNS = new Set([
	"acquisitionsource",
	"utmsource",
	"channel",
	"utmmedium",
	"campaign",
	"utmcampaign",
	"referringurl",
	"referringsite",
	"referrerurl",
]);

export function isPlatformColumn(column) {
	const key = normalizeKey(column);
	if (ACQUISITION_COLUMNS.has(key)) return false;
	return PLATFORM_COLUMNS.has(key) || PLATFORM_KEY_PARTS.test(key) || PLATFORM_ENDINGS.test(String(column).trim().toLowerCase());
}

// A new field's name from its column: beehiiv's acquisition_source reads "Acquisition source" and campaign "Campaign";
// a column with its own capitals, like "First Name", stays as it is. The field's key is the same either way
// (fieldKeyFromLabel).
export function labelFromColumn(column) {
	const text = String(column ?? "").trim();
	if (/[A-Z]/.test(text) && /[a-z]/.test(text)) return text;
	const words = text.replace(/_+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

// Whether a column of suggestProfileColumns can go into a new field. The other columns already going into new fields
// count with the account's own: toward the fields limit, and so two columns don't make the same field.
export function canBeNewField(item, columns, fields = []) {
	if (item.target.startsWith("new:")) return true;
	const pending = columns
		.filter(({ column, target }) => column !== item.column && target.startsWith("new:"))
		.map(({ column }) => ({ key: fieldKeyFromLabel(column) }));
	return !checkFieldDefinition({ label: item.column, type: item.newType }, [...fields, ...pending]).problem;
}

// Every column of a file and where its values go, for the dialog: target is a field of COLUMN_ALIASES ("email",
// "status", "subscribedAt"…), "first_name", "tags", "field:<key>", "new:<type>" or "skip". auto: recognized on its own,
// so it only needs a look if the writer wants. samples: a few of its values; newType: the type a new field would take.
export function planColumns(headers, fields = [], rows = []) {
	const systemByColumn = new Map(
		Object.entries(mapColumns(headers))
			.filter(([, column]) => column)
			.map(([field, column]) => [column, field])
	);
	const suggestions = new Map(suggestProfileColumns(headers, fields, rows).map(({ column, target }) => [column, target]));
	return [...new Set(headers.filter(Boolean))].map((column) => {
		const values = rows.map((row) => row?.[column]);
		const base = { column, samples: sampleValues(values), newType: guessFieldType(values) };
		if (systemByColumn.has(column)) return { ...base, target: systemByColumn.get(column), auto: true };
		const target = suggestions.get(column) ?? "skip";
		return { ...base, target, auto: target === "first_name" || target === "tags" || target.startsWith("field:") };
	});
}

// A column's first different values, short, for the dialog to show what's in it.
export function sampleValues(values, count = 3) {
	const samples = [];
	for (const value of values) {
		const text = String(value ?? "").trim();
		if (!text || samples.includes(text.slice(0, 40))) continue;
		samples.push(text.slice(0, 40));
		if (samples.length === count) break;
	}
	return samples;
}

// Targets only one column can have: picking one for a column takes it from the column that had it.
export function isSingleTarget(target) {
	return Object.hasOwn(COLUMN_ALIASES, target) || target === "first_name" || target === "tags" || target.startsWith("field:");
}

export function assignColumnTarget(plan, column, target) {
	return plan.map((item) => {
		if (item.column === column) return { ...item, target };
		return isSingleTarget(target) && item.target === target ? { ...item, target: "skip" } : item;
	});
}

// What normalizeImportRow reads from a plan: the columns of COLUMN_ALIASES, and the profile columns (first name, tags,
// fields: [{ column, key, type }]). A new field takes its column's name.
export function readColumnPlan(plan, fields = []) {
	const columnFor = (target) => plan.find((item) => item.target === target)?.column ?? null;
	const columns = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((field) => [field, columnFor(field)]));
	const profile = {
		firstName: columnFor("first_name") ?? undefined,
		tags: columnFor("tags") ?? undefined,
		fields: plan.flatMap(({ column, target }) => {
			if (target.startsWith("new:")) return [{ column, key: fieldKeyFromLabel(column), type: target.slice("new:".length) }];
			const field = target.startsWith("field:") && fields.find(({ key }) => key === target.slice("field:".length));
			return field ? [{ column, key: field.key, type: field.type }] : [];
		}),
	};
	return { columns, profile };
}

const TARGET_LABELS = {
	email: "Email",
	status: "Status",
	subscribedAt: "Signup date",
	unsubscribedAt: "Status, from the date they left",
	cleanedAt: "Status, from the date it bounced",
	subscribedToEmails: "Status, from whether they get emails",
	emailDisabled: "Status, from whether emails are off",
	emailsReceived: "Emails received",
	openRate: "Open rate",
	clickRate: "Click rate",
	lastOpenAt: "Last opened",
	lastClickAt: "Last clicked",
	opens: "Emails opened",
	clicks: "Emails clicked",
	first_name: "First name",
	tags: "Tags, split by comma",
	skip: "Don't import",
};

// A target in plain words: "Signup date", "Field: Company", "New field: Company (text)".
export function describeColumnTarget(target, { column, fields = [], newType } = {}) {
	if (TARGET_LABELS[target]) return TARGET_LABELS[target];
	if (target.startsWith("field:")) {
		const key = target.slice("field:".length);
		return `Field: ${fields.find((field) => field.key === key)?.label ?? key}`;
	}
	if (target.startsWith("new:")) return `New field: ${labelFromColumn(column)} (${target.slice("new:".length) || newType})`;
	return target;
}

// The targets the dialog offers a column besides fields: the contact's own, plus what the file's platform recorded
// when the import recognized the column as one of those.
export const CONTACT_TARGETS = ["email", "first_name", "status", "subscribedAt", "tags"];

export function getColumnTargetOptions(item) {
	const recognized = item.auto && Object.hasOwn(COLUMN_ALIASES, item.target) && !CONTACT_TARGETS.includes(item.target) ? [item.target] : [];
	return { contact: CONTACT_TARGETS, recognized };
}

// A whole name ("Jane Doe") gives its first word; a first name column is taken as it is.
export function isFullNameColumn(column) {
	return PROFILE_ALIASES.fullName.includes(normalizeKey(column));
}

// What a column's values look like, for a new field made from it: numbers, dates, or text.
export function guessFieldType(values) {
	const samples = values.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 50);
	if (samples.length === 0) return "text";
	if (samples.every((value) => readFieldValue("number", value).value !== undefined && /^-?[\d,.]+$/.test(value))) return "number";
	if (samples.every((value) => /\d{4}-\d{2}-\d{2}/.test(value) && readFieldValue("date", value).value)) return "date";
	return "text";
}

// The same syntax as every other address in MailCheap (lib/validation.js).
export function normalizeEmail(value) {
	return normalizeAddress(String(value ?? ""));
}

export function normalizeStatus(value) {
	if (value === undefined || value === null || String(value).trim() === "") return "active";
	return STATUS_ALIASES[normalizeKey(value)] ?? "dormant";
}

export function normalizeRate(value) {
	const text = String(value ?? "").trim();
	if (!text) return undefined;
	const number = Number.parseFloat(text.replace("%", ""));
	if (!Number.isFinite(number) || number < 0) return undefined;
	const rate = text.includes("%") || number > 1 ? number / 100 : number;
	return Math.min(rate, 1);
}

function normalizeCount(value) {
	const number = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
	return Number.isFinite(number) ? number : undefined;
}

// "2023-03-24 10:23:10 UTC" (Beehiiv), "2024-03-13 00:03:09.183465+00:00" (Buttondown), "2018-02-12 10:54:27"
// (Mailchimp): browsers disagree on dates with a space, so these are rewritten as ISO 8601 first.
const SPACED_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(z|utc|gmt|[+-]\d{2}:?\d{2})?$/i;

function toIsoOffset(zone) {
	if (!zone || /^(z|utc|gmt)$/i.test(zone)) return "Z";
	return zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

export function normalizeDate(value) {
	const text = String(value ?? "").trim();
	if (!text) return undefined;
	// Unix time, in seconds or milliseconds.
	if (/^\d{9,13}$/.test(text)) return new Date(Number(text) * (text.length <= 10 ? 1000 : 1)).toISOString();
	const spaced = SPACED_DATE_PATTERN.exec(text);
	const time = Date.parse(spaced ? `${spaced[1]}T${spaced[2]}${(spaced[3] ?? "").slice(0, 4)}${toIsoOffset(spaced[4])}` : text);
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function readBoolean(value) {
	const key = normalizeKey(value);
	if (["true", "yes", "1"].includes(key)) return true;
	if (["false", "no", "0"].includes(key)) return false;
	return null;
}

function stricterStatus(statuses) {
	return statuses.reduce((strictest, status) => (STATUS_RANK[status] > STATUS_RANK[strictest] ? status : strictest));
}

// The status column, then the columns that say someone left without one: the strictest of them wins.
function readFileStatus(row, columns) {
	const statuses = [columns.status ? normalizeStatus(row[columns.status]) : "active"];
	if (columns.unsubscribedAt && String(row[columns.unsubscribedAt] ?? "").trim()) statuses.push("unsubscribed");
	if (columns.cleanedAt && String(row[columns.cleanedAt] ?? "").trim()) statuses.push("bounced");
	if (columns.subscribedToEmails && readBoolean(row[columns.subscribedToEmails]) === false) statuses.push("unsubscribed");
	if (columns.emailDisabled && readBoolean(row[columns.emailDisabled]) === true) statuses.push("unsubscribed");
	return stricterStatus(statuses);
}

// profile: the columns read into the contact, from the dialog: { firstName: column, tags: column, fields: [{ column,
// key, type }] }. Values that don't fit a field's type are left out.
export function normalizeImportRow(row, columns, { status: statusOverride, profile } = {}) {
	const email = normalizeEmail(row[columns.email]);
	if (!email) return null;

	const fileStatus = readFileStatus(row, columns);
	const status =
		statusOverride && STATUS_RANK[statusOverride] > STATUS_RANK[fileStatus] ? statusOverride : fileStatus;

	return {
		email,
		status,
		subscribedAt: columns.subscribedAt ? normalizeDate(row[columns.subscribedAt]) : undefined,
		emailsReceived: columns.emailsReceived ? normalizeCount(row[columns.emailsReceived]) : undefined,
		openRate: columns.openRate ? normalizeRate(row[columns.openRate]) : undefined,
		clickRate: columns.clickRate ? normalizeRate(row[columns.clickRate]) : undefined,
		...readEngagement(row, columns),
		...(profile && readProfileColumns(row, profile)),
	};
}

// Only what the file has, so rows without engagement keep the same shape as before.
function readEngagement(row, columns) {
	const values = {
		lastOpenAt: columns.lastOpenAt ? normalizeDate(row[columns.lastOpenAt]) : undefined,
		lastClickAt: columns.lastClickAt ? normalizeDate(row[columns.lastClickAt]) : undefined,
		opens: columns.opens ? normalizeCount(row[columns.opens]) : undefined,
		clicks: columns.clicks ? normalizeCount(row[columns.clicks]) : undefined,
	};
	return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function readProfileColumns(row, { firstName, tags, fields = [] }) {
	const name = firstName ? cleanFirstName(row[firstName]) : "";
	const values = Object.fromEntries(
		fields
			.map(({ column, key, type }) => [key, formatFieldValue(type, readFieldValue(type, row[column]).value ?? null)])
			.filter(([, value]) => value !== null && value !== "")
	);
	const tagList = tags ? parseTagList(row[tags]) : [];
	return {
		...(name && { firstName: isFullNameColumn(firstName) ? name.split(" ")[0] : name }),
		...(tagList.length > 0 && { tags: tagList }),
		...(Object.keys(values).length > 0 && { fields: values }),
	};
}

function optionalNumber(value, max) {
	const number = Number(value);
	return value === undefined || value === null || !Number.isFinite(number) || number < 0
		? undefined
		: Math.min(number, max);
}

// Server side: rows come from the browser, so every field is checked again. fields: the account's own; a value for
// another key, or one that doesn't fit its field, is left out.
export function sanitizeImportRow(row, fields = []) {
	const email = normalizeEmail(row?.email);
	if (!email || !Object.hasOwn(STATUS_RANK, row?.status)) return null;
	const subscribedAt = row.subscribedAt ? new Date(row.subscribedAt) : undefined;
	const firstName = cleanFirstName(row.firstName);
	const tags = cleanTags(typeof row.tags === "string" ? parseTagList(row.tags) : row.tags);
	const values = Object.fromEntries(
		fields
			.filter(({ key }) => row.fields && typeof row.fields === "object" && Object.hasOwn(row.fields, key))
			.map(({ key, type }) => [key, readFieldValue(type, row.fields[key]).value ?? null])
			.filter(([, value]) => value !== null)
	);

	const engagement = {
		lastOpenAt: pastDate(row.lastOpenAt),
		lastClickAt: pastDate(row.lastClickAt),
		opens: optionalCount(row.opens),
		clicks: optionalCount(row.clicks),
	};

	return {
		email,
		status: row.status,
		subscribedAt: subscribedAt && Number.isFinite(subscribedAt.getTime()) ? subscribedAt : undefined,
		emailsReceived: optionalNumber(row.emailsReceived, 1_000_000),
		openRate: optionalNumber(row.openRate, 1),
		clickRate: optionalNumber(row.clickRate, 1),
		...Object.fromEntries(Object.entries(engagement).filter(([, value]) => value !== undefined)),
		...(firstName && { firstName }),
		...(tags.length > 0 && { tags }),
		...(Object.keys(values).length > 0 && { fields: values }),
	};
}

// An open or click the previous platform saw: a real date, not in the future.
function pastDate(value) {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() ? date : undefined;
}

function optionalCount(value) {
	const number = optionalNumber(value, 1_000_000);
	return number === undefined ? undefined : Math.floor(number);
}
