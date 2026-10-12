import "server-only";
import { connectDb } from "@/lib/db";
import { getClaimFilter, getFailureUpdate, JOB_LOCK_MS, THROTTLE_DELAY_MS } from "@/lib/job-rules";
import { runScheduledSend } from "@/lib/scheduling";
import { sendMessageBatch } from "@/lib/sending";
import { chunk } from "@/lib/sending-rules";
import Job from "@/models/Job";

const INSERT_CHUNK_SIZE = 500;

// Same handlers as the QStash routes (/api/jobs/send-batch and /api/jobs/send-scheduled).
const HANDLERS = {
	"send-batch": async ({ messageIds }) => {
		const result = await sendMessageBatch(messageIds);
		return { result, retry: result.retry };
	},
	"send-scheduled": async ({ campaignId, scheduledAt }) => {
		const result = await runScheduledSend({ campaignId, scheduledAt });
		console.info(`[scheduled] ${JSON.stringify({ campaignId, scheduledAt, ...result })}`);
		return { result };
	},
};

export async function enqueueJobs(jobs) {
	if (jobs.length === 0) return 0;
	await connectDb();
	const now = new Date();
	for (const group of chunk(jobs, INSERT_CHUNK_SIZE)) {
		await Job.insertMany(group.map(({ kind, payload, runAt }) => ({ kind, payload, runAt: runAt ?? now })));
	}
	return jobs.length;
}

async function claimNextJob() {
	const now = new Date();
	return Job.findOneAndUpdate(
		getClaimFilter(now),
		{ $set: { status: "running", lockedUntil: new Date(now.getTime() + JOB_LOCK_MS) }, $inc: { attempts: 1 } },
		{ sort: { runAt: 1, _id: 1 }, returnDocument: "after" }
	).lean();
}

async function finish(job, update, unset = { lockedUntil: 1 }) {
	await Job.updateOne({ _id: job._id, status: "running" }, { $set: update, $unset: unset });
}

// One job at a time, oldest first, so a campaign's batches go out in order at the configured rate
// (each batch spaces its own sends). Stops when nothing is due or the time budget runs out.
export async function runDueJobs({ budgetMs = 50_000 } = {}) {
	await connectDb();
	const deadline = Date.now() + budgetMs;
	const summary = { done: 0, retried: 0, failed: 0 };

	while (Date.now() < deadline) {
		const job = await claimNextJob();
		if (!job) break;
		const handler = HANDLERS[job.kind];
		try {
			if (!handler) throw new Error(`Unknown job kind ${job.kind}`);
			const { retry } = await handler(job.payload ?? {});
			if (retry) {
				await Job.updateOne(
					{ _id: job._id, status: "running" },
					{ $set: { status: "queued", runAt: new Date(Date.now() + THROTTLE_DELAY_MS) }, $inc: { attempts: -1 }, $unset: { lockedUntil: 1 } }
				);
				summary.retried++;
			} else {
				await finish(job, { status: "done", finishedAt: new Date() });
				summary.done++;
			}
		} catch (error) {
			const update = getFailureUpdate({ attempts: job.attempts, error });
			console.error(`[jobs] ${job.kind} ${job._id} attempt ${job.attempts} failed:`, error);
			await finish(job, update);
			if (update.status === "failed") summary.failed++;
			else summary.retried++;
		}
	}
	return summary;
}
