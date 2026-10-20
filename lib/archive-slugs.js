import "server-only";
import { withMergeFallbacks } from "@/lib/merge-tags";
import { slugify } from "@/lib/slug";
import Campaign from "@/models/Campaign";

// Slugs are unique across accounts (/p/<slug> on the app's domain), so the check looks at every account.
export async function isArchiveSlugTaken(slug, { exceptId } = {}) {
	const filter = { archiveSlug: slug, ...(exceptId && { _id: { $ne: exceptId } }) };
	return Boolean(await Campaign.exists(filter).setOptions({ crossAccount: true }));
}

export async function uniqueArchiveSlug(base) {
	for (let suffix = 1; suffix < 100; suffix += 1) {
		const slug = suffix === 1 ? base : `${base}-${suffix}`;
		if (!(await isArchiveSlugTaken(slug))) return slug;
	}
	return `${base}-${Date.now()}`;
}

// Unless the API set one, the slug comes from the subject as it is when the issue goes out, so the
// /p/ page exists before the first email links to it.
export async function assignArchiveSlug({ campaign, newsletter }) {
	if (!newsletter.archiveEnabled || campaign.archiveSlug) return;
	await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id },
		{ $set: { archiveSlug: await uniqueArchiveSlug(slugify(withMergeFallbacks(campaign.subject), 80) || "issue") } }
	);
}
