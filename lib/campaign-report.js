import "server-only";
import { MESSAGE_STATS_GROUP } from "@/lib/message-stats";
import { COMPARED_ISSUES, TIMELINE_HOURS, buildTimeline, compareRates } from "@/lib/report-stats";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";

// A sent campaign's results by inbox provider and its opens and clicks hour by hour, in one pass over its messages.
// timeline is null for a send with no start time.
export async function getCampaignActivity(campaign, { now = new Date() } = {}) {
	const [{ providers, opens, clicks }] = await Message.aggregate([
		{ $match: { accountId: campaign.accountId, campaignId: campaign._id, kind: "campaign" } },
		{
			$facet: {
				providers: [{ $group: { _id: { $ifNull: ["$provider", "other"] }, ...MESSAGE_STATS_GROUP } }, { $sort: { sent: -1 } }],
				opens: hourly("openedAt"),
				clicks: hourly("clickedAt"),
			},
		},
	]);
	const startedAt = campaign.startedAt ?? campaign.sentAt;
	return {
		providers: providers.filter(({ sent }) => sent > 0).map(({ _id, ...row }) => ({ provider: _id, ...row })),
		timeline: startedAt ? buildTimeline({ startedAt, now, opens, clicks }) : null,
	};
}

// The newsletter's last issues before this one, for the report's "vs average". isSettled: the send is old enough for
// its own rates to stop climbing; before that it would always trail the average.
export async function getCampaignComparison(campaign, { now = new Date() } = {}) {
	if (!campaign.startedAt) return null;
	const previous = await Campaign.find(
		{
			accountId: campaign.accountId,
			newsletterId: campaign.newsletterId,
			_id: { $ne: campaign._id },
			status: "sent",
			startedAt: { $lt: campaign.startedAt },
		},
		{ stats: 1 }
	)
		.sort({ startedAt: -1 })
		.limit(COMPARED_ISSUES)
		.lean();
	const comparison = compareRates(campaign.stats, previous.map(({ stats }) => stats));
	const isSettled = now.getTime() - new Date(campaign.startedAt).getTime() >= TIMELINE_HOURS * 60 * 60 * 1000;
	return comparison && { ...comparison, isSettled };
}

function hourly(field) {
	return [
		{ $match: { [field]: { $ne: null } } },
		{ $group: { _id: { $dateTrunc: { date: `$${field}`, unit: "hour" } }, count: { $sum: 1 } } },
	];
}
