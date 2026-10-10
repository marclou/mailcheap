import "server-only";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { connectDb } from "@/lib/db";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const PUBLISHED_STATUSES = ["sending", "paused", "sent"];
const LISTED_FILTER = {
	archiveSlug: { $type: "string" },
	archiveListed: { $ne: false },
	status: { $in: PUBLISHED_STATUSES },
};
const CARD_FIELDS = "subject previewText archiveSlug archivePinned sentAt startedAt thumbnailUrl webViews";

export const getArchiveNewsletter = cache(async (slug) => {
	if (!SLUG_PATTERN.test(slug)) return null;
	await connectDb();
	return Newsletter.findOne({ slug, archiveEnabled: true })
		.select("name slug imageUrl fromName description socialLinks author sparkloop")
		.lean();
});

// A picture several listed issues share is the newsletter's banner, not the issue's own. Those issues
// get a generated card instead, so the archive doesn't repeat one image on every card. Unlisted
// issues don't count.
const getSharedThumbnails = cache(async (newsletterId) => {
	await connectDb();
	const rows = await Campaign.aggregate([
		{
			$match: {
				newsletterId: new mongoose.Types.ObjectId(newsletterId),
				thumbnailUrl: { $type: "string" },
				...LISTED_FILTER,
			},
		},
		{ $group: { _id: "$thumbnailUrl", count: { $sum: 1 } } },
		{ $match: { count: { $gt: 1 } } },
	]);
	return new Set(rows.map(({ _id }) => _id));
});

async function withOwnThumbnails(newsletterId, issues) {
	const shared = await getSharedThumbnails(String(newsletterId));
	return issues.map((issue) => (shared.has(issue.thumbnailUrl) ? { ...issue, thumbnailUrl: undefined } : issue));
}

export const getArchiveIssue = cache(async (newsletterId, postSlug) => {
	if (!ARCHIVE_SLUG_PATTERN.test(postSlug)) return null;
	await connectDb();
	const issue = await Campaign.findOne({ newsletterId, archiveSlug: postSlug, status: { $in: PUBLISHED_STATUSES } })
		.select(`${CARD_FIELDS} format markdown html source`)
		.lean();
	return issue && (await withOwnThumbnails(newsletterId, [issue]))[0];
});

export async function listArchiveIssues(newsletterId, { limit = 0, excludeId } = {}) {
	await connectDb();
	const issues = await Campaign.find({
		newsletterId,
		...LISTED_FILTER,
		...(excludeId && { _id: { $ne: excludeId } }),
	})
		.sort({ sentAt: -1, startedAt: -1 })
		.limit(limit)
		.select(CARD_FIELDS)
		.lean();
	return withOwnThumbnails(newsletterId, issues);
}

// For the API: every listed issue that went out.
export async function listPublishedIssues(newsletterId) {
	await connectDb();
	return Campaign.find({ newsletterId, ...LISTED_FILTER })
		.sort({ sentAt: -1, startedAt: -1 })
		.select("subject previewText archiveSlug sentAt startedAt")
		.lean();
}

// Cached per render: the layout's popup and the page's own subscribe blocks show the same count.
export const countReaders = cache(async (newsletterId) => {
	await connectDb();
	return Contact.countDocuments({ newsletterId, status: "active" });
});

// Cached pages are tagged by route file, so the pattern refreshes every archive page; each
// regenerates on its next visit.
export function revalidateArchive() {
	revalidatePath("/archive/[slug]", "layout");
}

// Unlisted issues keep their page, so only the archive switch, the slug and the send decide.
export function getIssuePageUrl({ campaign, newsletter }) {
	if (!newsletter?.archiveEnabled || !campaign.archiveSlug || !PUBLISHED_STATUSES.includes(campaign.status)) return null;
	return getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug);
}
