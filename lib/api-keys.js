import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { hashApiKey, readBearerToken, shouldTouchLastUsed } from "./api-key-tokens.js";
import { getDb } from "./db.js";
import { toRecord } from "./rows.js";
import { apiKeys } from "./schema.js";

export { generateApiKey, hashApiKey } from "./api-key-tokens.js";

export async function authenticateRequest(request) {
	const key = readBearerToken(request.headers.get("authorization"));
	if (!key) return null;

	const [row] = await getDb()
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.hash, hashApiKey(key)), isNull(apiKeys.revokedAt)));
	const apiKey = toRecord(row);
	if (!apiKey) return null;

	const now = new Date();
	if (shouldTouchLastUsed(apiKey.lastUsedAt, now.getTime())) {
		await getDb()
			.update(apiKeys)
			.set({ lastUsedAt: now })
			.where(eq(apiKeys._id, apiKey._id))
			.catch((error) => console.error("[api-keys] Could not update lastUsedAt:", error.message));
	}
	return apiKey;
}
