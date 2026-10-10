import crypto from "node:crypto";

// Resend signs webhooks the Svix way: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" with the
// base64 key after "whsec_", sent as one or more "v1,<base64 signature>" in svix-signature.
const TOLERANCE_SECONDS = 5 * 60;

function signingKey(secret) {
	const value = String(secret ?? "");
	return Buffer.from(value.startsWith("whsec_") ? value.slice("whsec_".length) : value, "base64");
}

export function signWebhook({ secret, id, timestamp, body }) {
	return crypto.createHmac("sha256", signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

// A timestamp more than 5 minutes off is refused, so a captured request can't be replayed later.
export function verifyWebhook({ secret, headers, body, now = Date.now() }) {
	const id = headers.get("svix-id");
	const timestamp = headers.get("svix-timestamp");
	const signatures = headers.get("svix-signature");
	if (!secret || !id || !timestamp || !signatures || typeof body !== "string") return false;

	const seconds = Number(timestamp);
	if (!Number.isInteger(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

	const expected = Buffer.from(signWebhook({ secret, id, timestamp, body }));
	return signatures.split(" ").some((entry) => {
		const [version, signature] = entry.split(",");
		if (version !== "v1" || !signature) return false;
		const provided = Buffer.from(signature);
		return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
	});
}
