import crypto from "node:crypto";
import { getAppSecret } from "./config.js";
import { isObjectIdString } from "./validation.js";

// A contacts export link: the account and its filters, signed, for an hour. base64url JSON + "." + HMAC.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,1200}\.[A-Za-z0-9_-]{43}$/;
export const EXPORT_LINK_MS = 60 * 60 * 1000;

function sign(payload) {
	const key = Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", "mailcheap-contacts-export-v1", 32));
	return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createExportToken({ accountId, newsletterId, status, query, segmentId, tag }, now = Date.now()) {
	const data = { a: String(accountId), e: Math.floor((now + EXPORT_LINK_MS) / 1000) };
	if (newsletterId) data.n = String(newsletterId);
	if (status) data.s = status;
	if (query) data.q = query;
	if (segmentId) data.g = String(segmentId);
	if (tag) data.t = tag;
	const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
	return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(data.e * 1000) };
}

export function verifyExportToken(token, now = Date.now()) {
	if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
	const [payload, signature] = token.split(".");
	const expected = Buffer.from(sign(payload));
	const provided = Buffer.from(signature);
	if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
	try {
		const { a, e, n, s, q, g, t } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (!isObjectIdString(a) || !Number.isInteger(e) || e * 1000 < now) return null;
		if (n !== undefined && !isObjectIdString(n)) return null;
		if (g !== undefined && !isObjectIdString(g)) return null;
		return {
			accountId: a,
			newsletterId: n ?? null,
			status: typeof s === "string" ? s : null,
			query: typeof q === "string" ? q : "",
			segmentId: g ?? null,
			tag: typeof t === "string" ? t : null,
		};
	} catch {
		return null;
	}
}
