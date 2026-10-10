"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateApiKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { getDb } from "@/lib/db";
import { notifyActivity } from "@/lib/notify-activity";
import { apiKeys } from "@/lib/schema";
import { isIdString } from "@/lib/validation";

export async function createApiKey(_state, formData) {
	await requireSession();
	const name = String(formData.get("name") ?? "")
		.trim()
		.slice(0, 60);
	if (!name) return { error: "Name is required" };

	const { key, prefix, hash } = generateApiKey();
	await getDb().insert(apiKeys).values({ name, prefix, hash });
	await notifyActivity([`API key created: ${name}`, `${getAppUrl()}/api-keys`]);

	revalidatePath("/api-keys");
	return { key };
}

export async function revokeApiKey(id) {
	await requireSession();
	if (!isIdString(id)) return { error: "Key not found" };

	await getDb()
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys._id, id), isNull(apiKeys.revokedAt)));

	revalidatePath("/api-keys");
	return { ok: true };
}
