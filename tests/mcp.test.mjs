import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, anonymous, as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// The MCP server through its route handler, the way Claude Code, Codex and Cursor reach it today: 2025-era
// Streamable HTTP (initialize, then tools/list and tools/call), each request carrying the API key.
let app;
let m;
let owner;
let stranger;
let nextId = 0;

async function mcp(key, method, params = {}, { route = m.mcpRoute, path = "/mcp" } = {}) {
	const isNotification = method.startsWith("notifications/");
	const request = new Request(`http://localhost:3000${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(method !== "initialize" && { "mcp-protocol-version": "2025-06-18" }),
			...(key && { authorization: `Bearer ${key}` }),
		},
		body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(!isNotification && { id: ++nextId }) }),
	});
	const response = await anonymous(() => route.POST(request));
	const text = await response.text();
	const data = text.split("\n").find((line) => line.startsWith("data: "));
	return { status: response.status, headers: response.headers, body: data ? JSON.parse(data.slice(6)) : text ? JSON.parse(text) : null };
}

// The whole body, or null when it's still streaming after ms (the stream is then cancelled).
async function readWithin(response, ms) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const deadline = Date.now() + ms;
	let text = "";
	for (;;) {
		const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))]);
		if (chunk === null) {
			await reader.cancel();
			return null;
		}
		if (chunk.done) return text;
		text += decoder.decode(chunk.value, { stream: true });
	}
}

async function callTool(key, name, args = {}) {
	const { body } = await mcp(key, "tools/call", { name, arguments: args });
	return body.result;
}

function parseError(result) {
	assert.equal(result.isError, true);
	return JSON.parse(result.content[0].text).error;
}

async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
	user.fullKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	user.signupKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
	return user;
}

before(async () => {
	app = await startTestApp();
	m = {
		mcpRoute: await import("../app/mcp/route.js"),
		apiMcpRoute: await import("../app/api/mcp/route.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		registry: await import("../lib/actions/registry.js"),
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
	};
	owner = await customer("mcp-owner@example.com", "mcp-owner");
	stranger = await customer("mcp-stranger@example.com", "mcp-stranger");
	await as(owner, () =>
		m.contacts.importContacts({ newsletterId: owner.newsletterId, consent: true, rows: [{ email: "reader@example.org", status: "active" }] })
	);
});

after(() => app?.stop());

describe("connecting", () => {
	test("initialize answers like a stateless Streamable HTTP server, with instructions about sends", async () => {
		const { status, headers, body } = await mcp(owner.fullKey, "initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "claude-code", version: "2.1.0" },
		});
		assert.equal(status, 200);
		assert.equal(headers.get("mcp-session-id"), null, "no session to keep");
		assert.equal(body.result.protocolVersion, "2025-06-18");
		assert.equal(body.result.serverInfo.name, "mailcheap");
		assert.deepEqual(body.result.capabilities.tools, { listChanged: false }, "the tool list never changes mid-connection");
		assert.match(body.result.instructions, /can't be undone/);
		assert.equal((await mcp(owner.fullKey, "notifications/initialized")).status, 202);
	});

	test("without a valid key nothing reaches MCP", async () => {
		for (const key of [null, "not-a-key", `mc_${"x".repeat(43)}`]) {
			const { status, headers, body } = await mcp(key, "tools/list");
			assert.equal(status, 401, String(key));
			assert.match(headers.get("www-authenticate"), /^Bearer/);
			assert.equal(body.error.code, "unauthorized");
		}
		const { key } = await as(owner, () => m.apiKeys.createApiKey(null, form({ name: "Short lived", level: "full" })));
		const created = await m.ApiKey.findOne({ accountId: owner.accountId, name: "Short lived" }).lean();
		await as(owner, () => m.apiKeys.revokeApiKey(String(created._id)));
		assert.equal((await mcp(key, "tools/list")).status, 401, "a revoked key");
	});

	test("the official SDK client connects on the 2026-07-28 revision and with the 2025 handshake", async () => {
		const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
		const fetchRoute = (input, init) => {
			const request = new Request(input, init);
			return anonymous(() => m.mcpRoute[request.method](request));
		};
		for (const mode of [{ pin: "2026-07-28" }, "legacy"]) {
			const client = new Client({ name: "mailcheap-test", version: "1.0.0" }, { versionNegotiation: { mode } });
			const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"), {
				fetch: fetchRoute,
				authProvider: { token: async () => owner.fullKey },
			});
			await client.connect(transport);
			const { tools } = await client.listTools();
			assert.equal(tools.length, m.registry.ACTIONS.length, JSON.stringify(mode));
			const result = await client.callTool({ name: "get_billing", arguments: {} });
			assert.equal(result.structuredContent.plan.id, "starter", "the client checked it against the output schema too");
			await client.close();
		}
	});

	test("a 2026-07-28 client's subscriptions/listen ends at once instead of holding the function open", async () => {
		const request = new Request("http://localhost:3000/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": "2026-07-28",
				"mcp-method": "subscriptions/listen",
				authorization: `Bearer ${owner.fullKey}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: ++nextId,
				method: "subscriptions/listen",
				params: {
					notifications: { toolsListChanged: true },
					_meta: {
						"io.modelcontextprotocol/protocolVersion": "2026-07-28",
						"io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "1.0" },
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		});
		const response = await anonymous(() => m.mcpRoute.POST(request));
		const text = await readWithin(response, 2000);
		assert.notEqual(text, null, "the listen stream stayed open");
		const messages = text
			.split("\n")
			.filter((line) => line.startsWith("data: "))
			.map((line) => JSON.parse(line.slice(6)));
		assert.deepEqual(messages[0].params.notifications, {}, "nothing to subscribe to");
		assert.equal(messages.at(-1).result.resultType, "complete");
	});

	test("the server also answers at /api/mcp", async () => {
		const { status, body } = await mcp(owner.fullKey, "tools/list", {}, { route: m.apiMcpRoute, path: "/api/mcp" });
		assert.equal(status, 200);
		assert.equal(body.result.tools.length, m.registry.ACTIONS.length);
	});
});

describe("tools", () => {
	test("a full access key lists one tool per action, with its schemas and annotations", async () => {
		const { body } = await mcp(owner.fullKey, "tools/list");
		const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
		assert.deepEqual([...tools.keys()].sort(), m.registry.ACTIONS.map(({ name }) => name).sort());

		const send = tools.get("send_campaign");
		assert.deepEqual(send.annotations, {
			title: "Send a campaign now",
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		});
		assert.match(send.description, /can't be undone/);
		assert.deepEqual(send.inputSchema.required, ["id"]);
		assert.equal(send.outputSchema.type, "object");
		assert.equal(tools.get("list_contacts").annotations.readOnlyHint, true);
		assert.equal(tools.get("delete_campaign").annotations.destructiveHint, true);
	});

	test("a call runs in the key's account and answers structured content", async () => {
		const result = await callTool(owner.fullKey, "list_newsletters");
		assert.equal(result.isError, undefined);
		assert.deepEqual(result.structuredContent.newsletters.map(({ slug }) => slug), ["mcp-owner"]);
		assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);

		const draft = await callTool(owner.fullKey, "create_campaign", { subject: "From an agent", content: "# Hello\n\nFrom MCP." });
		assert.equal(draft.structuredContent.status, "draft");
		assert.equal(draft.structuredContent.format, "markdown");
		assert.equal(draft.structuredContent.source, "api");
		assert.equal(draft.structuredContent.sendProblem, null);
		const stored = await m.Campaign.findOne({ accountId: owner.accountId, _id: draft.structuredContent.id }).lean();
		assert.equal(stored.markdown, "# Hello\n\nFrom MCP.");
	});

	test("failures come back as error results with the API's codes", async () => {
		const sent = await m.Campaign.create({ accountId: owner.accountId, newsletterId: owner.newsletterId, subject: "Old", status: "sent" });
		assert.deepEqual(parseError(await callTool(owner.fullKey, "send_campaign", { id: String(sent._id) })), {
			code: "conflict",
			message: "This campaign was already sent: send it to more contacts instead",
		});
		assert.equal(parseError(await callTool(owner.fullKey, "get_campaign", { id: "nope" })).code, "not_found");
		const invalid = await callTool(owner.fullKey, "create_campaign", { subject: "x".repeat(201) });
		assert.equal(invalid.isError, true, "the schema refuses it before the action runs");
	});

	test("add_contact asks to confirm when the newsletter does: the dashboard's consent box isn't one of its inputs", async () => {
		const user = await customer("mcp-confirm@example.com", "mcp-confirm");
		const settings = { id: user.newsletterId, name: "mcp-confirm news", slug: "mcp-confirm", postalAddress: "1 Main St, Paris", requireConfirmation: "on" };
		assert.equal((await as(user, () => m.newsletters.saveNewsletter(null, form(settings)))).ok, true);
		const { body } = await mcp(user.fullKey, "tools/list");
		assert.equal("consent" in body.result.tools.find(({ name }) => name === "add_contact").inputSchema.properties, false);

		const added = await callTool(user.fullKey, "add_contact", { email: "agent-reader@example.org", consent: true });
		assert.equal(added.structuredContent.status, "pending");
		const stored = await m.Contact.findOne({ accountId: user.accountId, email: "agent-reader@example.org" }).lean();
		assert.deepEqual([stored.status, stored.source, stored.consent], ["pending", "api", undefined]);
	});

	test("create_newsletter starts with list cleanup on, unless cleanup.enabled is false", async () => {
		const user = await customer("mcp-cleanup@example.com", "mcp-cleanup");
		const created = await callTool(user.fullKey, "create_newsletter", { name: "From an agent" });
		const { enabled, issues, days } = created.structuredContent.cleanup;
		assert.deepEqual({ enabled, issues, days }, { enabled: true, issues: 6, days: 180 });
		const declined = await callTool(user.fullKey, "create_newsletter", { name: "Agent, no cleanup", cleanup: { enabled: false } });
		assert.equal(declined.structuredContent.cleanup.enabled, false);
	});
});

describe("scoping", () => {
	test("a signups only key sees and can call add_contact only", async () => {
		const { body } = await mcp(owner.signupKey, "tools/list");
		assert.deepEqual(body.result.tools.map(({ name }) => name), ["add_contact"]);

		const added = await callTool(owner.signupKey, "add_contact", { email: "new-reader@example.org", source: "mcp test" });
		assert.equal(added.structuredContent.created, true);
		assert.equal(await m.Contact.countDocuments({ accountId: owner.accountId, email: "new-reader@example.org" }), 1);

		const { body: refused } = await mcp(owner.signupKey, "tools/call", { name: "create_campaign", arguments: { subject: "Not allowed" } });
		assert.match(refused.error?.message ?? refused.result?.content[0].text, /create_campaign/, "the tool doesn't exist for this key");
		assert.equal(await m.Campaign.countDocuments({ accountId: owner.accountId, subject: "Not allowed" }), 0);
	});

	test("another account's key never reaches this account's data", async () => {
		const ownCampaign = await m.Campaign.findOne({ accountId: owner.accountId, subject: "From an agent" }).lean();
		assert.equal(parseError(await callTool(stranger.fullKey, "get_campaign", { id: String(ownCampaign._id) })).code, "not_found");
		assert.equal(parseError(await callTool(stranger.fullKey, "list_contacts", { newsletter: "mcp-owner" })).code, "not_found");
		const theirs = await callTool(stranger.fullKey, "list_contacts");
		assert.deepEqual(theirs.structuredContent.contacts, []);
		const update = await callTool(stranger.fullKey, "update_contact_status", { id: "reader@example.org", status: "unsubscribed" });
		assert.equal(parseError(update).code, "not_found");
		const reader = await m.Contact.findOne({ accountId: owner.accountId, email: "reader@example.org" }).lean();
		assert.equal(parseError(await callTool(stranger.fullKey, "delete_contact", { id: String(reader._id) })).code, "not_found");
		assert.equal((await m.Contact.findOne({ accountId: owner.accountId, email: "reader@example.org" }).lean()).status, "active");
	});
});
