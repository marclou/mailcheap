import "server-only";

// Every call to Groundmail lives in this file, like lib/postshiba.js for PostShiba. Tests answer them with a mocked
// fetch. Errors keep Groundmail's error code in providerCode (never in code, which the API answers with).
const API_URL = "https://api.groundmail.dev";
const TIMEOUT_MS = 10_000;
// A send waits for the mail server to accept the message.
const SEND_TIMEOUT_MS = 20_000;
// Lifting an unsubscribe runs while someone signs up: it never holds them up for long.
const OPT_OUT_TIMEOUT_MS = 5_000;

export function getGroundmailConfig(env = process.env) {
	const apiKey = String(env.GROUNDMAIL_API_KEY ?? "").trim();
	if (!apiKey) throw new Error("Groundmail is not configured (GROUNDMAIL_API_KEY)");
	return { apiKey, apiUrl: (env.GROUNDMAIL_API_URL || API_URL).trim().replace(/\/+$/, "") };
}

function readRetryAfter(headers) {
	const seconds = Number.parseInt(headers?.get("retry-after") ?? "", 10);
	return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

// Errors are { error: { code, message, details } }; a few older endpoints answer { error: "...", code, message }
// with the same fields beside it.
function readError(body) {
	const error = body && typeof body === "object" ? (typeof body.error === "object" && body.error ? body.error : body) : {};
	return {
		providerCode: typeof error.code === "string" ? error.code : null,
		detail: typeof error.message === "string" ? error.message.slice(0, 300) : typeof body === "string" ? body.slice(0, 200) : "",
		details: error.details && typeof error.details === "object" ? error.details : null,
	};
}

function groundmailError({ label, status = null, body = null, headers, cause }) {
	const { providerCode, detail, details } = readError(body);
	const answer = status ? `${status}${providerCode ? ` ${providerCode}` : ""}` : cause?.name === "TimeoutError" ? "timed out" : "no answer";
	return Object.assign(new Error(`Groundmail ${label}: ${answer}${detail ? ` (${detail})` : ""}`), {
		name: "GroundmailError",
		status,
		providerCode,
		detail,
		details,
		body: body && typeof body === "object" ? body : null,
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

async function request(path, { method = "GET", body, headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
	const { apiKey, apiUrl } = getGroundmailConfig();
	const label = `${method} ${path.split("?")[0]}`;
	let response;
	try {
		response = await fetch(`${apiUrl}${path}`, {
			method,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
				...(body !== undefined && { "Content-Type": "application/json" }),
				...headers,
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (cause) {
		throw groundmailError({ label, cause });
	}
	const data = await readBody(response);
	if (!response.ok) throw groundmailError({ label, status: response.status, body: data, headers: response.headers });
	return data;
}

const id = encodeURIComponent;

// external_id is MailCheap's own name for the tenant, unique in the Groundmail account.
export async function createTenant({ externalId, name }) {
	return (await request("/tenants", { method: "POST", body: { external_id: externalId, name } })).tenant;
}

// By Groundmail's id or the external id.
export async function getTenant(tenant) {
	return (await request(`/tenants/${id(tenant)}`)).tenant;
}

export async function setTenantStatus(tenant, { status, reason }) {
	return (await request(`/tenants/${id(tenant)}`, { method: "PATCH", body: { status, ...(reason && { reason }) } })).tenant;
}

// Its domains go back to the Groundmail account, so they go first.
export async function deleteTenant(tenant) {
	try {
		await request(`/tenants/${id(tenant)}`, { method: "DELETE" });
	} catch (error) {
		if (error.status !== 404) throw error;
	}
}

export function assignTenantDomain(tenant, domain) {
	return request(`/tenants/${id(tenant)}/domains`, { method: "POST", body: { domain } });
}

// { domain, records }: the records to add come with the domain.
export function createDomain({ name, tenant }) {
	return request("/domains", { method: "POST", body: { name, ...(tenant && { tenant }) } });
}

// By id or name: { domain, records }.
export function getDomain(domain) {
	return request(`/domains/${id(domain)}`);
}

// Groundmail looks at DNS when asked to, not on its own: a 400 lists what's still missing (checks).
export function verifyDomain(domain) {
	return request(`/domains/${id(domain)}`, { method: "POST", body: { action: "verify" } });
}

export async function deleteDomain(domain) {
	try {
		await request(`/domains/${id(domain)}`, { method: "DELETE" });
	} catch (error) {
		if (error.status !== 404) throw error;
	}
}

// A retry with the same key and body answers what the first one did, for 24 hours, and never sends twice.
export function sendEmail(email, { idempotencyKey }) {
	return request("/emails", {
		method: "POST",
		body: email,
		headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
		timeoutMs: SEND_TIMEOUT_MS,
	});
}

// A reader's one-click unsubscribe from one category, on the tenant's list (the account's without a tenant). False when
// there was none.
export async function removeCategoryOptOut({ email, category, tenant }) {
	const query = new URLSearchParams({ type: "category_opt_out", email, category, ...(tenant && { tenant }) });
	try {
		await request(`/suppressions?${query}`, { method: "DELETE", timeoutMs: OPT_OUT_TIMEOUT_MS });
		return true;
	} catch (error) {
		if (error.status === 404) return false;
		throw error;
	}
}
