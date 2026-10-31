import crypto from "node:crypto";
import { isPlainObject, normalizeAddress } from "../validation.js";

// SendHQ signs each delivery the Standard Webhooks way: webhook-signature is "v1,<base64 HMAC-SHA256 of
// {webhook-id}.{webhook-timestamp}.{body}>", keyed with the bytes of the secret after whsec_, several of them space
// separated while a secret rotates. Each retry is signed again, so an old timestamp is a replay.
export const MAX_SIGNATURE_AGE_SECONDS = 300;

export function verifySendhqSignature({ body, id, timestamp, signature, secret, now = Date.now() }) {
	if (!secret || typeof id !== "string" || !id || typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp)) return false;
	if (typeof signature !== "string" || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
	return signature.split(" ").some((entry) => {
		if (!entry.startsWith("v1,")) return false;
		const given = Buffer.from(entry.slice(3), "base64");
		return given.length === expected.length && crypto.timingSafeEqual(given, expected);
	});
}

const EVENT_TYPES = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.delivery_delayed": "deferred",
	"email.bounced": "bounce",
	"email.complained": "complaint",
	"email.failed": "dropped",
};

// SES's hard bounce subtypes, which SendHQ passes on. NoEmail: the address doesn't exist. Suppressed: it bounced as
// that before, anywhere.
const UNDELIVERABLE_SUBTYPES = new Set(["NoEmail", "Suppressed"]);
// The sending account's own list at SendHQ's provider, shared by everyone sending there: never this account's
// suppression, only this email's failure.
const SHARED_LIST_SUBTYPE = "OnAccountSuppressionList";

function readText(value) {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function toDate(value) {
	const date = value ? new Date(value) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

function readRecipient(data) {
	return normalizeAddress(data.recipient ?? (Array.isArray(data.recipients) ? data.recipients[0] : null) ?? (Array.isArray(data.to) ? data.to[0] : data.to));
}

// Pure: one SendHQ webhook event in the shape every provider's events take (lib/email-event-rules.js). SendHQ's
// events carry no tags, so the account is the one whose email has this SendHQ id (lib/sendhq-webhook.js); eventId is the
// delivery's webhook-id, the same on each retry.
export function normalizeSendhqEvent(event, eventId = null) {
	if (!isPlainObject(event) || !Object.hasOwn(EVENT_TYPES, event.type) || !isPlainObject(event.data)) return null;
	const { data } = event;
	const email = readRecipient(data);
	const normalized = {
		type: EVENT_TYPES[event.type],
		recordAs: event.type.replace(/^email\./, ""),
		accountId: null,
		messageId: null,
		providerMessageId: readText(data.email_id),
		providerEventId: readText(eventId),
		email,
		emails: email ? [email] : [],
		occurredAt: toDate(event.created_at) ?? new Date(),
		data: event,
	};
	if (event.type === "email.bounced") {
		const bounce = isPlainObject(data.bounce) ? data.bounce : {};
		const subType = readText(bounce.sub_type);
		if (bounce.type === "Permanent" && subType === SHARED_LIST_SUBTYPE) {
			return { ...normalized, type: "dropped", suppressed: false, error: "Suppressed by SendHQ's provider: an earlier email to it bounced or was marked as spam" };
		}
		const isHard = bounce.type === "Permanent";
		Object.assign(normalized, {
			bounce: isHard ? "hard" : "soft",
			undeliverable: isHard && UNDELIVERABLE_SUBTYPES.has(subType),
			reason: [subType, readText(bounce.diagnostic)].filter(Boolean).join(", ") || null,
			detail: `${readText(bounce.type) ?? "Bounce"}/${subType ?? "General"}`,
		});
	}
	if (event.type === "email.complained") normalized.feedback = readText(data.complaint?.feedback_type);
	// The receiving server's words when there are some, which say when Gmail rate limits the sender.
	if (event.type === "email.delivery_delayed") normalized.reason = readText(data.delay?.diagnostic) ?? readText(data.delay?.type);
	if (event.type === "email.failed") normalized.error = `Failed at SendHQ: ${readText(data.reason) ?? "no reason given"}`;
	return normalized;
}
