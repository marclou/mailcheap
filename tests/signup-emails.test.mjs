import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// New subscribers get the confirmation email or the welcome email, never both. The settings pages turn one off as the
// other goes on, in one save; the API and MCP refuse a change that would leave both on and say how to switch.
let app;
let m;
let nextId = 0;

before(async () => {
	app = await startTestApp();
	m = {
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	const slug = email.split("@")[0];
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris" }))));
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

async function callTool(key, name, args = {}) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name, arguments: args }, id: ++nextId }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	const { result } = JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
	return result.isError ? JSON.parse(result.content[0].text) : result.structuredContent;
}

const WELCOME = { enabled: true, subject: "Welcome", markdown: "Thanks for joining." };

test("the API turns on the welcome email only with double opt-in off in the same request, and the reverse", async () => {
	const user = await customer("signup-emails@example.com");
	const path = `/api/v1/newsletters/${user.newsletterId}`;
	assert.equal((await callApi("PATCH", path, { key: user.key, body: { requireConfirmation: true } })).status, 200);

	const refused = await callApi("PATCH", path, { key: user.key, body: { welcome: WELCOME } });
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.code, "validation_failed");
	assert.match(refused.body.error.message, /^Double opt-in is on.*Send requireConfirmation: false with welcome\.enabled: true/);

	const welcoming = await callApi("PATCH", path, { key: user.key, body: { requireConfirmation: false, welcome: WELCOME } });
	assert.equal(welcoming.status, 200);
	assert.deepEqual([welcoming.body.requireConfirmation, welcoming.body.welcome.enabled], [false, true]);

	const backRefused = await callTool(user.key, "update_newsletter", { id: user.newsletterId, requireConfirmation: true });
	assert.equal(backRefused.error.code, "validation_failed", "MCP follows the same rule");
	assert.match(backRefused.error.message, /^The welcome email is on.*send welcome\.enabled: false with requireConfirmation: true/);

	const confirming = await callTool(user.key, "update_newsletter", { id: user.newsletterId, requireConfirmation: true, welcome: { enabled: false } });
	assert.deepEqual([confirming.requireConfirmation, confirming.welcome.enabled], [true, false]);
	assert.equal(confirming.welcome.subject, "Welcome", "the welcome email keeps what it says");

	const created = await callApi("POST", "/api/v1/newsletters", { key: user.key, body: { name: "Second", welcome: WELCOME } });
	assert.equal(created.status, 400, "a new newsletter with a welcome email asks for double opt-in off");
});

test("a newsletter saved with both on before the rule still takes other changes", async () => {
	const user = await customer("both-on@example.com");
	await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { requireConfirmation: true, welcome: WELCOME } });
	const updated = await callApi("PATCH", `/api/v1/newsletters/${user.newsletterId}`, { key: user.key, body: { fromName: "Jane" } });
	assert.equal(updated.status, 200);
	assert.equal(updated.body.fromName, "Jane");
});

test("the settings pages switch the other one off in the same save", async () => {
	const user = await customer("signup-pages@example.com");
	const id = user.newsletterId;
	const welcomePage = form({ id, section: "welcome", welcomeEnabled: "on", welcomeSubject: "Welcome", welcomePreviewText: "", welcomeMarkdown: "Hi" });
	assert.equal((await as(user, () => m.newsletters.saveNewsletter(null, welcomePage))).ok, true);
	const find = () => m.Newsletter.findOne({ accountId: user.accountId, _id: id }).lean();
	let saved = await find();
	assert.deepEqual([saved.requireConfirmation, saved.welcome.enabled], [false, true]);

	assert.equal((await as(user, () => m.newsletters.saveNewsletter(null, form({ id, section: "signups", requireConfirmation: "on" })))).ok, true);
	saved = await find();
	assert.deepEqual([saved.requireConfirmation, saved.welcome.enabled, saved.welcome.markdown], [true, false, "Hi"]);
});
