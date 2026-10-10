import { and, asc, count, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { withEngagement } from "./engagement.js";
import { toContact, toRecord } from "./rows.js";
import { contacts, newsletters, suppressions } from "./schema.js";

const NEWSLETTER_FIELDS = Object.keys(getTableColumns(newsletters));

// Newsletters in creation order with their active contacts, counted in the same round trip.
export async function listNewslettersWithActiveCounts(fields) {
	const keys = fields ? ["_id", ...fields.split(" ")] : NEWSLETTER_FIELDS;
	const active = getDb()
		.select({ newsletterId: contacts.newsletterId, value: count().as("value") })
		.from(contacts)
		.where(eq(contacts.status, "active"))
		.groupBy(contacts.newsletterId)
		.as("active");
	const rows = await getDb()
		.select({
			...Object.fromEntries(keys.map((key) => [key, newsletters[key]])),
			activeCount: sql`coalesce(${active.value}, 0)`.mapWith(Number),
		})
		.from(newsletters)
		.leftJoin(active, eq(active.newsletterId, newsletters._id))
		.orderBy(asc(newsletters.createdAt));
	return rows.map(toRecord);
}

// Only an explicit resubscribe reverses an opt-out; bounces and complaints never reverse.
const REACTIVATABLE_STATUSES = ["unsubscribed", "dormant"];
const SUPPRESSED_STATUSES = { bounce: "bounced", complaint: "complained", manual: "unsubscribed" };

async function findContact(where) {
	const [row] = await getDb().select().from(contacts).where(where);
	return toContact(row);
}

async function updateContact(where, set) {
	const [row] = await getDb().update(contacts).set(set).where(where).returning();
	return toContact(row);
}

export async function upsertContact({ newsletter, email, source, resubscribe }) {
	const joinStatus = newsletter.requireConfirmation ? "pending" : "active";
	const [suppression] = await getDb()
		.select({ reason: suppressions.reason })
		.from(suppressions)
		.where(eq(suppressions.email, email));
	const status = suppression ? (SUPPRESSED_STATUSES[suppression.reason] ?? "unsubscribed") : joinStatus;
	const now = new Date();
	// The no-op update returns the existing row; xmax is 0 only for a row this statement inserted.
	const [row] = await getDb()
		.insert(contacts)
		.values({ newsletterId: newsletter._id, email, status, source, subscribedAt: now })
		.onConflictDoUpdate({ target: [contacts.newsletterId, contacts.email], set: { email: sql`excluded.email` } })
		.returning({ ...getTableColumns(contacts), created: sql`xmax = 0`.mapWith(Boolean) });
	const { created, ...rest } = row;
	const contact = toContact(rest);

	if (created || !resubscribe || suppression) return { contact, created };
	// Signing up again is a sign of life, and brings back a contact who left or went dormant.
	if (contact.status === "active") {
		await updateContact(eq(contacts._id, contact._id), withEngagement());
		return { contact, created };
	}
	if (!REACTIVATABLE_STATUSES.includes(contact.status)) return { contact, created };
	const reactivated = await updateContact(
		and(eq(contacts._id, contact._id), inArray(contacts.status, REACTIVATABLE_STATUSES)),
		withEngagement({ status: joinStatus, subscribedAt: new Date(), unsubscribedAt: null })
	);
	return { contact: reactivated ?? contact, created };
}

// The click on the confirmation link. A contact that already confirmed stays as it is.
export async function confirmContact({ contactId, newsletterId }) {
	const confirmed = await updateContact(
		and(eq(contacts._id, contactId), eq(contacts.newsletterId, newsletterId), eq(contacts.status, "pending")),
		withEngagement({ status: "active", confirmedAt: new Date() })
	);
	if (confirmed) return { contact: confirmed, confirmed: true };
	const contact = await findContact(and(eq(contacts._id, contactId), eq(contacts.newsletterId, newsletterId)));
	return { contact, confirmed: false };
}

// The "Yes, keep sending it" click in the last-chance email. It also brings back a contact who went
// dormant; unsubscribes, bounces and complaints stay as they are.
export async function keepContact({ contactId, newsletterId }) {
	const contact = await findContact(and(eq(contacts._id, contactId), eq(contacts.newsletterId, newsletterId)));
	if (!contact || !["active", "dormant"].includes(contact.status)) return null;
	if (contact.status === "dormant") {
		const suppressed = await getDb()
			.select({ _id: suppressions._id })
			.from(suppressions)
			.where(eq(suppressions.email, contact.email))
			.limit(1);
		if (suppressed.length > 0) return null;
	}
	return updateContact(
		and(eq(contacts._id, contact._id), inArray(contacts.status, ["active", "dormant"])),
		withEngagement({ status: "active" })
	);
}
