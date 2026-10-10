import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { sendAlert } from "./alerts.js";
import { getDb } from "./db.js";
import { campaigns } from "./schema.js";
import { queueCampaign } from "./sending.js";
import { isIdString } from "./validation.js";

// The sender function's cron runs every minute; a send due within the next one starts now.
const START_EARLY_MS = 60 * 1000;

// Scheduling is a status and a time on the campaign: the cron tick finds it when it's due. Rescheduling,
// unscheduling, sending now or discarding just changes the row.
export async function findDueScheduledSends(now = Date.now()) {
	return getDb()
		.select({ _id: campaigns._id, scheduledAt: campaigns.scheduledAt })
		.from(campaigns)
		.where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, new Date(now + START_EARLY_MS))))
		.orderBy(asc(campaigns.scheduledAt));
}

// A campaign rescheduled, unscheduled, sent or discarded since the tick read it does nothing.
export async function runScheduledSend({ campaignId, scheduledAt }) {
	if (!isIdString(String(campaignId)) || !(scheduledAt instanceof Date)) return { skipped: "invalid job" };

	const [campaign] = await getDb()
		.select({ status: campaigns.status, scheduledAt: campaigns.scheduledAt, subject: campaigns.subject })
		.from(campaigns)
		.where(eq(campaigns._id, campaignId));
	if (campaign?.status !== "scheduled" || campaign.scheduledAt?.getTime() !== scheduledAt.getTime()) {
		return { skipped: "not scheduled for this time anymore" };
	}

	try {
		const result = await queueCampaign(String(campaignId));
		return { started: true, ...result };
	} catch (error) {
		// Only a campaign still waiting goes back to draft: one that started and then paused alerts on its own.
		const reverted = await getDb()
			.update(campaigns)
			.set({ status: "draft", scheduledAt: null })
			.where(and(eq(campaigns._id, campaignId), eq(campaigns.status, "scheduled")))
			.returning({ _id: campaigns._id });
		if (reverted.length > 0) {
			await sendAlert({
				key: `scheduled-send-${campaignId}`,
				title: "Scheduled send didn't start",
				detail: `${error.message}. "${campaign.subject || "Untitled"}" is a draft again.`,
				path: `/campaigns/${campaignId}`,
				cooldownMinutes: 1,
			});
		}
		return { failed: error.message };
	}
}
