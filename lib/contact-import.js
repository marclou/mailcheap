import { and, eq, inArray, sql } from "drizzle-orm";
import { STATUS_RANK, sanitizeImportRow } from "./csv-import.js";

const SUPPRESSION_REASONS = { bounced: "bounce", complained: "complaint" };
const INSERT_CHUNK_SIZE = 1000;
const IMPORTED_COLUMNS = { emailsReceived: "importedEmailsReceived", openRate: "importedOpenRate", clickRate: "importedClickRate" };

function weakerStatuses(status) {
	return Object.keys(STATUS_RANK).filter((key) => STATUS_RANK[key] < STATUS_RANK[status]);
}

// One row per contact for an upsert: new contacts take the file's status, existing ones keep theirs and
// only take the engagement numbers the file has.
export function getContactWrites({ newsletterId, contacts, source }) {
	return contacts.map(({ email, status, subscribedAt, ...engagement }) => ({
		newsletterId,
		email,
		status,
		source,
		subscribedAt: subscribedAt ?? new Date(),
		...(status === "unsubscribed" && { unsubscribedAt: new Date() }),
		...Object.fromEntries(
			Object.entries(IMPORTED_COLUMNS)
				.filter(([key]) => engagement[key] !== undefined)
				.map(([key, column]) => [column, engagement[key]])
		),
	}));
}

// Each status the rows move existing contacts to, with the weaker statuses it replaces. Nothing moves a
// contact to active, and pending has no rank, so a contact waiting to confirm stays as it is.
export function getStatusChanges(contacts) {
	return Object.entries(Object.groupBy(contacts, ({ status }) => status))
		.filter(([status]) => status !== "active")
		.map(([status, group]) => ({
			status,
			emails: group.map(({ email }) => email),
			replaces: weakerStatuses(status),
		}));
}

// Never deletes and never moves a contact back to a weaker status: an unsubscribe, bounce or
// complaint always wins.
export async function importContactRows({ newsletterId, rows, source = "import" }) {
	const [{ getDb }, { contacts: table, suppressions }] = await Promise.all([import("./db.js"), import("./schema.js")]);
	const db = getDb();
	const contacts = [
		...new Map(rows.map(sanitizeImportRow).filter(Boolean).map((row) => [row.email, row])).values(),
	];
	if (contacts.length === 0) return { created: 0, existing: 0, invalid: rows.length };

	// An empty cell keeps what the contact already has (COALESCE), like the $set of only the given fields.
	const keepUnlessGiven = Object.fromEntries(
		Object.values(IMPORTED_COLUMNS).map((key) => [key, sql`coalesce(excluded.${sql.identifier(table[key].name)}, ${table[key]})`])
	);
	let created = 0;
	let existing = 0;
	for (let index = 0; index < contacts.length; index += INSERT_CHUNK_SIZE) {
		const writes = getContactWrites({ newsletterId, contacts: contacts.slice(index, index + INSERT_CHUNK_SIZE), source });
		const results = await db
			.insert(table)
			.values(writes)
			.onConflictDoUpdate({ target: [table.newsletterId, table.email], set: keepUnlessGiven })
			.returning({ created: sql`xmax = 0`.mapWith(Boolean) });
		for (const result of results) {
			if (result.created) created += 1;
			else existing += 1;
		}
	}

	const changes = getStatusChanges(contacts);
	for (const { status, emails, replaces } of changes) {
		await db
			.update(table)
			.set({ status, ...(status === "unsubscribed" && { unsubscribedAt: new Date() }) })
			.where(and(eq(table.newsletterId, newsletterId), inArray(table.email, emails), inArray(table.status, replaces)));
	}

	const suppressed = changes.filter(({ status }) => SUPPRESSION_REASONS[status]);
	for (const { status, emails } of suppressed) {
		await db
			.insert(suppressions)
			.values(emails.map((email) => ({ email, reason: SUPPRESSION_REASONS[status], detail: source })))
			.onConflictDoNothing({ target: suppressions.email });
	}

	return { created, existing, invalid: rows.length - contacts.length };
}
