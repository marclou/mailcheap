// What a contact holds besides its address: a first name, tags, and values for the account's own fields (Account.
// contactFields), shared by its newsletters. Everything here checks what people, imports, the API and MCP send.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const FIELD_TYPES = {
	text: { label: "Text" },
	number: { label: "Number" },
	date: { label: "Date" },
};
export const FIELD_TYPE_IDS = Object.keys(FIELD_TYPES);
export const MAX_CONTACT_FIELDS = 20;
export const MAX_FIELD_LABEL = 40;
export const MAX_FIELD_TEXT = 500;
export const MAX_FIRST_NAME = 80;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 50;
// Names a field's key can't take: the contact's own properties, in the API and in the CSV columns.
const RESERVED_KEYS = new Set([
	"id",
	"email",
	"status",
	"source",
	"source_domain",
	"newsletter",
	"name",
	"first_name",
	"firstname",
	"tags",
	"tag",
	"fields",
	"subscribed_at",
	"confirmed_at",
	"unsubscribed_at",
	"last_sent_at",
	"last_open_at",
	"last_click_at",
	"emails_received",
	"opens",
	"clicks",
	"created_at",
	"unsubscribe_url",
	"subject",
	"preview_text",
]);

// Control characters and line breaks would break a subject line or a CSV cell.
function plainText(value) {
	return String(value ?? "")
		.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// "" for no name.
export function cleanFirstName(value) {
	return plainText(value).slice(0, MAX_FIRST_NAME);
}

// Tags are lowercase, so "VIP" and "vip" are one tag. Commas separate tags in a CSV cell, so a tag has none.
export function cleanTag(value) {
	const tag = plainText(value).replaceAll(",", " ").replace(/\s+/g, " ").trim().toLowerCase();
	return tag && tag.length <= MAX_TAG_LENGTH ? tag : null;
}

// Unique, in the order given; anything that isn't a tag is dropped.
export function cleanTags(values) {
	const tags = [];
	for (const value of Array.isArray(values) ? values : []) {
		const tag = cleanTag(value);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	return tags.slice(0, MAX_TAGS);
}

// A CSV cell: "vip, podcast", Mailchimp's "Customer","VIP", or tags split by semicolons or pipes.
export function parseTagList(cell) {
	return cleanTags(
		String(cell ?? "")
			.split(/[,;|]/)
			.map((part) => part.trim().replace(/^"+|"+$/g, ""))
	);
}

// "Company size" becomes company_size: what the API and the CSV columns call it.
export function fieldKeyFromLabel(label) {
	return plainText(label)
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^(\d)/, "f_$1")
		.slice(0, 30)
		.replace(/_+$/, "");
}

// A new field's definition as the account will keep it, or what's wrong with it.
export function checkFieldDefinition({ label, type } = {}, existing = []) {
	const name = plainText(label).slice(0, MAX_FIELD_LABEL);
	if (!name) return { problem: "Name the field" };
	if (!FIELD_TYPE_IDS.includes(type)) return { problem: `type must be one of ${FIELD_TYPE_IDS.join(", ")}` };
	const key = fieldKeyFromLabel(name);
	if (!key) return { problem: "Use letters or digits in the name" };
	if (RESERVED_KEYS.has(key)) return { problem: `"${name}" is already a contact property` };
	if (existing.some((field) => field.key === key)) return { problem: `There's already a field called "${name}"` };
	if (existing.length >= MAX_CONTACT_FIELDS) return { problem: `${MAX_CONTACT_FIELDS} fields at most` };
	return { field: { key, label: name, type } };
}

// A value for a field of this type, as it's stored: text, a number, or a date at midnight UTC. null clears it;
// problem says what's wrong.
export function readFieldValue(type, value) {
	if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return { value: null };
	if (type === "number") {
		const number = typeof value === "number" ? value : Number(String(value).trim().replaceAll(",", ""));
		return Number.isFinite(number) ? { value: number } : { problem: "a number" };
	}
	if (type === "date") {
		const date = toDay(value);
		return date ? { value: date } : { problem: "a date, YYYY-MM-DD" };
	}
	const text = plainText(value);
	return text.length <= MAX_FIELD_TEXT ? { value: text } : { problem: `text, ${MAX_FIELD_TEXT} characters at most` };
}

// Values for the account's fields by key, checked: { values } with null for each one to clear, or a problem naming the
// field. Unknown keys are refused, so a typo doesn't vanish.
export function readFieldValues(input, fields = []) {
	if (input === undefined) return { values: {} };
	if (!input || typeof input !== "object" || Array.isArray(input)) return { problem: "fields must be an object of field keys to values" };
	const values = {};
	for (const [key, value] of Object.entries(input)) {
		const field = fields.find((item) => item.key === key);
		if (!field) {
			const known = fields.map((item) => item.key);
			return { problem: `fields.${key}: no such field${known.length ? ` (the account has ${known.join(", ")})` : ""}` };
		}
		const read = readFieldValue(field.type, value);
		if (read.problem) return { problem: `fields.${key} needs ${read.problem}` };
		values[key] = read.value;
	}
	return { values };
}

// For people and the API: a date field as YYYY-MM-DD, the rest as stored.
export function formatFieldValue(type, value) {
	if (value === null || value === undefined) return null;
	if (type === "date") {
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
	}
	return value;
}

// The contact's values for the fields the account has now, formatted. A value whose field was deleted stays on the
// contact but shows nowhere.
export function contactFieldValues(contact, fields = []) {
	return Object.fromEntries(
		fields
			.map((field) => [field.key, formatFieldValue(field.type, contact?.fields?.[field.key])])
			.filter(([, value]) => value !== null && value !== "")
	);
}

function toDay(value) {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
	const text = String(value).trim();
	const day = DAY_PATTERN.test(text) ? text : null;
	const time = day ? Date.parse(`${day}T00:00:00.000Z`) : Date.parse(text);
	if (!Number.isFinite(time)) return null;
	const date = new Date(time);
	if (day && !date.toISOString().startsWith(day)) return null;
	return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
