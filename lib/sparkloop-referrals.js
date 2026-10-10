import crypto from "node:crypto";
import { normalizeEmail } from "./validation.js";

// Readers who join a newsletter through SparkLoop (another newsletter's signup flow, the recommendations
// hub) never see its forms: SparkLoop posts them to the webhook, as it would to any custom ESP. Kept apart
// from lib/sparkloop-webhook.js so tests can import it.
export const WEBHOOK_EVENTS = ["new_partner_pending_referral", "new_partner_referral"];

// The webhook URL carries a random token, made when it's registered. Only its hash is stored, so a
// database dump can't post referrals, and disconnecting turns the URL off.
export function createWebhookToken() {
	const token = crypto.randomBytes(24).toString("base64url");
	return { token, hash: hashWebhookToken(token) };
}

export function hashWebhookToken(token) {
	return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function isWebhookToken(token, hash) {
	if (!hash || !token) return false;
	const expected = Buffer.from(hash);
	const provided = Buffer.from(hashWebhookToken(token));
	return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

// The reader and the SparkLoop publication they joined, or why the event is ignored. A referral only
// ever joins the newsletter linked to that exact publication: the account's other publications may send
// from another platform.
export function readReferral(event) {
	if (!WEBHOOK_EVENTS.includes(event?.type)) return { skip: "event" };
	const email = normalizeEmail(event.subscriber?.email);
	if (!email) return { skip: "email" };
	const publicationUuid = event.campaign?.publication_id;
	if (typeof publicationUuid !== "string" || !publicationUuid) return { skip: "publication" };
	return { email, publicationUuid };
}
