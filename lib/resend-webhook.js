import { handleResendEvent } from "./email-events.js";
import { verifyWebhook } from "./svix.js";
import { isPlainObject } from "./validation.js";

// Resend webhooks: one handler for the app (/api/webhooks/resend) and the sender function
// (/webhooks/resend), whichever URL the Resend webhook points at.
const MAX_BODY_LENGTH = 512 * 1024;

function reply(status, body) {
	return Response.json(body, { status });
}

export async function handleResendWebhook(request) {
	const secret = process.env.RESEND_WEBHOOK_SECRET;
	if (!secret) return reply(503, { error: "Resend webhook is not configured (RESEND_WEBHOOK_SECRET)" });

	const body = await request.text();
	if (body.length > MAX_BODY_LENGTH) return reply(413, { error: "Body is too large" });
	if (!verifyWebhook({ secret, headers: request.headers, body })) return reply(400, { error: "Invalid signature" });

	let event;
	try {
		event = JSON.parse(body);
	} catch {
		return reply(400, { error: "Invalid JSON" });
	}
	if (!isPlainObject(event)) return reply(400, { error: "Invalid JSON" });

	try {
		const { handled } = await handleResendEvent(event);
		return reply(200, { ok: true, ...(!handled && { ignored: true }) });
	} catch (error) {
		// A 5xx makes Resend retry, and replaying the handler is safe.
		console.error("[resend-webhook] Could not handle the event:", error);
		return reply(500, { error: "Could not handle the event" });
	}
}
