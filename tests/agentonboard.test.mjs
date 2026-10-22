import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import mongoose from "mongoose";
import { activate, anonymous, as, callApi, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { runWithRequest } from "./stubs/next-headers.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// AgentOnboard (lib/agentonboard.js): an agent's token carries a verified email and runs as the account
// that email maps to. The tokens here are signed against keys handed to the verifier, so no test reaches
// the network; the issuer and audience come from the environment, like every deployment's own.
const ISSUER = "https://agentonboard.example";

let app;
let m;
let counter = 0;
let privateKey;

async function mint({ email, aud = m.agentonboard.getAgentAudience(), iss = ISSUER, exp = Math.floor(Date.now() / 1000) + 120 } = {}) {
	return new SignJWT({ email, sub: email, jti: `jti-${++counter}` })
		.setProtectedHeader({ alg: "RS256", kid: "aon-test" })
		.setIssuer(iss)
		.setAudience(aud)
		.setIssuedAt()
		.setExpirationTime(exp)
		.sign(privateKey);
}

// A request to /api/v1/agents through its route handler, as Next.js routes it.
async function callAgent(method, path, { token, body, ip } = {}) {
	const route = await import("../app/api/v1/agents/[...path]/route.js");
	const url = new URL(`/api/v1/agents${path}`, "http://localhost:3000");
	const segments = url.pathname.replace(/^\/api\/v1\/agents\/?/, "").split("/").filter(Boolean);
	const request = jsonRequest(`${url.pathname}${url.search}`, {
		method,
		body,
		headers: { ...(ip && { "x-forwarded-for": ip }), ...(token && { authorization: `Bearer ${token}` }) },
	});
	const response = await runWithRequest({ jar: new Map() }, () => route[method](request, { params: Promise.resolve({ path: segments }) }));
	return { status: response.status, body: await response.json().catch(() => null) };
}

async function callSignup(token, ip) {
	const route = await import("../app/api/v1/agents/signup/route.js");
	const request = jsonRequest("/api/v1/agents/signup", {
		method: "POST",
		headers: { ...(ip && { "x-forwarded-for": ip }), ...(token && { authorization: `Bearer ${token}` }) },
	});
	const response = await runWithRequest({ jar: new Map() }, () => route.POST(request));
	return { status: response.status, body: await response.json().catch(() => null) };
}

before(async () => {
	const { publicKey, privateKey: key } = await generateKeyPair("RS256");
	privateKey = key;
	const jwk = { ...(await exportJWK(publicKey)), kid: "aon-test", alg: "RS256", use: "sig" };
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		agentonboard: await import("../lib/agentonboard.js"),
		registry: await import("../lib/actions/registry.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		Account: (await import("../models/Account.js")).default,
		Contact: (await import("../models/Contact.js")).default,
	};
	m.agentonboard.setAgentonboardJwksForTests({ keys: [jwk] });
	process.env.AON_ISSUER = ISSUER;
});

after(() => app?.stop());

test("an identity with no account is 403, saying where to sign up", async () => {
	const response = await callAgent("GET", "/campaigns", { token: await mint({ email: "unsigned@example.com" }) });
	assert.equal(response.status, 403);
	assert.deepEqual(Object.keys(response.body).sort(), ["code", "error"]);
	assert.equal(response.body.code, "ACCOUNT_REQUIRED");
	assert.match(response.body.error, /POST \/api\/v1\/agents\/signup/);
});

test("a bad or expired credential is the code it failed on", async () => {
	const expired = await mint({ email: "anyone@example.com", exp: Math.floor(Date.now() / 1000) - 60 });
	assert.equal((await callAgent("GET", "/campaigns", { token: expired })).body.code, "EXPIRED");

	const wrongAudience = await mint({ email: "anyone@example.com", aud: "other.example" });
	const rejected = await callAgent("GET", "/campaigns", { token: wrongAudience });
	assert.equal(rejected.status, 401);
	assert.equal(rejected.body.code, "AUDIENCE_MISMATCH");

	const noToken = await callAgent("GET", "/campaigns");
	assert.equal(noToken.status, 401);
	assert.equal(noToken.body.code, "MALFORMED_TOKEN");
});

test("an endpoint nothing advertises is 404, still in the agents' shape", async () => {
	const response = await callAgent("GET", "/no-such-thing", { token: await mint({ email: "anyone@example.com" }) });
	assert.equal(response.status, 404);
	assert.equal(response.body.code, "not_found");
});

test("signup opens the account, and the retry reaches only its own data", async () => {
	const email = "agent-created@example.com";
	const token = await mint({ email });

	const created = await callSignup(token, "203.0.113.10");
	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.created, true);

	const row = await mongoose.connection.db.collection("users").findOne({ email });
	assert.ok(row, "the Better Auth user row");
	assert.equal(row.emailVerified, true);
	assert.equal(created.body.user, String(row._id));
	const account = await m.Account.findOne({ ownerId: row._id }).lean();
	assert.ok(account, "the account the user owns");

	await flushAfter();
	assert.ok(
		platformEmails.findLast(({ to, subject }) => to.includes(email) && subject.includes("agent created")),
		"the owner is told an agent created this account"
	);

	// A new account is like a human's: no plan, so the plan errors decide what it may do.
	const planNeeded = await callAgent("GET", "/campaigns", { token });
	assert.equal(planNeeded.status, 402);
	assert.equal(planNeeded.body.code, "subscription_required");

	await activate({ accountId: account._id });

	const newsletter = await callAgent("POST", "/newsletters", { token, body: { name: "Agent news", slug: "agent-created-news", postalAddress: "1 Main St, Paris" } });
	assert.equal(newsletter.status, 201, JSON.stringify(newsletter.body));

	const campaigns = await callAgent("GET", "/campaigns", { token });
	assert.equal(campaigns.status, 200, JSON.stringify(campaigns.body));

	const contact = await callAgent("POST", "/contacts", { token, body: { email: "reader@agentlist.example.org" } });
	assert.ok(contact.status < 300, JSON.stringify(contact.body));
	assert.ok(await m.Contact.findOne({ accountId: account._id, email: "reader@agentlist.example.org" }), "in the agent's account");
});

test("signup again signs in instead, and opens nothing", async () => {
	const before = await m.Account.estimatedDocumentCount();
	const response = await callSignup(await mint({ email: "agent-created@example.com" }), "203.0.113.10");
	assert.equal(response.status, 201);
	assert.equal(response.body.created, false);
	assert.equal(await m.Account.estimatedDocumentCount(), before);
});

test("a throwaway inbox is refused like a human's would be", async () => {
	const response = await callSignup(await mint({ email: "agent@mailinator.com" }), "203.0.113.11");
	assert.equal(response.status, 403);
	assert.equal(response.body.code, "signup_not_allowed");
});

test("the MCP server takes the same token, with the full tool list", async () => {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${await mint({ email: "agent-created@example.com" })}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	const tools = JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result.tools;
	assert.deepEqual(
		tools.map(({ name }) => name).sort(),
		m.registry.ACTIONS.map(({ name }) => name).sort()
	);
});

test("a token naming this server as its issuer goes to the OAuth path, not the agents'", async () => {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${await mint({ email: "agent-created@example.com", iss: "http://localhost:3000" })}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
	const response = await anonymous(() => m.mcpRoute.POST(request));
	assert.equal(response.status, 401);
});

test("auth.md is the file agents act on", async () => {
	const route = await import("../app/auth.md/route.js");
	const response = await route.GET();
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
	const text = await response.text();
	const audience = m.agentonboard.getAgentAudience();

	assert.ok(text.includes("# MailCheap agent API"));
	assert.ok(text.includes("## Audience"));
	assert.ok(text.includes(`get_token(domain: "${audience}")`));
	assert.ok(text.includes("## Endpoints"));
	assert.ok(text.includes("### `POST /api/v1/agents/signup`"));
	assert.ok(text.includes("### `GET /api/v1/agents/campaigns`"));
	assert.ok(text.includes("## When a request is rejected"));
	assert.match(text, /\| 403 \| ACCOUNT_REQUIRED \|.*agents\/signup/);
	assert.match(text, /\| 403 \| signup_not_allowed \|/);
	assert.match(text, /\| 500 \| RESOLVER_ERROR \|/);

	// Every action of the registry is listed, so an agent is never told about an endpoint that isn't there.
	const listed = [...text.matchAll(/^### `(GET|POST|PATCH|DELETE) (.+)`$/gm)].map(([, method, path]) => `${method} ${path}`);
	assert.deepEqual(
		listed.filter((endpoint) => !endpoint.startsWith("POST /api/v1/agents/signup")).sort(),
		m.registry.ACTIONS.map(({ http }) => `${http.method} /api/v1/agents${http.path}`).sort()
	);
});

test("an agent and an API key stay in their own accounts", async () => {
	const { catchRedirect } = await import("./helpers/app.mjs");
	const user = await signIn("key-owner@example.com");
	await activate(user);
	const key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "full", level: "full" })))).key;
	await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Owner news", slug: "key-owner-news", postalAddress: "1 Main St, Paris" }))));

	const human = await callApi("POST", "/api/v1/contacts", { key, body: { email: "human-side@example.org" } });
	assert.ok(human.status < 300, JSON.stringify(human.body));

	const token = await mint({ email: "agent-created@example.com" });
	const contacts = await callAgent("GET", "/contacts", { token });
	assert.equal(contacts.status, 200, JSON.stringify(contacts.body));
	assert.ok(JSON.stringify(contacts.body).includes("reader@agentlist.example.org"), "the agent's own contact");
	assert.ok(!JSON.stringify(contacts.body).includes("human-side@example.org"), "never the key's account's contact");
});

test("an agent's status change and import record no key of a shape the data can't take", async () => {
	const token = await mint({ email: "agent-created@example.com" });

	const added = await callAgent("POST", "/contacts", { token, body: { email: "status@agentlist.example.org" } });
	assert.ok(added.status < 300, JSON.stringify(added.body));
	const changed = await callAgent("PATCH", `/contacts/${added.body.id}`, { token, body: { status: "unsubscribed" } });
	assert.equal(changed.status, 200, JSON.stringify(changed.body));
	const owner = await mongoose.connection.db.collection("users").findOne({ email: "agent-created@example.com" });
	const account = await m.Account.findOne({ ownerId: owner._id }).lean();
	const contact = await m.Contact.findOne({ accountId: account._id, email: "status@agentlist.example.org" }).lean();
	assert.ok(contact, "the contact");
	assert.equal(contact.status, "unsubscribed");
	assert.equal(contact.statusChanges.at(-1).apiKeyId, undefined, "no key to point at, and no cast error");

	const imported = await callAgent("POST", "/contacts/import", { token, body: { consent: true, contacts: [{ email: "bulk@agentlist.example.org" }] } });
	assert.ok(imported.status < 300, JSON.stringify(imported.body));
	const imports = await import("../models/ContactImport.js").then(({ default: ContactImport }) => ContactImport);
	const one = await imports.findOne({ accountId: account._id }).sort({ _id: -1 }).lean();
	assert.ok(one, "the import");
	assert.equal(one.apiKeyId, undefined, "no key to point at, and no cast error");
	assert.equal(one.source, "api");
});

test("a user of an interrupted signup only gains its account, never a second user", async () => {
	const users = mongoose.connection.db.collection("users");
	const id = new mongoose.Types.ObjectId();
	await users.insertOne({ _id: id, email: "half-done@example.com", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() });

	const response = await callSignup(await mint({ email: "half-done@example.com" }), "203.0.113.12");
	assert.equal(response.status, 201, JSON.stringify(response.body));
	assert.equal(response.body.created, true);
	assert.equal(response.body.user, String(id));
	assert.equal(await users.countDocuments({ email: "half-done@example.com" }), 1, "no duplicate user row");
	assert.ok(await m.Account.findOne({ ownerId: id }).lean(), "the account is there now");
});

test("signup answers at most ten a minute for one identity", async () => {
	const users = mongoose.connection.db.collection("users");
	const id = new mongoose.Types.ObjectId();
	await users.insertOne({ _id: id, email: "again@example.com", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() });

	const token = await mint({ email: "again@example.com" });
	const statuses = [];
	for (let i = 0; i < 11; i += 1) statuses.push((await callSignup(token, "203.0.113.14")).status);
	assert.equal(statuses.filter((status) => status === 429).length, 1, JSON.stringify(statuses));
	assert.equal(await users.countDocuments({ email: "again@example.com" }), 1);
});
