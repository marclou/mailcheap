import "server-only";
import CampaignLink from "@/models/CampaignLink";

export const MAX_CAMPAIGN_LINKS = 200;

// A sent campaign's clicked links, most clicked first, and whether they hold every click of its send: one that
// started before clicks were counted per link has them since the first one counted, or since it was resumed.
export async function findCampaignLinks(campaign) {
	const links = await CampaignLink.find({ accountId: campaign.accountId, campaignId: campaign._id })
		.sort({ clickers: -1, clicks: -1, url: 1 })
		.limit(MAX_CAMPAIGN_LINKS)
		.lean();
	const { clickers = 0, countedAt } = campaign.links ?? {};
	const isComplete = Boolean(countedAt && campaign.startedAt && new Date(countedAt) <= new Date(campaign.startedAt));
	const firstCounted = [countedAt, ...links.map(({ createdAt }) => createdAt)]
		.filter(Boolean)
		.reduce((earliest, date) => (!earliest || new Date(date) < new Date(earliest) ? date : earliest), null);
	return {
		clickers,
		isComplete,
		countedSince: isComplete ? null : firstCounted,
		links: links.map(({ key, url, clicks, clickers: linkClickers }) => ({ key, url, clicks, clickers: linkClickers })),
	};
}
