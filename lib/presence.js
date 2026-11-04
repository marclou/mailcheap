import { Redis } from "@upstash/redis";

// Who's on a team's draft right now (app/api/campaigns/[id]/presence): each browser there says where its person is
// every few seconds, and someone it hasn't heard from in PRESENCE_TTL_MS has left. In Upstash Redis when it's set up,
// so every server instance sees everyone; else, or while it's down, in this instance's memory.
export const PRESENCE_TTL_MS = 10_000;
const KEY_TTL_SECONDS = 60;
const MAX_MEMORY_DRAFTS = 2_000;
const memory = new Map();
let redis;

function getRedis() {
	const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
	if (!url || !token) return null;
	redis ??= new Redis({ url, token });
	return redis;
}

function getKey(campaignId) {
	return `mailcheap/presence/${campaignId}`;
}

function readFresh(values, now) {
	return Object.values(values ?? {})
		.map((value) => (typeof value === "string" ? JSON.parse(value) : value))
		.filter((entry) => entry && now - entry.at < PRESENCE_TTL_MS);
}

function updateInMemory(campaignId, entry, now) {
	const draft = memory.get(campaignId) ?? {};
	memory.delete(campaignId);
	if (entry) draft[entry.id] = entry;
	const fresh = Object.fromEntries(Object.entries(draft).filter(([, { at }]) => now - at < PRESENCE_TTL_MS));
	if (Object.keys(fresh).length > 0) memory.set(campaignId, fresh);
	if (memory.size > MAX_MEMORY_DRAFTS) memory.delete(memory.keys().next().value);
	return Object.values(fresh);
}

// Saves where entry's person is and answers everyone on the draft, them included.
export async function updatePresence(campaignId, entry, now = Date.now()) {
	const client = getRedis();
	if (!client) return updateInMemory(campaignId, entry, now);
	try {
		const key = getKey(campaignId);
		const [, , values] = await client
			.pipeline()
			.hset(key, { [entry.id]: JSON.stringify(entry) })
			.expire(key, KEY_TTL_SECONDS)
			.hgetall(key)
			.exec();
		return readFresh(values, now);
	} catch (error) {
		console.error("[presence] Redis unavailable, in memory:", error.message);
		return updateInMemory(campaignId, entry, now);
	}
}

export async function removePresence(campaignId, userId) {
	const draft = memory.get(campaignId);
	if (draft) delete draft[userId];
	if (draft && Object.keys(draft).length === 0) memory.delete(campaignId);
	const client = getRedis();
	if (!client) return;
	try {
		await client.hdel(getKey(campaignId), userId);
	} catch (error) {
		console.error("[presence] Redis unavailable:", error.message);
	}
}
