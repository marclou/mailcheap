import { createHmac, timingSafeEqual } from "node:crypto";

// The local job queue: an alternative to QStash for long-running servers (Docker, Coolify, a VPS).
// Jobs live in MongoDB, and a timer in the server process (lib/job-ticker.js) asks /api/jobs/run to work
// through the due ones. Vercel keeps QStash: its functions can't run a timer between requests.

export const JOB_KINDS = ["send-batch", "send-scheduled"];
// A job still "running" after this long belongs to a server that died mid-job, and runs again.
export const JOB_LOCK_MS = 10 * 60 * 1000;
// Failures (database down, SMTP refusing) are retried with backoff, then the job is marked failed.
export const MAX_JOB_ATTEMPTS = 6;
// A throttled batch (sending switched off mid-send) waits this long and doesn't count as a failure.
export const THROTTLE_DELAY_MS = 60 * 1000;

export function isLocalQueue(env = process.env) {
	return env.JOB_QUEUE === "local";
}

// 30 s, 1 min, 2 min, 4 min... capped at 30 min.
export function getRetryDelayMs(attempts) {
	return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 30 * 60 * 1000);
}

// What a failed attempt turns into: another try later, or a final failure.
export function getFailureUpdate({ attempts, error, now = Date.now() }) {
	const lastError = String(error?.message || error).slice(0, 500);
	if (attempts >= MAX_JOB_ATTEMPTS) return { status: "failed", finishedAt: new Date(now), lastError };
	return { status: "queued", runAt: new Date(now + getRetryDelayMs(attempts)), lastError };
}

// Due jobs, plus jobs whose server died while running them.
export function getClaimFilter(now = new Date()) {
	return {
		runAt: { $lte: now },
		$or: [{ status: "queued" }, { status: "running", lockedUntil: { $lt: now } }],
	};
}

// The ticker and /api/jobs/run share this token. It derives from SESSION_SECRET, so it needs no setup.
export function getJobRunnerToken(secret = process.env.SESSION_SECRET) {
	if (!secret) return null;
	return createHmac("sha256", secret).update("mailcheap-job-runner-v1").digest("base64url");
}

export function isValidRunnerAuth(header, secret = process.env.SESSION_SECRET) {
	const expected = getJobRunnerToken(secret);
	if (!expected || typeof header !== "string") return false;
	const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
	const wanted = Buffer.from(expected);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
}
