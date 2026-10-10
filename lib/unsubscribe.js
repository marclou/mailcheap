import crypto from "node:crypto";
import { getAppUrl } from "./config.js";
import { isIdString } from "./validation.js";

// base64url JSON payload + "." + base64url HMAC-SHA256 (always 43 characters)
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9_-]{43}$/;

// Rotating SESSION_SECRET invalidates every unsubscribe link in already-sent emails.
function getSigningKey() {
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error("SESSION_SECRET is required to sign unsubscribe links");
	return Buffer.from(crypto.hkdfSync("sha256", secret, "", "mailcheap-unsubscribe-v1", 32));
}

function sign(payload) {
	return crypto.createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
}

function isValidReference({ contactId, newsletterId }) {
	return isIdString(contactId) && isIdString(newsletterId);
}

// Tokens never expire: links in old emails must keep working (CAN-SPAM requires at least 30 days).
export function createUnsubscribeToken({ contactId, newsletterId }) {
	const reference = {
		contactId: String(contactId ?? "").toLowerCase(),
		newsletterId: String(newsletterId ?? "").toLowerCase(),
	};
	if (!isValidReference(reference)) throw new Error("Invalid unsubscribe reference");

	const payload = Buffer.from(
		JSON.stringify({ c: reference.contactId, n: reference.newsletterId })
	).toString("base64url");
	return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token) {
	if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;

	const [payload, signature] = token.split(".");
	const expected = Buffer.from(sign(payload));
	const provided = Buffer.from(signature);
	if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
		return null;
	}

	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
		if (!Object.hasOwn(data, "c") || !Object.hasOwn(data, "n")) return null;
		const reference = { contactId: data.c, newsletterId: data.n };
		return isValidReference(reference) ? reference : null;
	} catch {
		return null;
	}
}

export function getUnsubscribeLinks({ contactId, newsletterId }) {
	const appUrl = getAppUrl();
	const query = `token=${createUnsubscribeToken({ contactId, newsletterId })}`;
	return {
		pageUrl: `${appUrl}/unsubscribe?${query}`,
		headers: {
			"List-Unsubscribe": `<${appUrl}/api/unsubscribe?${query}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	};
}
