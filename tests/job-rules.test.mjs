import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getClaimFilter,
	getFailureUpdate,
	getJobRunnerToken,
	getRetryDelayMs,
	isLocalQueue,
	isValidRunnerAuth,
	MAX_JOB_ATTEMPTS,
} from "../lib/job-rules.js";

const SECRET = "test-session-secret-with-at-least-32-characters";

test("the local queue is only on when JOB_QUEUE is local", () => {
	assert.equal(isLocalQueue({ JOB_QUEUE: "local" }), true);
	assert.equal(isLocalQueue({ JOB_QUEUE: "qstash" }), false);
	assert.equal(isLocalQueue({}), false);
});

test("retries back off from 30 seconds and stop growing at 30 minutes", () => {
	assert.equal(getRetryDelayMs(1), 30_000);
	assert.equal(getRetryDelayMs(2), 60_000);
	assert.equal(getRetryDelayMs(3), 120_000);
	assert.equal(getRetryDelayMs(20), 30 * 60 * 1000);
});

test("a failed job is retried later, then marked failed after the last attempt", () => {
	const now = Date.UTC(2026, 9, 12, 12);
	const retry = getFailureUpdate({ attempts: 1, error: new Error("connection reset"), now });
	assert.equal(retry.status, "queued");
	assert.equal(retry.runAt.getTime(), now + 30_000);
	assert.equal(retry.lastError, "connection reset");

	const final = getFailureUpdate({ attempts: MAX_JOB_ATTEMPTS, error: "still down", now });
	assert.equal(final.status, "failed");
	assert.equal(final.finishedAt.getTime(), now);
	assert.equal(final.runAt, undefined);
});

test("long errors are cut so a job document stays small", () => {
	const update = getFailureUpdate({ attempts: 1, error: new Error("x".repeat(2000)) });
	assert.equal(update.lastError.length, 500);
});

test("claiming takes due queued jobs and jobs whose lock expired", () => {
	const now = new Date(Date.UTC(2026, 9, 12, 12));
	assert.deepEqual(getClaimFilter(now), {
		runAt: { $lte: now },
		$or: [{ status: "queued" }, { status: "running", lockedUntil: { $lt: now } }],
	});
});

test("only the runner token derived from SESSION_SECRET is accepted", () => {
	const token = getJobRunnerToken(SECRET);
	assert.ok(token.length >= 40);
	assert.equal(isValidRunnerAuth(`Bearer ${token}`, SECRET), true);
	assert.equal(isValidRunnerAuth(`Bearer ${token}x`, SECRET), false);
	assert.equal(isValidRunnerAuth(`Bearer ${getJobRunnerToken("another-secret-that-is-long-enough-123")}`, SECRET), false);
	assert.equal(isValidRunnerAuth(undefined, SECRET), false);
	assert.equal(isValidRunnerAuth(`Bearer ${token}`, ""), false);
	assert.equal(getJobRunnerToken(""), null);
});
