import "server-only";
import { revalidatePath } from "next/cache";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { isLocalQueue } from "@/lib/job-rules";
import { enqueueJobs } from "@/lib/jobs";
import { getQStash, queueCampaign } from "@/lib/sending";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";

// QStash's free plan delays a message 7 days at most, so later sends wake up on the way and wait again.
const MAX_WAIT_MS = 6 * 24 * 60 * 60 * 1000;
// Closer than this to the scheduled time, the send starts instead of waiting again.
const START_EARLY_MS = 60 * 1000;

export async function publishScheduledSend({ campaignId, scheduledAt, now = Date.now() }) {
	// The local queue has no delay limit: the job waits in MongoDB until the scheduled time.
	if (isLocalQueue()) {
		const payload = { campaignId: String(campaignId), scheduledAt: scheduledAt.toISOString() };
		await enqueueJobs([{ kind: "send-scheduled", payload, runAt: scheduledAt }]);
		return;
	}
	const wakeAt = Math.min(scheduledAt.getTime(), now + MAX_WAIT_MS);
	await getQStash().publishJSON({
		url: `${getAppUrl()}/api/jobs/send-scheduled`,
		body: { campaignId: String(campaignId), scheduledAt: scheduledAt.toISOString() },
		notBefore: Math.floor(wakeAt / 1000),
	});
}

// Runs when QStash delivers the job. A job whose campaign was rescheduled, unscheduled, sent or
// discarded since does nothing, so changing a schedule never needs to cancel the old job.
export async function runScheduledSend({ campaignId, scheduledAt }) {
	if (!isObjectIdString(String(campaignId)) || typeof scheduledAt !== "string") return { skipped: "invalid job" };

	await connectDb();
	const campaign = await Campaign.findById(campaignId).select("status scheduledAt subject").lean();
	if (campaign?.status !== "scheduled" || campaign.scheduledAt?.toISOString() !== scheduledAt) {
		return { skipped: "not scheduled for this time anymore" };
	}
	if (campaign.scheduledAt.getTime() - Date.now() > START_EARLY_MS) {
		await publishScheduledSend({ campaignId, scheduledAt: campaign.scheduledAt });
		return { waiting: true };
	}

	try {
		const result = await queueCampaign(String(campaignId));
		revalidatePath("/campaigns");
		revalidatePath(`/campaigns/${campaignId}`);
		revalidateArchive();
		return { started: true, ...result };
	} catch (error) {
		// Only a campaign still waiting goes back to draft: one that started and then paused alerts on its own.
		const { modifiedCount } = await Campaign.updateOne(
			{ _id: campaignId, status: "scheduled" },
			{ $set: { status: "draft" }, $unset: { scheduledAt: 1 } }
		);
		if (modifiedCount) {
			await sendAlert({
				key: `scheduled-send-${campaignId}`,
				title: "Scheduled send didn't start",
				detail: `${error.message}. "${campaign.subject || "Untitled"}" is a draft again.`,
				path: `/campaigns/${campaignId}`,
				cooldownMinutes: 1,
			});
		}
		revalidatePath("/campaigns");
		return { failed: error.message };
	}
}
