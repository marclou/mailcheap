"use server";

import { revalidatePath } from "next/cache";
import { runAccountAction, toFormError } from "@/lib/actions/dashboard";

// Keys and connected apps are the user's own account's, whichever newsletter is open.
export async function createApiKey(_state, formData) {
	const { output, failure } = await runAccountAction("create_api_key", {
		name: String(formData.get("name") ?? "").slice(0, 60),
		level: formData.get("level") === "signups" ? "signups" : "full",
	});
	if (failure) return toFormError(failure);
	revalidatePath("/api-keys");
	return { key: output.key, level: output.apiKey.level };
}

export async function revokeApiKey(id) {
	const { failure } = await runAccountAction("revoke_api_key", { id: String(id) });
	revalidatePath("/api-keys");
	return failure ? toFormError(failure) : { ok: true };
}

export async function revokeConnectedApp(id) {
	const { failure } = await runAccountAction("revoke_connected_app", { id: String(id) });
	revalidatePath("/api-keys");
	return failure ? toFormError(failure) : { ok: true };
}
