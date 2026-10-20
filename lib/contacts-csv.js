import { formatFieldValue } from "./contact-fields.js";

// Column names the CSV import recognizes, so an export goes back in as it is. The account's own fields follow, one
// column per field named by its key, which the import maps back to the field.
export const CSV_COLUMNS = [
	["email", (contact) => contact.email],
	["first_name", (contact) => contact.firstName ?? ""],
	["status", (contact) => contact.status],
	["newsletter", (contact, newsletters) => newsletters.get(String(contact.newsletterId)) ?? ""],
	["source", (contact) => contact.source ?? ""],
	["tags", (contact) => (contact.tags ?? []).join(", ")],
	["subscribed_at", (contact) => contact.subscribedAt],
	["confirmed_at", (contact) => contact.confirmedAt],
	["unsubscribed_at", (contact) => contact.unsubscribedAt],
	["last_sent_at", (contact) => contact.lastSentAt],
	["last_open_at", (contact) => contact.lastOpenAt],
	["last_click_at", (contact) => contact.lastClickAt],
	["emails_received", (contact) => contact.stats?.sent ?? 0],
	["opens", (contact) => contact.stats?.opens ?? 0],
	["clicks", (contact) => contact.stats?.clicks ?? 0],
];

// Spreadsheets run a cell starting with = + - @ (or a tab or return) as a formula; a leading quote
// keeps it text. An address can begin that way too (the dot-atom syntax allows =, + and -), and
// =cmd|'…'!A1 needs no parentheses, so emails get the quote as well: a real one never starts with
// those, and an address that does is treated as text on the way back in.
function toCell(value) {
	if (value === undefined || value === null) return "";
	const text = value instanceof Date ? value.toISOString() : String(value);
	const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// fields: the account's own (Account.contactFields).
export function getCsvHeader(fields = []) {
	return `${[...CSV_COLUMNS.map(([name]) => name), ...(fields ?? []).map(({ key }) => toCell(key))].join(",")}\r\n`;
}

// newsletters: newsletter ID to slug.
export function toCsvRow(contact, newsletters = new Map(), fields = []) {
	const cells = [
		...CSV_COLUMNS.map(([, read]) => read(contact, newsletters)),
		...(fields ?? []).map(({ key, type }) => formatFieldValue(type, contact.fields?.[key])),
	];
	return `${cells.map(toCell).join(",")}\r\n`;
}
