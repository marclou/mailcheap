import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { toCampaign, toRecord } from "./rows.js";
import { campaigns, contacts, newsletters } from "./schema.js";
import { isIdString } from "./validation.js";

// The lookups pages and actions share. Fields are column keys from lib/schema.js. Without them, every column comes back.
function columns(table, fields) {
	if (!fields) return undefined;
	const keys = typeof fields === "string" ? fields.split(" ") : fields;
	return Object.fromEntries(["_id", ...keys.filter((key) => key !== "_id")].map((key) => [key, table[key]]));
}

export async function findNewsletter(where, fields) {
	const [row] = await getDb().select(columns(newsletters, fields)).from(newsletters).where(where).limit(1);
	return toRecord(row);
}

export function findNewsletterById(id, fields) {
	if (!isIdString(String(id ?? ""))) return null;
	return findNewsletter(eq(newsletters._id, String(id)), fields);
}

export function findNewsletterBySlug(slug, { archiveEnabled, fields } = {}) {
	return findNewsletter(
		and(eq(newsletters.slug, String(slug ?? "")), archiveEnabled ? eq(newsletters.archiveEnabled, true) : undefined),
		fields
	);
}

// In creation order, like the newsletter tabs and pickers show them.
export async function listNewsletters(fields) {
	const rows = await getDb().select(columns(newsletters, fields)).from(newsletters).orderBy(asc(newsletters.createdAt));
	return rows.map(toRecord);
}

export async function findCampaignById(id, fields) {
	if (!isIdString(String(id ?? ""))) return null;
	const [row] = await getDb()
		.select(columns(campaigns, fields))
		.from(campaigns)
		.where(eq(campaigns._id, String(id)));
	return toCampaign(row);
}

export async function countActiveContacts(newsletterId) {
	const [{ value }] = await getDb()
		.select({ value: count() })
		.from(contacts)
		.where(and(eq(contacts.newsletterId, String(newsletterId)), eq(contacts.status, "active")));
	return value;
}
