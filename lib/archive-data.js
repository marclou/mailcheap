import "server-only";
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getDb } from "@/lib/db";
import { toCampaign, toRecord } from "@/lib/rows";
import { campaigns, contacts, newsletters } from "@/lib/schema";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const PUBLISHED_STATUSES = ["sending", "paused", "sent"];
const CARD_FIELDS = ["_id", "subject", "previewText", "archiveSlug", "archivePinned", "sentAt", "startedAt", "thumbnailUrl", "webViews"];

function pick(table, keys) {
	return Object.fromEntries(keys.map((key) => [key, table[key]]));
}

function listed(newsletterId) {
	return and(
		eq(campaigns.newsletterId, newsletterId),
		isNotNull(campaigns.archiveSlug),
		eq(campaigns.archiveListed, true),
		inArray(campaigns.status, PUBLISHED_STATUSES)
	);
}

// Newest first. MongoDB sorted a missing sentAt last; NULLS LAST keeps that.
const NEWEST_FIRST = [sql`${desc(campaigns.sentAt)} nulls last`, sql`${desc(campaigns.startedAt)} nulls last`];

export const getArchiveNewsletter = cache(async (slug) => {
	if (!SLUG_PATTERN.test(slug)) return null;
	const [row] = await getDb()
		.select(pick(newsletters, ["_id", "name", "slug", "imageUrl", "fromName", "description", "socialLinks", "author"]))
		.from(newsletters)
		.where(and(eq(newsletters.slug, slug), eq(newsletters.archiveEnabled, true)));
	return toRecord(row);
});

// A picture several listed issues share is the newsletter's banner, not the issue's own. Those issues
// get a generated card instead, so the archive doesn't repeat one image on every card. Unlisted
// issues don't count.
const getSharedThumbnails = cache(async (newsletterId) => {
	const rows = await getDb()
		.select({ url: campaigns.thumbnailUrl })
		.from(campaigns)
		.where(and(listed(newsletterId), isNotNull(campaigns.thumbnailUrl)))
		.groupBy(campaigns.thumbnailUrl)
		.having(sql`count(*) > 1`);
	return new Set(rows.map(({ url }) => url));
});

async function withOwnThumbnails(newsletterId, issues) {
	const shared = await getSharedThumbnails(String(newsletterId));
	return issues.map((issue) => (shared.has(issue.thumbnailUrl) ? { ...issue, thumbnailUrl: undefined } : issue));
}

export const getArchiveIssue = cache(async (newsletterId, postSlug) => {
	if (!ARCHIVE_SLUG_PATTERN.test(postSlug)) return null;
	const [row] = await getDb()
		.select(pick(campaigns, [...CARD_FIELDS, "format", "markdown", "html", "source"]))
		.from(campaigns)
		.where(
			and(
				eq(campaigns.newsletterId, String(newsletterId)),
				eq(campaigns.archiveSlug, postSlug),
				inArray(campaigns.status, PUBLISHED_STATUSES)
			)
		);
	const issue = toCampaign(row);
	return issue && (await withOwnThumbnails(newsletterId, [issue]))[0];
});

export async function listArchiveIssues(newsletterId, { limit = 0, excludeId } = {}) {
	let query = getDb()
		.select(pick(campaigns, CARD_FIELDS))
		.from(campaigns)
		.where(and(listed(String(newsletterId)), excludeId ? ne(campaigns._id, String(excludeId)) : undefined))
		.orderBy(...NEWEST_FIRST);
	if (limit) query = query.limit(limit);
	return withOwnThumbnails(newsletterId, (await query).map(toCampaign));
}

// For the API: every listed issue that went out.
export async function listPublishedIssues(newsletterId) {
	const rows = await getDb()
		.select(pick(campaigns, ["_id", "subject", "previewText", "archiveSlug", "sentAt", "startedAt"]))
		.from(campaigns)
		.where(listed(String(newsletterId)))
		.orderBy(...NEWEST_FIRST);
	return rows.map(toRecord);
}

// Cached per render: the layout's popup and the page's own subscribe blocks show the same count.
export const countReaders = cache(async (newsletterId) => {
	const [{ value }] = await getDb()
		.select({ value: count() })
		.from(contacts)
		.where(and(eq(contacts.newsletterId, String(newsletterId)), eq(contacts.status, "active")));
	return value;
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
