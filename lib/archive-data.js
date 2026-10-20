import "server-only";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { ACCESS_FIELDS, hasActiveSubscription } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { connectDb } from "@/lib/db";
import { withMergeFallbacks } from "@/lib/merge-tags";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import Account from "@/models/Account";
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

// Public pages never show a reader's name: {{first_name}} prints its fallback, in the content too (lib/archive-content.js).
function toPublicIssue(issue) {
	return issue && { ...issue, subject: withMergeFallbacks(issue.subject), previewText: withMergeFallbacks(issue.previewText) };
}

// Archives are public by slug, from the newsletter's first issue on. A canceled account's archive is offline until it
// subscribes again.
export const getArchiveNewsletter = cache(async (slug) => {
	if (!SLUG_PATTERN.test(slug)) return null;
	await connectDb();
	const newsletter = await Newsletter.findOne({ slug, archiveEnabled: true })
		.setOptions({ crossAccount: true })
		.select("accountId name slug archiveHost imageUrl fromName description socialLinks author theme")
		.lean();
	if (!newsletter) return null;
	const [account, hasIssue] = await Promise.all([
		Account.findById(newsletter.accountId).select(ACCESS_FIELDS).lean(),
		hasPublishedIssue(newsletter),
	]);
	return hasActiveSubscription(account) && hasIssue ? newsletter : null;
});

// Until its first issue goes out, a newsletter's website answers as if it were off: on by default, it never shows an
// empty page. The send revalidates the archive (revalidateArchive), so the website goes live with it.
export async function hasPublishedIssue({ accountId, _id }) {
	await connectDb();
	return Boolean(await Campaign.exists({ accountId, newsletterId: _id, status: { $in: PUBLISHED_STATUSES } }));
}

// A picture several listed issues share is the newsletter's banner, not the issue's own. Those issues
// get a generated card instead, so the archive doesn't repeat one image on every card. Unlisted
// issues don't count.
const getSharedThumbnails = cache(async (newsletter) => {
	await connectDb();
	const rows = await Campaign.aggregate([
		{
			$match: {
				accountId: newsletter.accountId,
				newsletterId: newsletter._id,
				thumbnailUrl: { $type: "string" },
				...LISTED_FILTER,
			},
		},
		{ $group: { _id: "$thumbnailUrl", count: { $sum: 1 } } },
		{ $match: { count: { $gt: 1 } } },
	]);
	return new Set(rows.map(({ _id }) => _id));
});

async function withOwnThumbnails(newsletter, issues) {
	const shared = await getSharedThumbnails(newsletter);
	return issues.map((issue) => (shared.has(issue.thumbnailUrl) ? { ...issue, thumbnailUrl: undefined } : issue));
}

export const getArchiveIssue = cache(async (newsletter, postSlug) => {
	if (!ARCHIVE_SLUG_PATTERN.test(postSlug)) return null;
	await connectDb();
	const issue = await Campaign.findOne({
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		archiveSlug: postSlug,
		status: { $in: PUBLISHED_STATUSES },
	})
		.select(`${CARD_FIELDS} format markdown html source`)
		.lean();
	return issue && toPublicIssue((await withOwnThumbnails(newsletter, [issue]))[0]);
});

export async function listArchiveIssues(newsletter, { limit = 0, excludeId } = {}) {
	await connectDb();
	const issues = await Campaign.find({
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		...LISTED_FILTER,
		...(excludeId && { _id: { $ne: excludeId } }),
	})
		.sort({ sentAt: -1, startedAt: -1 })
		.limit(limit)
		.select(CARD_FIELDS)
		.lean();
	return (await withOwnThumbnails(newsletter, issues)).map(toPublicIssue);
}

// For the API: every listed issue that went out.
export async function listPublishedIssues(newsletter) {
	await connectDb();
	const issues = await Campaign.find({ accountId: newsletter.accountId, newsletterId: newsletter._id, ...LISTED_FILTER })
		.sort({ sentAt: -1, startedAt: -1 })
		.select("subject previewText archiveSlug sentAt startedAt")
		.lean();
	return issues.map(toPublicIssue);
}

// Cached per render: the layout's popup and the page's own subscribe blocks show the same count.
export const countReaders = cache(async (newsletter) => {
	await connectDb();
	return Contact.countDocuments({ accountId: newsletter.accountId, newsletterId: newsletter._id, status: "active" });
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
