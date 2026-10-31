import "server-only";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sendAlertIfRepeated } from "@/lib/alerts";
import { handleEmailEvent } from "@/lib/email-events";
import { normalizeResendEvent } from "@/lib/email-provider/resend-events";

const MAX_BODY_BYTES = 512 * 1024;

function reply(status, body) {
	return NextResponse.json(body, { status });
}

// The account named in the event's tags is never trusted on its own: an event only lands on an email that account sent
// (lib/email-events.js).
export async function handleResendEvent(raw, eventId) {
	return handleEmailEvent(normalizeResendEvent(raw, eventId));
}

// Delivery events of the whole team (/api/webhooks/resend), one per request, signed like Svix and checked against the raw
// body before parsing. A 5xx makes Resend retry (7 attempts over about a day); every handler is safe to replay.
export async function handleResendRequest(request) {
	const secret = process.env.RESEND_WEBHOOK_SECRET;
	if (!secret || !process.env.RESEND_API_KEY) return reply(503, { error: "Webhook is not configured" });
	const body = await request.text();
	if (Buffer.byteLength(body) > MAX_BODY_BYTES) return reply(413, { error: "Body is too large" });
	const headers = { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") };
	let event;
	try {
		event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({ payload: body, headers, webhookSecret: secret });
	} catch {
		return reply(401, { error: "Invalid signature" });
	}
	try {
		const { handled } = await handleResendEvent(event, headers.id);
		return reply(200, { ok: true, handled: handled ? 1 : 0 });
	} catch (error) {
		console.error("[resend-webhook] Could not handle the event:", error);
		await sendAlertIfRepeated("resend-webhook", {
			accountId: null,
			key: "webhook-failing:resend-webhook",
			title: "Webhook failing",
			detail: `resend-webhook couldn't handle 3 events within an hour: ${String(error?.message ?? error).slice(0, 300)}.`,
			action: "Resend retries each one 7 times over about a day; until then bounces and complaints go uncounted.",
			link: "https://resend.com/webhooks",
		});
		return reply(500, { error: "Could not handle the event" });
	}
}
