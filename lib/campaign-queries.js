import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { toCampaign } from "./rows.js";
import { campaigns } from "./schema.js";

const SENT_OR_SCHEDULED = ["scheduled", "sending", "paused", "sent"];

// When the other issues went out, newest first. A schedule counts as the time picked, before and
// after it sends.
export async function listSendTimes({ newsletterId, excludeId, limit = 20 }) {
	const at = sql`coalesce(${campaigns.scheduledAt}, ${campaigns.startedAt}, ${campaigns.sentAt})`.mapWith(campaigns.sentAt);
	return getDb()
		.select({ status: campaigns.status, at })
		.from(campaigns)
		.where(
			and(
				ne(campaigns._id, String(excludeId)),
				inArray(campaigns.status, SENT_OR_SCHEDULED),
				newsletterId ? eq(campaigns.newsletterId, String(newsletterId)) : undefined,
				sql`${at} is not null`
			)
		)
		.orderBy(desc(at))
		.limit(limit);
}

// The fields campaign lists show: issues also carry their HTML and the data other sites render them
// from (up to 200 KB each), which lists never read.
const LIST_FIELDS = [
	"_id",
	"newsletterId",
	"subject",
	"status",
	"statsRecipients",
	"statsSent",
	"statsDelivered",
	"statsBounced",
	"statsComplained",
	"statsOpened",
	"statsClicked",
	"statsUnsubscribed",
	"statsFailed",
	"thumbnailUrl",
	"archiveSlug",
	"scheduledAt",
	"startedAt",
	"sentAt",
	"updatedAt",
];

// Sent issues sort by send date, scheduled ones by the time they go out (so upcoming sends lead) and
// drafts by their last edit: imported issues all share the import time as updatedAt and createdAt.
export async function listRecentCampaigns(limit, newsletterId) {
	const activityAt = sql`coalesce(${campaigns.sentAt}, ${campaigns.startedAt}, ${campaigns.scheduledAt}, ${campaigns.updatedAt})`;
	const rows = await getDb()
		.select(Object.fromEntries(LIST_FIELDS.map((key) => [key, campaigns[key]])))
		.from(campaigns)
		.where(and(ne(campaigns.status, "canceled"), newsletterId ? eq(campaigns.newsletterId, String(newsletterId)) : undefined))
		.orderBy(desc(activityAt), desc(campaigns._id))
		.limit(limit);
	return rows.map(toCampaign);
}
