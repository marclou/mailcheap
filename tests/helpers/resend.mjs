import crypto from "node:crypto";

// An in-memory Resend team behind a mocked fetch: domains and POST /emails with Idempotency-Key, as the resend SDK calls
// them. MailCheap's own emails (no tags) go on to the fetch installed before, which records them. Nothing reaches the
// network.
const API_URL = "https://api.resend.com";

export const RESEND = {
	apiKey: "re_test_key",
	// Svix secrets are base64 after whsec_.
	webhookSecret: `whsec_${Buffer.from("resend-webhook-secret-for-tests").toString("base64")}`,
};

export const RESEND_ENV = {
	EMAIL_PROVIDER: "resend",
	RESEND_API_KEY: RESEND.apiKey,
	RESEND_WEBHOOK_SECRET: RESEND.webhookSecret,
};

// A webhook delivery as Resend signs it: base64 HMAC-SHA256 of "{id}.{timestamp}.{body}", keyed with the secret's bytes.
export function signResendWebhook(body, { secret = RESEND.webhookSecret, id = `msg_${crypto.randomUUID()}`, timestamp = Math.floor(Date.now() / 1000) } = {}) {
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
	return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

function reply(status, body) {
	return Response.json(body, { status });
}

function zoneOf(name) {
	return name.split(".").slice(-2).join(".");
}

// Resend names records inside the domain's zone.
function relative(host, name) {
	const zone = zoneOf(name);
	return host === zone ? "@" : host.slice(0, -zone.length - 1);
}

export function createFakeResend() {
	const state = { domains: new Map(), emails: [], idempotency: new Map(), failures: [], calls: [] };
	let sequence = 0;

	// The next matching call answers this instead: { method, path (RegExp), status, body, headers }.
	function fail(rule) {
		state.failures.push(rule);
	}

	function toDomain(domain) {
		const status = domain.verified ? "verified" : "pending";
		return {
			object: "domain",
			id: domain.id,
			name: domain.name,
			status,
			region: "us-east-1",
			open_tracking: domain.openTracking,
			click_tracking: domain.clickTracking,
			records: [
				{ record: "DKIM", type: "TXT", name: relative(`resend._domainkey.${domain.name}`, domain.name), value: domain.dkim, ttl: "Auto", status },
				{ record: "SPF", type: "MX", name: relative(`send.${domain.name}`, domain.name), value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, ttl: "Auto", status },
				{ record: "SPF", type: "TXT", name: relative(`send.${domain.name}`, domain.name), value: "v=spf1 include:amazonses.com ~all", ttl: "Auto", status },
			],
		};
	}

	function route({ method, path, body, key }) {
		const domainId = /^\/domains\/([^/]+)(\/verify)?$/.exec(path);
		if (method === "POST" && path === "/domains") {
			if ([...state.domains.values()].some(({ name }) => name === body.name)) return reply(403, { name: "validation_error", statusCode: 403, message: `The domain ${body.name} has been registered already.` });
			const domain = { id: `dom_${++sequence}`, name: body.name, verified: false, dkim: `p=${crypto.randomBytes(12).toString("base64")}`, openTracking: body.open_tracking, clickTracking: body.click_tracking, returnPath: body.custom_return_path };
			state.domains.set(domain.id, domain);
			return reply(200, toDomain(domain));
		}
		if (domainId) {
			const domain = state.domains.get(domainId[1]);
			if (!domain) return reply(404, { name: "not_found", statusCode: 404, message: "Domain not found" });
			if (method === "GET") return reply(200, toDomain(domain));
			if (method === "POST" && domainId[2]) return reply(200, { object: "domain", id: domain.id });
			if (method === "DELETE") {
				state.domains.delete(domain.id);
				return reply(200, { object: "domain", id: domain.id, deleted: true });
			}
		}
		if (method === "POST" && path === "/emails") {
			if (key && state.idempotency.has(key)) return reply(200, state.idempotency.get(key));
			const sender = /<([^<>]+)>\s*$/.exec(body.from)?.[1] ?? body.from;
			const isVerified = [...state.domains.values()].some(({ name, verified }) => verified && sender.endsWith(`@${name}`));
			if (!isVerified) return reply(403, { name: "validation_error", statusCode: 403, message: `The ${sender.split("@")[1]} domain is not verified. Please, add and verify your domain on https://resend.com/domains` });
			const answer = { id: crypto.randomUUID() };
			state.emails.push({ key, body, id: answer.id });
			if (key) state.idempotency.set(key, answer);
			return reply(200, answer);
		}
		return reply(404, { name: "not_found", statusCode: 404, message: `No route for ${method} ${path}` });
	}

	function handle(url, init = {}) {
		const method = init.method ?? "GET";
		const path = new URL(url).pathname;
		const body = init.body ? JSON.parse(init.body) : null;
		const headers = new Headers(init.headers);
		state.calls.push({ method, path, body });
		const index = state.failures.findIndex((rule) => (!rule.method || rule.method === method) && rule.path.test(path));
		if (index !== -1) {
			const [rule] = state.failures.splice(index, 1);
			return Response.json(rule.body, { status: rule.status, headers: rule.headers });
		}
		return route({ method, path, body, key: headers.get("idempotency-key") });
	}

	// Answers the team's calls; MailCheap's own emails, which carry no tags, go on to the fetch already installed.
	function install() {
		const previous = globalThis.fetch;
		globalThis.fetch = (input, init = {}) => {
			const url = String(input?.url ?? input);
			const isPlatformEmail = url === `${API_URL}/emails` && !JSON.parse(init.body ?? "{}").tags;
			return url.startsWith(API_URL) && !isPlatformEmail ? handle(url, init) : previous(input, init);
		};
		return () => {
			globalThis.fetch = previous;
		};
	}

	function verifyDomain(name) {
		for (const domain of state.domains.values()) if (domain.name === name) domain.verified = true;
	}

	function findDomain(name) {
		return [...state.domains.values()].find((domain) => domain.name === name) ?? null;
	}

	return { state, fail, install, verifyDomain, findDomain };
}
