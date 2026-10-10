import { and, eq, lt, or, sql } from "drizzle-orm";
import { isSendingEnabled } from "./config.js";
import { getDb } from "./db.js";
import { deleteExpiredRateLimits } from "./rate-limit.js";
import { findDueScheduledSends, runScheduledSend } from "./scheduling.js";
import { leases } from "./schema.js";
import { findNextQueuedBatch, sendMessageBatch } from "./sending.js";
import { SEND_BATCH_SIZE } from "./sending-rules.js";

// The queue worker behind the sender Neon Function (functions/sender.js). A cron trigger wakes it every
// minute and the dashboard wakes it after a send starts. One lease keeps a single drain running at a time.
const LEASE_NAME = "sender";
const THROTTLE_WAIT_MS = 5000;
// Functions must start answering within 15 minutes, and a drain stops well before.
export const DRAIN_BUDGET_MS = 12 * 60 * 1000;
const LEASE_MARGIN_MS = 60 * 1000;

// Takes the lease when it's free or expired. The holder renews it after every batch.
async function claimLease(holder, durationMs) {
	const expiresAt = new Date(Date.now() + durationMs);
	const rows = await getDb()
		.insert(leases)
		.values({ name: LEASE_NAME, holder, expiresAt })
		.onConflictDoUpdate({
			target: leases.name,
			set: { holder, expiresAt },
			setWhere: or(lt(leases.expiresAt, sql`now()`), eq(leases.holder, holder)),
		})
		.returning({ holder: leases.holder });
	return rows.length > 0;
}

async function releaseLease(holder) {
	await getDb()
		.delete(leases)
		.where(and(eq(leases.name, LEASE_NAME), eq(leases.holder, holder)));
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends queued batches until the queue is empty or the budget runs out. A throttled batch (SES
// TooManyRequests) waits and tries again. The next tick picks up whatever is left.
export async function drainQueue({ budgetMs = DRAIN_BUDGET_MS, holder = crypto.randomUUID(), log = console } = {}) {
	if (!isSendingEnabled()) return { skipped: "sending is off" };
	const deadline = Date.now() + budgetMs;
	if (!(await claimLease(holder, budgetMs + LEASE_MARGIN_MS))) return { skipped: "another drain is running" };

	const totals = { batches: 0, sent: 0, failed: 0, suppressed: 0, skipped: 0 };
	try {
		while (Date.now() < deadline && isSendingEnabled()) {
			const ids = await findNextQueuedBatch(SEND_BATCH_SIZE);
			if (ids.length === 0) break;
			const result = await sendMessageBatch(ids);
			totals.batches += 1;
			for (const key of ["sent", "failed", "suppressed", "skipped"]) totals[key] += result[key];
			if (result.retry) await wait(THROTTLE_WAIT_MS);
			// A batch that moved nothing (all its campaigns paused mid-read) would spin. The next tick retries.
			else if (result.sent + result.failed + result.suppressed === 0) break;
			await claimLease(holder, deadline - Date.now() + LEASE_MARGIN_MS);
		}
	} finally {
		await releaseLease(holder).catch((error) => log.error("[sender] Could not release the lease:", error.message));
	}
	return totals;
}

// One cron tick: start the scheduled sends that are due, clear old rate limit windows, then drain.
export async function runTick({ onStarted, log = console } = {}) {
	const started = [];
	for (const { _id, scheduledAt } of await findDueScheduledSends()) {
		const result = await runScheduledSend({ campaignId: _id, scheduledAt });
		log.info(`[scheduled] ${JSON.stringify({ campaignId: _id, scheduledAt, ...result })}`);
		if (result.started) started.push(_id);
	}
	if (started.length > 0) await onStarted?.(started);
	await deleteExpiredRateLimits().catch((error) => log.error("[sender] Rate limit cleanup failed:", error.message));
	return { started, drain: await drainQueue({ log }) };
}
