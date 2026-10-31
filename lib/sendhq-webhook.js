import "server-only";
import { NextResponse } from "next/server";
import { sendAlertIfRepeated } from "@/lib/alerts";
import { connectDb } from "@/lib/db";
import { handleEmailEvent } from "@/lib/email-events";
import { normalizeSendhqEvent, verifySendhqSignature } from "@/lib/email-provider/sendhq-events";
import Message from "@/models/Message";

const MAX_BODY_BYTES = 512 * 1024;

function reply(status, body) {
	return NextResponse.json(body, { status });
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

// SendHQ's events carry no tags, only its own email id, which no two emails share: the event lands in the account
// whose email has it, and nowhere else. An id MailCheap never saved changes nothing.
async function findEventAccountId(providerMessageId) {
	if (!providerMessageId) return null;
	const message = await Message.findOne({ providerMessageId }).select({ accountId: 1 }).setOptions({ crossAccount: true }).lean();
	return message?.accountId ?? null;
}

export async function handleSendhqEvent(raw, eventId) {
	const event = normalizeSendhqEvent(raw, eventId);
	if (!event) return { handled: false };
	await connectDb();
	const accountId = await findEventAccountId(event.providerMessageId);
	if (!accountId) {
		if (event.type !== "sent" && event.type !== "delivered") {
			console.warn(`[sendhq-webhook] ${event.recordAs} for no known email (${event.providerMessageId ?? "no id"})`);
		}
		return { handled: true, accountId: null };
	}
	return { ...(await handleEmailEvent({ ...event, accountId })), accountId: String(accountId) };
}

// Delivery events of the whole workspace (/api/webhooks/sendhq), one per request, checked against the raw body before
// parsing. A non-2xx makes SendHQ retry (8 attempts over about a day); every handler is safe to replay.
export async function handleSendhqRequest(request) {
	const secret = process.env.SENDHQ_WEBHOOK_SECRET;
	if (!secret) return reply(503, { error: "Webhook is not configured" });
	const body = Buffer.from(await request.arrayBuffer());
	if (body.length > MAX_BODY_BYTES) return reply(413, { error: "Body is too large" });
	const id = request.headers.get("webhook-id");
	const isSigned = verifySendhqSignature({
		body,
		id,
		timestamp: request.headers.get("webhook-timestamp"),
		signature: request.headers.get("webhook-signature"),
		secret,
	});
	if (!isSigned) return reply(401, { error: "Invalid signature" });

	const event = parseJson(body.toString("utf8"));
	if (!event) return reply(400, { error: "Expected an event" });
	try {
		const { handled } = await handleSendhqEvent(event, id);
		return reply(200, { ok: true, handled: handled ? 1 : 0 });
	} catch (error) {
		console.error("[sendhq-webhook] Could not handle the event:", error);
		await sendAlertIfRepeated("sendhq-webhook", {
			accountId: null,
			key: "webhook-failing:sendhq-webhook",
			title: "Webhook failing",
			detail: `sendhq-webhook couldn't handle 3 events within an hour: ${String(error?.message ?? error).slice(0, 300)}.`,
			action: "SendHQ retries each one 8 times over about a day; until then bounces and complaints go uncounted.",
			link: "https://sendhq.cc",
		});
		return reply(500, { error: "Could not handle the event" });
	}
}
