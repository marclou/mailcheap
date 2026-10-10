// Record ids: 24 hex characters, the same shape as the MongoDB ObjectIds in links already sent (lib/ids.js).
const ID_PATTERN = /^[a-f0-9]{24}$/i;
// Dot-atom local part and hostname labels: rejects quoted strings, commas, and display names.
const EMAIL_PATTERN =
	/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
// Issue bodies from the API and the editor. Archive pages clean them on each render.
export const MAX_BODY_BYTES = 500_000;

export function isIdString(value) {
	return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeEmail(value) {
	if (typeof value !== "string") return null;
	const email = value.trim().toLowerCase();
	if (email.length > MAX_EMAIL_LENGTH || email.indexOf("@") > MAX_LOCAL_PART_LENGTH) return null;
	return EMAIL_PATTERN.test(email) ? email : null;
}

// "Dana <dana@example.com>" or a bare address, as mail headers and SES events give them.
export function normalizeAddress(value) {
	const match = /<([^<>]+)>\s*$/.exec(String(value ?? ""));
	return normalizeEmail(match ? match[1] : value);
}
