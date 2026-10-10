import { NextResponse } from "next/server";
import { handleSparkLoopEvent, isConnectedWebhook } from "@/lib/sparkloop-webhook";
import { isPlainObject } from "@/lib/validation";

const MAX_BODY_LENGTH = 64 * 1024;

// SparkLoop retries anything but a 2xx for up to 21 days, so only a wrong URL, a flood or a failure
// answers otherwise. Events it isn't about are logged, so a missing kind of referral shows up.
export async function POST(request, { params }) {
	if (!(await isConnectedWebhook((await params).token))) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const body = await request.text();
	if (body.length > MAX_BODY_LENGTH) return NextResponse.json({ error: "Too large" }, { status: 413 });
	let event = null;
	try {
		event = JSON.parse(body);
	} catch {
		event = null;
	}
	if (!isPlainObject(event)) return new NextResponse(null, { status: 200 });

	try {
		const result = await handleSparkLoopEvent(event);
		if (result.limited) return NextResponse.json({ error: "Too many referrals, try later" }, { status: 429 });
		if (result.skip) console.info(`[sparkloop-webhook] ${String(event.type).slice(0, 60)} skipped: ${result.skip}`);
		return new NextResponse(null, { status: 200 });
	} catch (error) {
		console.error("[sparkloop-webhook] Failed:", error);
		return NextResponse.json({ error: "Failed" }, { status: 500 });
	}
}
