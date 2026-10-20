import crypto from "node:crypto";
import { getAppSecret } from "./config.js";
import { getHost } from "./signup-form.js";

// A person needs a moment to type an address; a script posts as soon as the page loads. A page left open longer than a
// day asks for a reload, so a token can't be kept and replayed for long.
export const MIN_FILL_MS = 2000;
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DONE_AGE_MS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,2000}\.[A-Za-z0-9_-]{43}$/;

function getSigningKey(info) {
	return Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", info, 32));
}

function sign(info, payload) {
	return crypto.createHmac("sha256", getSigningKey(info)).update(payload).digest("base64url");
}

function seal(info, data) {
	const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
	return `${payload}.${sign(info, payload)}`;
}

function unseal(info, value) {
	if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return null;
	const [payload, signature] = value.split(".");
	const expected = Buffer.from(sign(info, payload));
	const provided = Buffer.from(signature);
	if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

// Rendered into the framed form (lib/signup-form.js): which newsletter, the page that holds it and when it loaded.
export function createFormToken({ newsletterId, origin }, now = Date.now()) {
	return seal("signup-form", { n: String(newsletterId), o: origin ?? "", t: now });
}

// The page's origin and how long ago the form loaded, or null for another form's token or one that was changed.
export function readFormToken(token, { newsletterId, now = Date.now() }) {
	const data = unseal("signup-form", token);
	if (!data || data.n !== String(newsletterId) || !Number.isInteger(data.t)) return null;
	return { origin: typeof data.o === "string" ? data.o : "", age: now - data.t };
}

// Where the plain HTML form lands after posting: what happened, sealed so the page only ever says what the form did.
// result: pending, subscribed or error. back: the page that held the form.
export function createDoneToken({ result, message = null, inbox = null, back = null }, now = Date.now()) {
	return seal("signup-form-done", { r: result, m: message, i: inbox, b: back, t: now });
}

export function readDoneToken(value, now = Date.now()) {
	const data = unseal("signup-form-done", value);
	if (!data || !["pending", "subscribed", "error"].includes(data.r) || !Number.isInteger(data.t)) return null;
	if (now - data.t > MAX_DONE_AGE_MS) return null;
	return { result: data.r, message: data.m ?? null, inbox: data.i ?? null, back: getHost(data.b) ? data.b : null };
}
