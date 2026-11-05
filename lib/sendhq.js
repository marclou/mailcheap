import "server-only";

// Every call to SendHQ lives in this file, like lib/postshiba.js holds every PostShiba call. Tests answer them with a
// mocked fetch. SendHQ answers errors as { error: { message, status, code } }: code, when there is one, goes in
// providerCode.
const API_URL = "https://sendhq.cc/api/v1";
const TIMEOUT_MS = 10_000;
// A send waits for SendHQ to hand the email over.
const SEND_TIMEOUT_MS = 20_000;

export function getSendhqConfig(env = process.env) {
	const apiKey = String(env.SENDHQ_API_KEY ?? "").trim();
	if (!apiKey) throw new Error("SendHQ is not configured (SENDHQ_API_KEY)");
	return { apiKey, apiUrl: (env.SENDHQ_API_URL || API_URL).trim().replace(/\/+$/, "") };
}

function readRetryAfter(headers) {
	const seconds = Number.parseInt(headers?.get("retry-after") ?? "", 10);
	return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

function sendhqError({ label, status = null, body = null, headers, cause }) {
	const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 300) : typeof body === "string" ? body.slice(0, 200) : "";
	const providerCode = typeof body?.error?.code === "string" ? body.error.code : null;
	const answer = status ? String(status) : cause?.name === "TimeoutError" ? "timed out" : "no answer";
	return Object.assign(new Error(`SendHQ ${label}: ${answer}${detail ? ` (${detail})` : ""}`), {
		name: "SendhqError",
		status,
		providerCode,
		detail,
		retryAfter: readRetryAfter(headers),
		isTimeout: cause?.name === "TimeoutError",
		cause,
	});
}

async function readBody(response) {
	if (response.status === 204) return null;
	const text = await response.text().catch(() => "");
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return text;
	}
}

async function call(path, { label, method = "GET", body, idempotencyKey, timeoutMs = TIMEOUT_MS }) {
	const { apiKey, apiUrl } = getSendhqConfig();
	let response;
	try {
		response = await fetch(`${apiUrl}${path}`, {
			method,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
				...(body !== undefined && { "Content-Type": "application/json" }),
				...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (cause) {
		throw sendhqError({ label, cause });
	}
	const data = await readBody(response);
	if (!response.ok) throw sendhqError({ label, status: response.status, body: data, headers: response.headers });
	return data;
}

const domainPath = (id) => `/domains/${encodeURIComponent(id)}`;

export function createDomain(name) {
	return call("/domains", { label: "add domain", method: "POST", body: { name } });
}

export function getDomain(id) {
	return call(domainPath(id), { label: "read domain" });
}

export function verifyDomain(id) {
	return call(`${domainPath(id)}/verify`, { label: "verify domain", method: "POST" });
}

export function deleteDomain(id) {
	return call(domainPath(id), { label: "remove domain", method: "DELETE" });
}

// The same Idempotency-Key with the same body answers the first send again; with another body, 409.
export function sendEmail(email, { idempotencyKey } = {}) {
	return call("/emails", { label: "send", method: "POST", body: email, idempotencyKey, timeoutMs: SEND_TIMEOUT_MS });
}
