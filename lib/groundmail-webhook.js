import "server-only";
import { NextResponse } from "next/server";
import { sendAlertIfRepeated } from "@/lib/alerts";
import { connectDb } from "@/lib/db";
import { handleEmailEvent } from "@/lib/email-events";
import { normalizeGroundmailEvent, verifyGroundmailSignature } from "@/lib/email-provider/groundmail-events";
import { getTenantExternalId } from "@/lib/email-provider/groundmail-rules";
import Account from "@/models/Account";
import Message from "@/models/Message";

// Groundmail posts one event per request.
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

// Whether an event's tenant (or, without one, its account_id tag) is the message's account's own.
function isMessageAccount(event, accountId) {
	return event.tenant ? event.tenant === getTenantExternalId(accountId) : !event.accountId || event.accountId === String(accountId);
}

// The account of the message the event's message_id tag names, then of the one Groundmail's id names, if the event's
// tenant is that account's own; else the account whose tenant it is. An event never lands in an account its tenant
// doesn't belong to.
async function findEventAccountId(event) {
	if (event.messageId) {
		const message = await Message.findOne({ _id: event.messageId }).select({ accountId: 1, providerMessageId: 1 }).setOptions({ crossAccount: true }).lean();
		const sameEmail = !message?.providerMessageId || !event.providerMessageId || message.providerMessageId === event.providerMessageId;
		if (message && sameEmail) return isMessageAccount(event, message.accountId) ? message.accountId : null;
	}
	if (event.providerMessageId) {
		const message = await Message.findOne({ providerMessageId: event.providerMessageId }).select({ accountId: 1 }).setOptions({ crossAccount: true }).lean();
		if (message) return !event.tenant || event.tenant === getTenantExternalId(message.accountId) ? message.accountId : null;
	}
	if (!event.accountId) return null;
	const account = await Account.findOne({ _id: event.accountId, "groundmail.externalId": event.tenant }).select({ _id: 1 }).lean();
	return account?._id ?? null;
}

export async function handleGroundmailEvent(raw) {
	const event = normalizeGroundmailEvent(raw);
	if (!event) return { handled: false };
	await connectDb();
	const accountId = await findEventAccountId(event);
	if (!accountId) {
		if (event.type !== "sent" && event.type !== "delivered") {
			console.warn(`[groundmail-webhook] ${event.recordAs} for no known account (email ${event.providerMessageId ?? "none"})`);
		}
		return { handled: true, accountId: null };
	}
	const result = await handleEmailEvent({ ...event, accountId }, { isAccountTrusted: true });
	// Groundmail gets a 200 either way, so a message that can't be matched would otherwise go unseen.
	if (result.handled && event.providerMessageId && !result.messageId) {
		console.warn(`[groundmail-webhook] ${event.recordAs} for account ${accountId}: no message with Groundmail id ${event.providerMessageId ?? "none"}`);
	}
	return { ...result, accountId: String(accountId) };
}

// Delivery events of every tenant (/api/webhooks/groundmail). Checked against the raw bytes before parsing.
// A 5xx makes Groundmail retry (4 more times over about 5 minutes); every handler is safe to replay.
export async function handleGroundmailRequest(request) {
	const secret = process.env.GROUNDMAIL_WEBHOOK_SECRET;
	if (!secret) return reply(503, { error: "Webhook is not configured" });
	const body = Buffer.from(await request.arrayBuffer());
	if (body.length > MAX_BODY_BYTES) return reply(413, { error: "Body is too large" });
	if (!verifyGroundmailSignature({ body, header: request.headers.get("groundmail-signature"), secret })) {
		return reply(401, { error: "Invalid signature" });
	}

	const event = parseJson(body.toString("utf8"));
	if (!event || typeof event !== "object" || Array.isArray(event)) return reply(400, { error: "Expected an event" });
	try {
		const { handled } = await handleGroundmailEvent(event);
		return reply(200, { ok: true, handled: handled ? 1 : 0 });
	} catch (error) {
		console.error("[groundmail-webhook] Could not handle the event:", error);
		await sendAlertIfRepeated("groundmail-webhook", {
			accountId: null,
			key: "webhook-failing:groundmail-webhook",
			title: "Webhook failing",
			detail: `groundmail-webhook couldn't handle 3 events within an hour: ${String(error?.message ?? error).slice(0, 300)}.`,
			action: "Groundmail retries each one 4 more times over about 5 minutes; after that, bounces and complaints go uncounted.",
			link: "https://app.groundmail.dev/webhooks",
		});
		return reply(500, { error: "Could not handle the event" });
	}
}
