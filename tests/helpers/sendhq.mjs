import crypto from "node:crypto";

// An in-memory SendHQ workspace behind a mocked fetch: domains and POST /emails with Idempotency-Key, as its REST API
// answers them. Every other request goes on to the fetch installed before. Nothing reaches the network.
const API_URL = "https://sendhq.cc/api/v1";

export const SENDHQ = {
	apiKey: "sk_test_sendhq",
	// Standard Webhooks secrets are base64 after whsec_.
	webhookSecret: `whsec_${Buffer.from("sendhq-webhook-secret-for-tests").toString("base64")}`,
};

export const SENDHQ_ENV = {
	EMAIL_PROVIDER: "sendhq",
	SENDHQ_API_KEY: SENDHQ.apiKey,
	SENDHQ_WEBHOOK_SECRET: SENDHQ.webhookSecret,
};

// A webhook delivery as SendHQ signs it: base64 HMAC-SHA256 of "{id}.{timestamp}.{body}", keyed with the secret's bytes.
export function signSendhqWebhook(body, { secret = SENDHQ.webhookSecret, id = `msg_${crypto.randomUUID()}`, timestamp = Math.floor(Date.now() / 1000) } = {}) {
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
	return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

function fail(status, message, code = null) {
	return Response.json({ error: { message, status, code } }, { status });
}

export function createFakeSendhq() {
	const state = { domains: new Map(), emails: [], idempotency: new Map(), failures: [], calls: [] };
	let sequence = 0;

	// The next matching call answers this instead: { method, path (RegExp), status, message, headers }.
	function failNext(rule) {
		state.failures.push(rule);
	}

	function toDomain(domain) {
		return {
			id: domain.id,
			name: domain.name,
			status: domain.verified ? "verified" : "pending",
			records: domain.tokens.map((token) => ({
				type: "CNAME",
				name: `${token}._domainkey.${domain.name}`,
				value: `${token}.dkim.amazonses.com`,
				ttl: 3600,
				purpose: "dkim",
				verified: domain.verified,
			})),
		};
	}

	function findByName(name) {
		return [...state.domains.values()].find((domain) => domain.name === name) ?? null;
	}

	function route({ method, path, body, key, authorization }) {
		if (authorization !== `Bearer ${SENDHQ.apiKey}`) return fail(401, "Invalid API key");
		const domainId = /^\/domains\/([^/]+)(\/verify)?$/.exec(path);
		if (method === "POST" && path === "/domains") {
			if (findByName(body.name)) return fail(409, "Domain already added");
			const domain = { id: `dom_${++sequence}`, name: body.name, verified: false, tokens: [1, 2, 3].map(() => crypto.randomBytes(8).toString("hex")) };
			state.domains.set(domain.id, domain);
			return Response.json({ ...toDomain(domain), ses: { configured: true } }, { status: 201 });
		}
		if (domainId) {
			const domain = state.domains.get(decodeURIComponent(domainId[1]));
			if (!domain) return fail(404, "Domain not found");
			if (method === "GET") return Response.json(toDomain(domain));
			if (method === "POST" && domainId[2]) return Response.json({ domain: toDomain(domain), checks: { dkim: domain.verified }, status: toDomain(domain).status });
			if (method === "DELETE") {
				state.domains.delete(domain.id);
				return Response.json({ ok: true });
			}
		}
		if (method === "POST" && path === "/emails") {
			if (key && state.idempotency.has(key)) {
				const first = state.idempotency.get(key);
				return JSON.stringify(first.body) === JSON.stringify(body) ? Response.json(first.answer, { status: 201 }) : fail(409, "Idempotency key reused with a different request body");
			}
			const sender = /<([^<>]+)>\s*$/.exec(body.from)?.[1] ?? body.from;
			const domain = findByName(sender.split("@")[1]);
			if (!domain) return fail(403, "The sender domain is not owned by this workspace");
			if (!domain.verified) return fail(403, "The sender domain is not verified");
			const id = `em_${crypto.randomBytes(12).toString("hex")}`;
			const answer = { id, providerMessageId: `ses-${id}`, threadId: id };
			state.emails.push({ key, body, id });
			if (key) state.idempotency.set(key, { body, answer });
			return Response.json(answer, { status: 201 });
		}
		return fail(404, `No route for ${method} ${path}`);
	}

	function handle(url, init = {}) {
		const method = init.method ?? "GET";
		const path = new URL(url).pathname.slice(new URL(API_URL).pathname.length);
		const body = init.body ? JSON.parse(init.body) : null;
		const headers = new Headers(init.headers);
		state.calls.push({ method, path, body });
		const index = state.failures.findIndex((rule) => (!rule.method || rule.method === method) && rule.path.test(path));
		if (index !== -1) {
			const [rule] = state.failures.splice(index, 1);
			return Response.json({ error: { message: rule.message, status: rule.status, code: rule.code ?? null } }, { status: rule.status, headers: rule.headers });
		}
		return route({ method, path, body, key: headers.get("idempotency-key"), authorization: headers.get("authorization") });
	}

	function install() {
		const previous = globalThis.fetch;
		globalThis.fetch = async (input, init = {}) => {
			const url = String(input?.url ?? input);
			return url.startsWith(API_URL) ? handle(url, init) : previous(input, init);
		};
		return () => {
			globalThis.fetch = previous;
		};
	}

	function verifyDomain(name) {
		const domain = findByName(name);
		if (domain) domain.verified = true;
	}

	return { state, fail: failNext, install, verifyDomain, findDomain: findByName };
}
