import crypto from "node:crypto";
import { isPlainObject, normalizeAddress } from "../validation.js";

// Groundmail signs each delivery with Groundmail-Signature: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "{t}.{body}">",
// keyed with the endpoint's secret as it is. Each retry is signed again, so an old timestamp is a replay.
export const MAX_SIGNATURE_AGE_SECONDS = 300;

function readSignatureHeader(header) {
	const parts = {};
	for (const part of String(header ?? "").split(",")) {
		const at = part.indexOf("=");
		if (at > 0) parts[part.slice(0, at).trim()] = part.slice(at + 1).trim();
	}
	return { timestamp: parts.t, signature: parts.v1 };
}

export function verifyGroundmailSignature({ body, header, secret, now = Date.now() }) {
	const { timestamp, signature } = readSignatureHeader(header);
	if (!secret || !/^\d{1,12}$/.test(timestamp ?? "") || !/^[0-9a-f]{64}$/i.test(signature ?? "")) return false;
	if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;
	const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
	const given = Buffer.from(signature, "hex");
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Groundmail's opens and clicks aren't mapped: MailCheap tracks its own. email.suppressed answers a send that was
// refused already (422), and email.held is followed by the email's outcome.
const EVENT_TYPES = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.delivery_delayed": "deferred",
	"email.bounced": "bounce",
	"email.complained": "complaint",
	"email.failed": "dropped",
	"contact.unsubscribed": "unsubscribe",
};

// A hard bounce whose reply says the mailbox or its domain doesn't exist. Groundmail's hard bounces also cover a
// disabled mailbox, which isn't the address's fault for good.
const UNDELIVERABLE = /\b5\.1\.(?:1|2|10)\b/;
const TENANT_PATTERN = /^mc-([a-f0-9]{24})$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

function readText(value) {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function toDate(value) {
	const date = typeof value === "string" ? new Date(value) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

// Groundmail says to treat a bounce type it doesn't name like hard. block: the receiving server refused the sender,
// and the address is fine.
function getBounceType(data) {
	return data.bounce_type === "block" ? "soft" : "hard";
}

// A tag MailCheap sent the email with (getTags in groundmail-rules.js), which Groundmail echoes on its events.
function readTag(tags, name) {
	if (!Array.isArray(tags)) return null;
	const tag = tags.find((item) => isPlainObject(item) && item.name === name);
	return typeof tag?.value === "string" && OBJECT_ID.test(tag.value) ? tag.value.toLowerCase() : null;
}

// The account an event belongs to: its tenant's (mc-<accountId>), or, for an account sending without a tenant, its
// account_id tag. Another sender's tenant, or a tag that disagrees with the tenant, names no account.
function readAccountId(tenant, tags) {
	const tagged = readTag(tags, "account_id");
	if (!tenant) return tagged;
	const fromTenant = TENANT_PATTERN.exec(tenant)?.[1].toLowerCase() ?? null;
	return fromTenant && (!tagged || tagged === fromTenant) ? fromTenant : null;
}

// Pure: one of Groundmail's webhook events in the shape every provider's events take (lib/email-event-rules.js).
// Events carry the email's tags as sent, so the message_id tag names the message even before the send's answer
// (Groundmail's email_id) is saved; email_id is the fallback. The account's tenant (mc-<accountId>) is on every
// event of an account that has one.
export function normalizeGroundmailEvent(event) {
	if (!isPlainObject(event) || !Object.hasOwn(EVENT_TYPES, event.type) || !isPlainObject(event.data)) return null;
	const { data } = event;
	const recipients = Array.isArray(data.to) ? data.to : [];
	const email = normalizeAddress(event.type === "contact.unsubscribed" ? data.email : recipients[0]);
	const tenant = readText(data.tenant);
	const recordAs = event.type.split(".")[1];
	const isFailedHard = event.type === "email.failed" && data.bounce_type === "hard";
	const type = isFailedHard ? "bounce" : EVENT_TYPES[event.type];
	const providerMessageId = readText(data.email_id);
	const reason = readText(data.bounce_reason);
	const normalized = {
		type,
		recordAs,
		accountId: readAccountId(tenant, data.tags),
		messageId: readTag(data.tags, "message_id"),
		providerMessageId,
		// One event of each kind per email: a redelivered event isn't recorded twice.
		providerEventId: providerMessageId ? `${providerMessageId}:${recordAs}` : null,
		tenant,
		email,
		emails: email ? [email] : [],
		occurredAt: toDate(event.created_at) ?? new Date(),
		isTest: data.test === true,
		data: event,
	};
	if (type === "bounce") {
		const bounce = isFailedHard ? "hard" : getBounceType(data);
		Object.assign(normalized, {
			bounce,
			// A simulated bounce never lands on the list every account shares.
			undeliverable: bounce === "hard" && !normalized.isTest && UNDELIVERABLE.test(reason ?? ""),
			reason,
			detail: `${recordAs}/${data.bounce_type ?? "hard"}`,
		});
	}
	if (type === "complaint") normalized.detail = "complaint";
	if (type === "dropped") normalized.error = `Failed at Groundmail: ${reason ?? "no reason given"}`;
	return normalized;
}
