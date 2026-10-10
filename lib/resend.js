import "server-only";
import { isSendingEnabled } from "./config.js";
import { toDomainStatus, toResendFrom } from "./resend-format.js";

// Resend's REST API through fetch: sending, and the domains and limits the dashboard shows. Errors keep
// Resend's own name (rate_limit_exceeded, validation_error...) so lib/sending-rules.js can decide.
const API_URL = "https://api.resend.com";
const CACHE_TTL_MS = 5 * 60_000;
// Reads only: a send that timed out could still have gone out.
const READ_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 30_000;
const cache = new Map();

function getApiKey() {
	const key = process.env.RESEND_API_KEY;
	if (!key) throw Object.assign(new Error("Resend is not configured (RESEND_API_KEY)"), { name: "missing_api_key" });
	return key;
}

async function request(path, { method = "GET", body, headers = {}, timeoutMs = READ_TIMEOUT_MS } = {}) {
	const response = await fetch(`${API_URL}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${getApiKey()}`,
			...(body && { "Content-Type": "application/json" }),
			...headers,
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(timeoutMs),
	});
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		const error = new Error(data?.message || `Resend answered ${response.status}`);
		error.name = data?.name || (response.status >= 500 ? "application_error" : "resend_error");
		error.statusCode = response.status;
		throw error;
	}
	return { data, headers: response.headers };
}

// Callers that arrive while a load is running share it. Errors aren't kept.
async function cached(key, { fresh }, load) {
	const hit = cache.get(key);
	if (!fresh && hit && hit.expiresAt > Date.now()) return hit.promise;
	const entry = { promise: load(), expiresAt: Date.now() + CACHE_TTL_MS };
	cache.set(key, entry);
	const value = await entry.promise;
	if (value?.error && cache.get(key) === entry) cache.delete(key);
	return value;
}

async function loadDomains() {
	try {
		const { data } = await request("/domains");
		const domains = (data?.data ?? []).filter(({ capabilities }) => capabilities?.sending !== "disabled");
		return await Promise.all(
			domains.map(async ({ id }) => toDomainStatus((await request(`/domains/${encodeURIComponent(id)}`)).data))
		);
	} catch (error) {
		return { error: error.name === "restricted_api_key" ? "The Resend API key can only send: use a full access key" : error.message };
	}
}

// Resend has no account endpoint: the team's request limit comes back on every response.
async function loadAccount() {
	try {
		const { data, headers } = await request("/domains");
		const domains = data?.data ?? [];
		return {
			provider: "resend",
			domains: domains.length,
			verifiedDomains: domains.filter(({ status }) => status === "verified").length,
			maxRequestRate: Number(headers.get("ratelimit-limit")) || null,
			openTracking: domains.some(({ open_tracking: openTracking }) => openTracking),
			clickTracking: domains.some(({ click_tracking: clickTracking }) => clickTracking),
		};
	} catch (error) {
		return { error: error.message };
	}
}

export function listResendDomains({ fresh = false } = {}) {
	return cached("domains", { fresh }, loadDomains);
}

export function getResendAccount({ fresh = false } = {}) {
	return cached("account", { fresh }, loadAccount);
}

// The idempotency key is Mailcheap's message id: a retried request within 24 hours never sends twice.
export async function sendResendEmail({ from, to, replyTo, subject, html, text, headers = {}, tags = [], idempotencyKey }) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	const { data } = await request("/emails", {
		method: "POST",
		timeoutMs: SEND_TIMEOUT_MS,
		headers: idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : {},
		body: {
			from: toResendFrom(from),
			to: [to],
			subject,
			html,
			text,
			...(replyTo && { reply_to: replyTo }),
			headers,
			tags: tags.map(({ name, value }) => ({ name, value: String(value).replace(/[^A-Za-z0-9_-]/g, "_") })),
		},
	});
	return { providerMessageId: data?.id ?? null };
}
