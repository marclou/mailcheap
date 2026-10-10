import { sql } from "drizzle-orm";
import { getClientIp } from "./client-ip.js";

export { getClientIp };

// Limits are counted in Postgres, so every server instance shares them. Without a database, or while it's
// down, the same limits are counted in this server instance's memory. Instances don't share it and lose it
// on restart, so it's weaker on serverless hosts, but a script hammering one form still gets stopped.
const memory = new Map();
const MAX_MEMORY_KEYS = 10_000;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const REPORT_EVERY_MINUTES = 30;
// A slow database must not hold up a signup form: past this, memory decides. Long enough for a compute
// waking from scale to zero, like Upstash's own default.
const QUERY_TIMEOUT_MS = 5000;
let lastReportAt = 0;
const limiters = new Map();

// Windows keep Upstash's format: "10 m", "1 h".
function windowMs(window) {
	const [amount, unit] = String(window).trim().split(/\s+/);
	return Number(amount) * (UNIT_MS[unit] ?? Number.NaN);
}

// Upstash's sliding window: the previous window's count, weighted by how much of it still overlaps,
// plus the current one. A request that would pass the limit isn't counted.
function createPostgresLimiter({ name, limit, window }) {
	const size = windowMs(window);
	return {
		async limit(key) {
			const [{ getDb }, { rateLimits }] = await Promise.all([import("./db.js"), import("./schema.js")]);
			const now = Date.now();
			const current = Math.floor(now / size);
			const weight = 1 - (now - current * size) / size;
			const id = `${name}:${key}`;
			const expiresAt = new Date((current + 2) * size).toISOString();
			const query = getDb().execute(sql`
				with counts as (
					select
						coalesce(sum(${rateLimits.count}) filter (where ${rateLimits.windowStart} = ${current - 1}::bigint), 0) as previous,
						coalesce(sum(${rateLimits.count}) filter (where ${rateLimits.windowStart} = ${current}::bigint), 0) as current
					from ${rateLimits}
					where ${rateLimits.key} = ${id} and ${rateLimits.windowStart} in (${current - 1}, ${current})
				),
				decision as (select (previous * ${weight}::float8 + current) < ${limit}::int as allowed from counts),
				counted as (
					insert into ${rateLimits} (key, window_start, count, expires_at)
					-- Parameters in a SELECT list have no type to infer from the target columns.
					select ${id}::text, ${current}::bigint, 1, ${expiresAt}::timestamptz from decision where allowed
					on conflict (key, window_start) do update set count = ${rateLimits.count} + 1
					returning 1
				)
				select allowed from decision
			`);
			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Postgres timed out")), QUERY_TIMEOUT_MS).unref?.()
			);
			const result = await Promise.race([query, timeout]);
			return { success: Boolean(result.rows[0]?.allowed) };
		},
	};
}

function getLimiter({ name, limit, window }) {
	if (!process.env.DATABASE_URL) return null;
	if (!limiters.has(name)) limiters.set(name, createPostgresLimiter({ name, limit, window }));
	return limiters.get(name);
}

export function isLimitedInMemory({ name, limit, window, key }, now = Date.now()) {
	const id = `${name}:${key}`;
	const hits = (memory.get(id) ?? []).filter((time) => now - time < windowMs(window));
	const isLimited = hits.length >= limit;
	if (!isLimited) hits.push(now);
	// Re-inserting keeps the Map in order of last use, so the oldest key goes first when it's full.
	memory.delete(id);
	memory.set(id, hits);
	if (memory.size > MAX_MEMORY_KEYS) memory.delete(memory.keys().next().value);
	return isLimited;
}

// Logged, and emailed when alerts are set up, at most every 30 minutes per server instance, so an
// outage doesn't write a line for every request.
async function reportUnavailable(name, error) {
	if (Date.now() - lastReportAt < REPORT_EVERY_MINUTES * 60_000) return;
	lastReportAt = Date.now();
	console.error(`[rate-limit] ${name} unavailable, counting in memory:`, error.message);
	try {
		// Loaded on demand: alerts need the database and SES, which counting in memory doesn't.
		const { sendAlert } = await import("./alerts.js");
		sendAlert({
			key: "rate-limit-unavailable",
			title: "Rate limiter unavailable",
			detail: `Postgres failed (${error.message}). Limits are counted in each server instance's memory until it's back.`,
			cooldownMinutes: REPORT_EVERY_MINUTES,
		}).catch(() => {});
	} catch (alertError) {
		console.error("[rate-limit] Alert failed:", alertError.message);
	}
}

export async function isRateLimited({ name, limit, window, key }, limiter = getLimiter({ name, limit, window })) {
	if (!limiter) return isLimitedInMemory({ name, limit, window, key });
	try {
		const { success, reason } = await limiter.limit(key);
		if (reason === "timeout") throw new Error("Postgres timed out");
		return !success;
	} catch (error) {
		await reportUnavailable(name, error);
		return isLimitedInMemory({ name, limit, window, key });
	}
}

// Old windows are dead weight; the sender function's cron clears them.
export async function deleteExpiredRateLimits() {
	const [{ getDb }, { rateLimits }] = await Promise.all([import("./db.js"), import("./schema.js")]);
	await getDb().execute(sql`delete from ${rateLimits} where ${rateLimits.expiresAt} < now()`);
}
