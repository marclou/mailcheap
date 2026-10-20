import { Types } from "mongoose";
import { scoped } from "@/lib/account-scope";
import { WARMUP } from "@/lib/config";
import { findCampaignSegmentFilter } from "@/lib/segment-queries";
import { getProvenEmails } from "@/lib/send-spread";
import { CAMPAIGN_MESSAGE_KINDS } from "@/lib/sending-rules";
import { countEmailsInFlight } from "@/lib/usage";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

const HOUR_MS = 60 * 60 * 1000;

const SENT_OR_SCHEDULED = ["scheduled", "sending", "paused", "sent"];

// When the account's other issues went out, newest first. A schedule counts as the time picked, before
// and after it sends.
export function sendTimesPipeline({ accountId, newsletterId, excludeId, limit = 20 }) {
	return [
		{
			$match: {
				accountId,
				_id: { $ne: excludeId },
				status: { $in: SENT_OR_SCHEDULED },
				...(newsletterId && { newsletterId }),
			},
		},
		{ $project: { status: 1, at: { $ifNull: ["$scheduledAt", "$startedAt", "$sentAt"] } } },
		{ $match: { at: { $type: "date" } } },
		{ $sort: { at: -1 } },
		{ $limit: limit },
	];
}

// The fields campaign lists show, picked before sorting: issues also carry their HTML and the data
// other sites render them from (up to 200 KB each).
const LIST_FIELDS = {
	newsletterId: 1,
	subject: 1,
	status: 1,
	stats: 1,
	thumbnailUrl: 1,
	archiveSlug: 1,
	scheduledAt: 1,
	startedAt: 1,
	sentAt: 1,
	updatedAt: 1,
};

// Sent issues sort by send date, scheduled ones by the time they go out (so upcoming sends lead) and
// drafts by their last edit: imported issues all share the import time as updatedAt and createdAt.
export function recentCampaignsPipeline({ accountId, limit, newsletterId, status, fields = LIST_FIELDS }) {
	return [
		{ $match: { accountId, status: status ?? { $ne: "canceled" }, ...(newsletterId && { newsletterId }) } },
		{ $project: fields },
		{
			$addFields: {
				activityAt: { $ifNull: ["$sentAt", "$startedAt", "$scheduledAt", "$updatedAt"] },
			},
		},
		{ $sort: { activityAt: -1, _id: -1 } },
		{ $limit: limit },
	];
}

// What a new send's pace depends on (lib/send-spread.js): the account's proven volume, and what its sends still have to
// send or sent in the last day. Paused sends count again when they resume.
export async function getSendVolumes(account, now = new Date()) {
	const since = new Date(now.getTime() - WARMUP.provenDays * 24 * HOUR_MS);
	const [campaigns, sentRecently, inFlight] = await Promise.all([
		Campaign.find(scoped(account, { status: "sent", $or: [{ finishedAt: { $gte: since } }, { sentAt: { $gte: since } }] }))
			.select({ stats: 1, lastChance: 1, finishedAt: 1, sentAt: 1 })
			.lean(),
		Message.countDocuments(
			scoped(account, { sentAt: { $gte: new Date(now.getTime() - WARMUP.recentHours * HOUR_MS) }, kind: { $in: CAMPAIGN_MESSAGE_KINDS } })
		),
		countEmailsInFlight(scoped(account).accountId),
	]);
	return { proven: getProvenEmails(campaigns, now), recent: sentRecently + inFlight };
}

// Active contacts this account never emailed, in a segment's filter when it has one: a send to more than the first
// slice goes in steps (lib/first-send.js).
export function countNewContacts(account, newsletterId, segmentFilter = null) {
	return Contact.countDocuments(
		scoped(account, { newsletterId, status: "active", lastSentAt: null, ...(segmentFilter && { $and: [segmentFilter] }) })
	);
}

// Only a send capped to the most engaged has a next step: the active contacts of its audience it hasn't reached. Close
// enough for the next step's dialog: contacts who left after receiving it make this a little low, and the step skips
// everyone who has it. A deleted segment has no next step.
export async function countRemainingContacts(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit) return 0;
	let segmentFilter;
	try {
		segmentFilter = await findCampaignSegmentFilter(campaign);
	} catch {
		return 0;
	}
	const active = await Contact.countDocuments({
		accountId: campaign.accountId,
		newsletterId: campaign.newsletterId,
		status: "active",
		...(segmentFilter && { $and: [segmentFilter] }),
	});
	const reached = (campaign.stats?.recipients ?? 0) + (campaign.lastChance?.recipients ?? 0);
	return Math.max(0, active - reached);
}

// The dashboard's lists: one newsletter's campaigns, in the account's own data.
export function listNewsletterCampaigns(account, newsletterId, limit) {
	const { accountId } = scoped(account);
	return Campaign.aggregate(recentCampaignsPipeline({ accountId, newsletterId: new Types.ObjectId(String(newsletterId)), limit }));
}
