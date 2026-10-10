import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@neon/functions";
import { parseTriggerDelivery } from "@neon/functions/triggers";
import { Hono } from "hono";
import { getAppUrl } from "../lib/config.js";
import { handleResendWebhook } from "../lib/resend-webhook.js";
import { drainQueue, runTick } from "../lib/sender.js";

// The sender: sends queued campaign emails through SES next to the database, and starts scheduled
// sends. It replaces QStash. Two callers:
// - the "sender-tick" cron trigger, every minute (POST /tick, verified by parseTriggerDelivery)
// - the dashboard, right after a send starts (POST /drain, with the shared SENDER_SECRET)
// It also takes Resend's webhooks (POST /webhooks/resend, signed with RESEND_WEBHOOK_SECRET).
// Both answer at once and work in waitUntil (up to 15 minutes); a lease keeps one drain at a time.
const secret = process.env.SENDER_SECRET;

function hasSecret(request) {
	const header = request.headers.get("x-secret");
	if (!secret || header === null) return false;
	const provided = Buffer.from(header);
	const expected = Buffer.from(secret);
	return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

// The app caches archive pages, so a scheduled issue that just went out needs them refreshed.
async function revalidateApp(campaignIds) {
	if (!secret) return;
	try {
		const response = await fetch(`${getAppUrl()}/api/revalidate`, {
			method: "POST",
			headers: { "x-secret": secret, "content-type": "application/json" },
			body: JSON.stringify({ campaignIds }),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) console.error(`[sender] Revalidate answered ${response.status}`);
	} catch (error) {
		console.error("[sender] Revalidate failed:", error.message);
	}
}

function inBackground(label, work) {
	waitUntil(
		work()
			.then((result) => console.info(`[sender] ${label}: ${JSON.stringify(result)}`))
			.catch((error) => console.error(`[sender] ${label} failed:`, error))
	);
}

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "mailcheap sender" }));

app.post("/tick", async (c) => {
	const parsed = await parseTriggerDelivery(c.req.raw);
	if (!parsed.ok) return c.text(parsed.error, parsed.error === "invalid_body" ? 400 : 401);
	inBackground("tick", () => runTick({ onStarted: revalidateApp }));
	return c.json({ accepted: true }, 202);
});

app.post("/drain", async (c) => {
	if (!hasSecret(c.req.raw)) return c.text("Unauthorized", 401);
	inBackground("drain", () => drainQueue());
	return c.json({ accepted: true }, 202);
});

app.post("/webhooks/resend", (c) => handleResendWebhook(c.req.raw));

export default app;
