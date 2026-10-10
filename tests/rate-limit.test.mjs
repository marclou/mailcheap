import assert from "node:assert/strict";
import { test } from "node:test";
import { isLimitedInMemory, isRateLimited } from "../lib/rate-limit.js";

delete process.env.DATABASE_URL;

const LOGIN = { name: "test-login", limit: 3, window: "15 m" };

async function countAllowed(options, attempts, limiter) {
	let allowed = 0;
	for (let attempt = 0; attempt < attempts; attempt += 1) if (!(await isRateLimited(options, limiter))) allowed += 1;
	return allowed;
}

test("without a database, limits still apply, counted in memory per key", async () => {
	const results = [];
	for (let attempt = 0; attempt < 4; attempt += 1) results.push(await isRateLimited({ ...LOGIN, key: "203.0.113.7" }));
	assert.deepEqual(results, [false, false, false, true]);
	assert.equal(await isRateLimited({ ...LOGIN, key: "203.0.113.8" }), false, "other visitors keep their own count");
	assert.equal(await isRateLimited({ ...LOGIN, name: "test-other", key: "203.0.113.7" }), false, "and other limits");
});

test("a Postgres error or timeout falls back to memory instead of letting everything through", async (t) => {
	t.mock.method(console, "error", () => {});
	const failing = { limit: async () => Promise.reject(new Error("fetch failed")) };
	const timingOut = { limit: async () => ({ success: true, reason: "timeout" }) };
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.3" }, 5, failing), 3);
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.4" }, 5, timingOut), 3);

	const reports = console.error.mock.calls.filter(({ arguments: [message] }) => /unavailable, counting in memory/.test(message));
	assert.equal(reports.length, 1, "an outage is reported at most every 30 minutes, not on every request");
});

test("Postgres answers decide while it is up", async () => {
	const allowing = { limit: async () => ({ success: true }) };
	const refusing = { limit: async () => ({ success: false }) };
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.5" }, 5, allowing), 5);
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.5" }, 2, refusing), 0);
});

test("memory limits open again once the window has passed", () => {
	const limits = { name: "test-window", limit: 2, window: "10 m" };
	const start = Date.parse("2026-10-09T12:00:00Z");
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start), false);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 1000), false);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 2000), true);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 10 * 60_000 + 1000), false);
});
