"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { importContactRows } from "@/lib/contact-import";
import { MAX_IMPORT_ROWS_PER_REQUEST } from "@/lib/csv-import";
import { getDb } from "@/lib/db";
import { withEngagement } from "@/lib/engagement";
import { findNewsletterById } from "@/lib/records";
import { contacts } from "@/lib/schema";
import { isIdString } from "@/lib/validation";

export async function importContacts({ newsletterId, rows }) {
	await requireSession();
	if (!isIdString(newsletterId)) return { error: "Newsletter not found" };
	if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS_PER_REQUEST) return { error: "Too many rows" };

	if (!(await findNewsletterById(newsletterId, ["_id"]))) return { error: "Newsletter not found" };

	const result = await importContactRows({ newsletterId, rows });
	revalidatePath("/contacts");
	return result;
}

export async function setContactStatus(id, status) {
	await requireSession();
	if (!isIdString(id) || !["active", "unsubscribed"].includes(status)) {
		return { error: "Invalid request" };
	}

	// Reactivation only applies to dormant contacts; unsubscribes, bounces and complaints are final. It
	// starts the list cleanup over, or the next send would make them dormant again.
	const where =
		status === "active"
			? and(eq(contacts._id, id), eq(contacts.status, "dormant"))
			: and(eq(contacts._id, id), inArray(contacts.status, ["active", "dormant", "pending"]));
	const set = status === "active" ? withEngagement({ status }) : { status, unsubscribedAt: new Date() };
	const changed = await getDb().update(contacts).set(set).where(where).returning({ _id: contacts._id });

	revalidatePath("/contacts");
	return changed.length > 0 ? { ok: true } : { error: "Status cannot change" };
}
