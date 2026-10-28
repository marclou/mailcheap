import crypto from "node:crypto";

// An in-memory Groundmail behind a mocked fetch: tenants, domains with their records and verify, POST /emails with
// Idempotency-Key, category opt-outs and their removal, as its API reference describes them. Nothing reaches the network.
export const GROUNDMAIL = {
	apiUrl: "https://api.groundmail.test",
	apiKey: "gm_test_key",
	webhookSecret: "whsec_groundmail-webhook-secret-for-tests",
};

export const GROUNDMAIL_ENV = {
	EMAIL_PROVIDER: "groundmail",
	GROUNDMAIL_API_KEY: GROUNDMAIL.apiKey,
	GROUNDMAIL_API_URL: GROUNDMAIL.apiUrl,
	GROUNDMAIL_WEBHOOK_SECRET: GROUNDMAIL.webhookSecret,
};

function reply(status, body) {
	return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function apiError(status, code, message, extra = {}) {
	return reply(status, { error: { code, message, ...extra } });
}

function header(headers, name) {
	if (!headers) return undefined;
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
	return key ? headers[key] : undefined;
}

function domainOf(from) {
	const address = typeof from === "object" ? from?.email : (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from);
	return String(address ?? "").split("@")[1]?.toLowerCase();
}

// A signed delivery, as Groundmail posts one event per request.
export function signGroundmailEvent(event, { secret = GROUNDMAIL.webhookSecret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
	const body = JSON.stringify(event);
	const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
	return { body, header: `t=${timestamp},v1=${signature}` };
}

export function createFakeGroundmail() {
	const state = {
		tenants: new Map(),
		domains: new Map(),
		emails: [],
		calls: [],
		idempotency: new Map(),
		failures: [],
		// tenant external id (or "" for the account):email pairs on a suppression list.
		suppressed: new Set(),
		// tenant:email:category for a reader's one-click unsubscribe from one category.
		optOuts: new Set(),
		// Names whose records are in public DNS, as verify finds them.
		dnsReady: new Set(),
		isTenantsEnabled: true,
		isNewsletterEnabled: true,
	};
	let sequence = 0;
	const newId = (prefix) => `${prefix}${(++sequence).toString(36).padStart(6, "0")}`;

	// The next matching call answers this instead: { method, path (RegExp), status, body, times, throws }.
	function fail(rule) {
		state.failures.push({ times: 1, ...rule });
	}

	function findFailure(method, path) {
		const index = state.failures.findIndex((rule) => (!rule.method || rule.method === method) && rule.path.test(path));
		if (index === -1) return null;
		const rule = state.failures[index];
		if (--rule.times <= 0) state.failures.splice(index, 1);
		return rule;
	}

	function findTenant(key) {
		return [...state.tenants.values()].find((tenant) => tenant.external_id === key || tenant.id === key) ?? null;
	}

	function findDomain(key) {
		return state.domains.get(key) ?? [...state.domains.values()].find((domain) => domain.name === key) ?? null;
	}

	function serializeTenant(tenant) {
		return { object: "tenant", ...tenant };
	}

	function records(domain) {
		return [
			{ type: "TXT", host: `_groundmail.${domain.name}`, value: `groundmail-verify=${domain.id}`, purpose: "Domain ownership" },
			{ type: "TXT", host: `gm1._domainkey.${domain.name}`, value: `v=DKIM1; t=s; h=sha256; p=MIIB${domain.id}`, purpose: "DKIM" },
			{ type: "CNAME", host: `rp.${domain.name}`, value: "rp.groundmail.test", purpose: "Return path" },
			{ type: "TXT", host: domain.name, value: "v=spf1 include:spf.groundmail.test ~all", purpose: "SPF" },
			{ type: "TXT", host: `_dmarc.${domain.name}`, value: "v=DMARC1; p=none;", purpose: "DMARC" },
		];
	}

	// Like GET /domains/{id}: the domain without its tenant, and the records it needs.
	function domainDetail(domain) {
		const { tenant, ...rest } = domain;
		return { domain: rest, records: records(domain) };
	}

	// Marks a domain's records as found in public DNS: its next verify passes.
	function publishDns(name) {
		state.dnsReady.add(name);
	}

	// Pauses a tenant as Groundmail's own rules would (pause_source automated): resuming it over the API is refused.
	function pauseTenant(externalId, source = "automated") {
		Object.assign(findTenant(externalId), { status: "paused", pause_source: source });
	}

	function suppress(tenant, email) {
		state.suppressed.add(`${tenant ?? ""}:${email}`);
	}

	function optOut(tenant, email, category = "newsletter") {
		state.optOuts.add(`${tenant ?? ""}:${email}:${category}`);
	}

	// DELETE /suppressions?type=category_opt_out: the tenant's list, or the account's without one; 404 when it had none.
	function removeOptOuts(query) {
		if (query.get("type") !== "category_opt_out") return apiError(404, "not_found", "Suppression not found");
		const tenant = query.get("tenant") ?? "";
		if (tenant && !findTenant(tenant)) return apiError(404, "not_found", "Tenant not found");
		const email = query.get("email")?.toLowerCase();
		const category = query.get("category");
		const matches = [...state.optOuts].filter((key) => {
			const [owner, address, kind] = key.split(":");
			return owner === tenant && address === email && (!category || kind === category);
		});
		if (matches.length === 0) return apiError(404, "not_found", "Category opt-out not found");
		for (const key of matches) state.optOuts.delete(key);
		return reply(200, { ok: true, deleted: matches.length });
	}

	function handleSend({ body, init }) {
		const key = header(init.headers, "idempotency-key");
		const fingerprint = JSON.stringify(body);
		if (key && state.idempotency.has(key)) {
			const first = state.idempotency.get(key);
			return first.fingerprint === fingerprint ? reply(200, first.response) : apiError(409, "idempotency_conflict", "Idempotency-Key was reused with a different request body");
		}
		if (body.category === "newsletter" && !state.isNewsletterEnabled) {
			return apiError(403, "newsletter_not_enabled", "Newsletter sending isn't enabled on this account yet.");
		}
		if (body.category === "newsletter" && body.unsubscribe === false) {
			return apiError(400, "validation_error", "`unsubscribe` cannot be false for `category: \"newsletter\"`");
		}
		let tenant = null;
		if (body.tenant) {
			if (!state.isTenantsEnabled) return apiError(403, "tenants_not_enabled", "Tenants are not enabled for this account.");
			tenant = findTenant(body.tenant);
			if (!tenant) return apiError(404, "not_found", "No tenant with that id");
		}
		const fromDomain = domainOf(body.from);
		const domain = findDomain(fromDomain);
		if (!domain || domain.status !== "verified") {
			return apiError(403, "forbidden", `From domain '${fromDomain}' is not verified for this API key. Verify it in Groundmail first.`);
		}
		tenant ??= domain.tenant ? findTenant(domain.tenant) : null;
		if (tenant && domain.tenant && domain.tenant !== tenant.external_id) {
			return apiError(403, "domain_not_allowed", "The from domain belongs to another tenant.", { details: { tenant: tenant.external_id, from_domain: fromDomain } });
		}
		if (tenant?.status === "paused") {
			return apiError(403, "forbidden", `Sending is paused for tenant \`${tenant.external_id}\`.`, { details: { tenant: tenant.external_id, tenant_status: "paused" } });
		}
		const to = Array.isArray(body.to) ? body.to : [body.to];
		const suppressed = to.filter((email) => state.suppressed.has(`${tenant?.external_id ?? ""}:${email}`) || state.suppressed.has(`:${email}`));
		if (suppressed.length === to.length) {
			return apiError(422, "validation_error", "All recipients are suppressed", { details: { suppressed, email_id: newId("msg_") } });
		}
		const optedOut = to.filter((email) => [tenant?.external_id ?? "", ""].some((owner) => state.optOuts.has(`${owner}:${email}:${body.category}`)));
		if (optedOut.length === to.length) {
			return apiError(422, "validation_error", "One or more recipients opted out of this email category", {
				details: { category_unsubscribed: optedOut, category: body.category, email_id: newId("msg_") },
			});
		}
		const response = { id: newId("msg_"), status: "sent", ...(GROUNDMAIL.apiKey.startsWith("gm_test_") && { test: true }) };
		state.emails.push({ key, body, tenant: tenant?.external_id ?? null, response });
		if (key) state.idempotency.set(key, { fingerprint, response });
		return reply(200, response);
	}

	function route({ method, path, query, body, init }) {
		let match;
		if (path.startsWith("/tenants") && !state.isTenantsEnabled) return apiError(403, "tenants_not_enabled", "Tenants are not enabled for this account.");

		if (method === "POST" && path === "/tenants") {
			if (findTenant(body.external_id)) return apiError(409, "conflict", "A tenant with this external_id already exists");
			const tenant = { id: crypto.randomUUID(), external_id: body.external_id, name: body.name ?? body.external_id, status: "active", paused_reason: null, pause_source: null };
			state.tenants.set(tenant.id, tenant);
			return reply(201, { tenant: serializeTenant(tenant) });
		}
		if ((match = /^\/tenants\/([^/]+)\/domains$/.exec(path)) && method === "POST") {
			const tenant = findTenant(decodeURIComponent(match[1]));
			const domain = findDomain(body.domain);
			if (!tenant || !domain) return apiError(404, "not_found", "Not found");
			if (domain.tenant && domain.tenant !== tenant.external_id) return apiError(409, "conflict", "Another tenant owns this domain");
			domain.tenant = tenant.external_id;
			return reply(200, { domain: { ...domainDetail(domain).domain, tenant: tenant.external_id } });
		}
		if ((match = /^\/tenants\/([^/]+)$/.exec(path))) {
			const tenant = findTenant(decodeURIComponent(match[1]));
			if (!tenant) return apiError(404, "not_found", "No tenant with that id");
			if (method === "GET") return reply(200, { tenant: serializeTenant(tenant) });
			if (method === "PATCH") {
				if (body.status === "active" && tenant.status === "paused" && ["automated", "admin"].includes(tenant.pause_source)) {
					return apiError(403, "forbidden", "Groundmail paused this tenant, so it cannot be resumed over the API.", {
						details: { tenant: tenant.external_id, pause_source: tenant.pause_source },
					});
				}
				if (body.status && body.status !== tenant.status) {
					Object.assign(tenant, body.status === "paused" ? { status: "paused", paused_reason: body.reason ?? null, pause_source: "api" } : { status: "active", paused_reason: null, pause_source: null });
				}
				return reply(200, { tenant: serializeTenant(tenant) });
			}
			if (method === "DELETE") {
				state.tenants.delete(tenant.id);
				for (const domain of state.domains.values()) if (domain.tenant === tenant.external_id) domain.tenant = null;
				return reply(200, { ok: true, id: tenant.id, external_id: tenant.external_id, deleted: true });
			}
		}
		if (method === "POST" && path === "/domains") {
			if (body.tenant && !state.isTenantsEnabled) return apiError(403, "tenants_not_enabled", "Tenants are not enabled for this account.");
			if (body.tenant && !findTenant(body.tenant)) return apiError(404, "not_found", "No tenant with that id");
			if (findDomain(body.name)) return apiError(409, "conflict", "Domain already exists");
			const domain = { id: newId("d_"), name: body.name, status: "pending", verified_at: null, tenant: body.tenant ?? null };
			state.domains.set(domain.id, domain);
			return reply(201, domainDetail(domain));
		}
		if ((match = /^\/domains\/([^/]+)$/.exec(path))) {
			const domain = findDomain(decodeURIComponent(match[1]));
			if (!domain) return apiError(404, "not_found", "Domain not found");
			if (method === "GET") return reply(200, domainDetail(domain));
			if (method === "DELETE") {
				state.domains.delete(domain.id);
				return reply(200, { ok: true });
			}
			if (method === "POST" && body?.action === "verify") {
				if (!state.dnsReady.has(domain.name)) {
					const checks = { ownership: false, spf: false, dkim: false, dmarc: false, return_path: false };
					return reply(400, {
						pending: true,
						error: "DNS records not found yet: ownership TXT, SPF include:spf.groundmail.test, DKIM, return path CNAME",
						code: "validation_error",
						message: "DNS records not found yet: ownership TXT, SPF include:spf.groundmail.test, DKIM, return path CNAME",
						checks,
						records: records(domain),
					});
				}
				Object.assign(domain, { status: "verified", verified_at: new Date().toISOString() });
				return reply(200, { ...domainDetail(domain), verified: true, signing_ready: true });
			}
		}
		if (method === "POST" && path === "/emails") return handleSend({ body, init });
		if (method === "DELETE" && path === "/suppressions") return removeOptOuts(query);
		return apiError(404, "not_found", "Not found");
	}

	async function handle(url, init = {}) {
		const method = init.method ?? "GET";
		const { pathname, searchParams } = new URL(url);
		const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
		state.calls.push({ method, path: pathname, query: Object.fromEntries(searchParams), body, headers: init.headers });
		const failure = findFailure(method, pathname);
		if (failure) {
			if (failure.throws) throw failure.throws;
			return new Response(JSON.stringify(failure.body), { status: failure.status, headers: { "content-type": "application/json", ...failure.headers } });
		}
		if (header(init.headers, "authorization") !== `Bearer ${GROUNDMAIL.apiKey}`) return apiError(401, "unauthorized", "Invalid API key");
		return route({ method, path: pathname, query: searchParams, body, init });
	}

	// Answers Groundmail's URLs and hands every other request to the fetch already installed.
	function install() {
		const previous = globalThis.fetch;
		globalThis.fetch = (input, init) => {
			const url = String(input?.url ?? input);
			return url.startsWith(GROUNDMAIL.apiUrl) ? handle(url, init) : previous(input, init);
		};
		return () => {
			globalThis.fetch = previous;
		};
	}

	function callsTo(method, pattern) {
		return state.calls.filter((call) => call.method === method && pattern.test(call.path));
	}

	return { state, fail, publishDns, pauseTenant, suppress, optOut, install, callsTo, findTenant, findDomain };
}
