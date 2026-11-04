const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
// Dot-atom local part and hostname labels: rejects quoted strings, commas, display names and doubled dots. Domain
// endings are letters, or xn-- for internationalized ones: none has a digit.
const EMAIL_PATTERN =
	/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/;

export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
// Issue bodies from the API and the editor. Archive pages clean them on each render.
export const MAX_BODY_BYTES = 500_000;

// What's wrong with an issue's body for its size, or null.
export function getBodySizeProblem(body) {
	const bytes = new TextEncoder().encode(body).length;
	return bytes > MAX_BODY_BYTES ? `The content is ${Math.ceil(bytes / 1000)} KB. The limit is ${MAX_BODY_BYTES / 1000} KB.` : null;
}

// Where to go after signing in: a path on this site, with at most a plain query string (?plan=growth&interval=year).
const NEXT_PATH_PATTERN = /^\/(?!\/)[\w\-/]*(\?[\w\-=&]*)?$/;

export function toSafeNextPath(value) {
	return typeof value === "string" && NEXT_PATH_PATTERN.test(value) ? value : "/";
}

export function isObjectIdString(value) {
	return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
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
