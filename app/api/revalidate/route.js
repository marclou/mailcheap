import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { revalidateArchive } from "@/lib/archive-data";
import { isIdString } from "@/lib/validation";

// The sender Neon Function calls this after it starts scheduled sends: their archive pages and the
// campaign lists change. Only the shared SENDER_SECRET gets in.
function hasSecret(request) {
	const secret = process.env.SENDER_SECRET;
	const header = request.headers.get("x-secret");
	if (!secret || header === null) return false;
	const provided = Buffer.from(header);
	const expected = Buffer.from(secret);
	return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

export async function POST(request) {
	if (!hasSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const body = await request.json().catch(() => null);
	const campaignIds = Array.isArray(body?.campaignIds) ? body.campaignIds.filter(isIdString).slice(0, 100) : [];

	revalidatePath("/campaigns");
	for (const id of campaignIds) revalidatePath(`/campaigns/${id}`);
	revalidateArchive();
	return NextResponse.json({ ok: true, revalidated: campaignIds.length });
}
