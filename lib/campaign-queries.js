import { Types } from "mongoose";
import { scoped } from "@/lib/account-scope";
import { sendsEmail } from "@/lib/publish-to";
import { findCampaignSegmentFilter } from "@/lib/segment-queries";
import { CAMPAIGN_MESSAGE_KINDS } from "@/lib/sending-rules";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

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
	publishTo: 1,
	pauseCode: 1,
	stats: 1,
	webViews: 1,
	thumbnailUrl: 1,
	"web.image": 1,
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

// A send's Gmail readers still to go, for its report: all of them, and the ones its new domain sends a later day, from
// when (lib/sending.js markSendAfter).
export async function countCampaignGmail(campaign, now = new Date()) {
	const waiting = scoped({ _id: campaign.accountId }, {
		campaignId: campaign._id,
		kind: { $in: CAMPAIGN_MESSAGE_KINDS },
		provider: "gmail",
		status: { $in: ["queued", "held"] },
	});
	const later = { ...waiting, status: "queued", sendAfter: { $gt: now } };
	const [total, count, first] = await Promise.all([
		Message.countDocuments(waiting),
		Message.countDocuments(later),
		Message.findOne(later).sort({ sendAfter: 1 }).select({ sendAfter: 1 }).lean(),
	]);
	return { waiting: total, later: count, laterAt: first?.sendAfter?.toISOString() ?? null };
}
// Only a send capped to the most engaged has a next step: the active contacts of its audience it hasn't reached. Close
// enough for the next step's dialog: contacts who left after receiving it make this a little low, and the step skips
// everyone who has it. A deleted segment has no next step.
export async function countRemainingContacts(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit || !sendsEmail(campaign)) return 0;
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
