import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db.js";
import { campaigns } from "./schema.js";
import { slugify } from "./slug.js";

async function isSlugTaken(slug) {
	const rows = await getDb().select({ _id: campaigns._id }).from(campaigns).where(eq(campaigns.archiveSlug, slug)).limit(1);
	return rows.length > 0;
}

export async function uniqueArchiveSlug(base) {
	for (let suffix = 1; suffix < 100; suffix += 1) {
		const slug = suffix === 1 ? base : `${base}-${suffix}`;
		if (!(await isSlugTaken(slug))) return slug;
	}
	return `${base}-${Date.now()}`;
}

// Unless the API set one, the slug comes from the subject as it is when the issue goes out, so the
// /p/ page exists before the first email links to it.
export async function assignArchiveSlug({ campaign, newsletter }) {
	if (!newsletter.archiveEnabled || campaign.archiveSlug) return;
	const slug = await uniqueArchiveSlug(slugify(campaign.subject, 80) || "issue");
	await getDb()
		.update(campaigns)
		.set({ archiveSlug: slug })
		.where(and(eq(campaigns._id, campaign._id), isNull(campaigns.archiveSlug)));
}
