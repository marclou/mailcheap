"use server";

import { headers } from "next/headers";
import { keepContact } from "@/lib/contacts";
import { verifyKeepToken } from "@/lib/last-chance";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

// People click from home and office networks; a shared one still fits several readers.
const PER_IP = { name: "keep-ip", limit: 20, window: "10 m" };

export async function keepSending(token) {
	if (await isRateLimited({ ...PER_IP, key: getClientIp(await headers()) })) return { error: "busy" };
	const reference = verifyKeepToken(token);
	if (!reference) return { error: "invalid" };

	const contact = await keepContact(reference);
	return contact ? { ok: true } : { error: "invalid" };
}
