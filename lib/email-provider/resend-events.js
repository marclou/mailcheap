import { isObjectIdString, isPlainObject, normalizeAddress } from "../validation.js";

const EVENT_TYPES = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.delivery_delayed": "deferred",
	"email.bounced": "bounce",
	"email.complained": "complaint",
	"email.suppressed": "dropped",
	"email.failed": "dropped",
};

// Hard bounces of an address that doesn't exist: NoEmail, or Suppressed, one that bounced as invalid before.
const UNDELIVERABLE_SUBTYPES = new Set(["NoEmail", "Suppressed"]);

function readText(value) {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function readTag(tags, name) {
	const value = isPlainObject(tags) && Object.hasOwn(tags, name) ? tags[name] : null;
	return isObjectIdString(value) ? value.toLowerCase() : null;
}

function toDate(value) {
	const date = value ? new Date(value) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

// Pure: one Resend webhook event in the shape every provider's events take (lib/email-event-rules.js). The account and
// message come from the tags every send carries; eventId is the delivery's webhook-id, the same on each retry.
export function normalizeResendEvent(event, eventId = null) {
	if (!isPlainObject(event) || !Object.hasOwn(EVENT_TYPES, event.type) || !isPlainObject(event.data)) return null;
	const { data } = event;
	const email = normalizeAddress(Array.isArray(data.to) ? data.to[0] : null);
	const normalized = {
		type: EVENT_TYPES[event.type],
		recordAs: event.type.replace(/^email\./, ""),
		accountId: readTag(data.tags, "account_id"),
		messageId: readTag(data.tags, "message_id"),
		providerMessageId: readText(data.email_id),
		providerEventId: readText(eventId),
		email,
		emails: email ? [email] : [],
		occurredAt: toDate(event.created_at) ?? toDate(data.created_at) ?? new Date(),
		data: event,
	};
	if (event.type === "email.bounced") {
		const bounce = isPlainObject(data.bounce) ? data.bounce : {};
		const isHard = bounce.type === "Permanent";
		Object.assign(normalized, {
			bounce: isHard ? "hard" : "soft",
			undeliverable: isHard && UNDELIVERABLE_SUBTYPES.has(bounce.subType),
			reason: [readText(bounce.subType), readText(bounce.message)].filter(Boolean).join(", ") || null,
			detail: `${readText(bounce.type) ?? "Bounce"}/${readText(bounce.subType) ?? "General"}`,
		});
	}
	// The team's suppression list is every account's: another account's bounce or complaint doesn't become this
	// account's suppression, only this email's failure.
	if (event.type === "email.suppressed") {
		normalized.error = `Suppressed by Resend: ${readText(data.suppressed?.message) ?? readText(data.suppressed?.type) ?? "no reason given"}`;
		normalized.suppressed = false;
	}
	if (event.type === "email.failed") normalized.error = `Failed at Resend: ${readText(data.failed?.reason) ?? "no reason given"}`;
	return normalized;
}
