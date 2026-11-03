import "server-only";
import { toPageViews } from "@/lib/report-stats";
import PageView from "@/models/PageView";

const HOUR_MS = 60 * 60 * 1000;

// One more view of a campaign's page (app/api/views), in the hour it came in.
export async function countPageView(campaign, at = new Date()) {
	await PageView.updateOne(
		{ accountId: campaign.accountId, campaignId: campaign._id, hour: new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS) },
		{ $inc: { views: 1 } },
		{ upsert: true }
	);
}

// A campaign's page views for its report, by day in timeZone (lib/report-stats.js toPageViews).
export async function getPageViews(campaign, timeZone, now = new Date()) {
	const rows = await PageView.aggregate([
		{ $match: { accountId: campaign.accountId, campaignId: campaign._id } },
		{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$hour", timezone: timeZone } }, views: { $sum: "$views" } } },
	]);
	return toPageViews({ campaign, rows, timeZone, now });
}
