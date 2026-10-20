import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { activate, anonymous, as, form, signIn, startTestApp } from "./helpers/app.mjs";

// Every action of the registry has to reach every surface: a REST route, an MCP tool, the docs. And the
// dashboard's server actions may only run registered actions, so the dashboard can't drift from the API.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DASHBOARD_DIRECTORIES = ["app/(app)", "app/(account)"];
// The signed-in user's own profile and account deletion, like sign-in: no API key or connected app may reach them.
const USER_ACTION_FILES = new Set(["app/(account)/account/actions.js"]);
// Which newsletter the dashboard shows is its own state, a cookie the API has no use for: its actions may read it
// (lib/selected-newsletter.js), and switching it is the one action that runs nothing of the API's.
const ALLOWED_IMPORTS = new Set([
	"next/cache",
	"next/navigation",
	"@/lib/actions/dashboard",
	"@/lib/selected-newsletter",
	"@/lib/newsletter-sections",
]);
const VIEW_ACTIONS = new Set(["selectNewsletter"]);
const SEND_TOOLS = ["schedule_campaign", "send_campaign", "send_campaign_to_more", "resume_campaign"];
const APP_URL = "https://mailcheap.ai";
const SAMPLE_ID = "6650f1c2e9b1d4a012345678";

let app;
let m;

async function findServerActionFiles() {
	const files = [];
	for (const directory of DASHBOARD_DIRECTORIES) {
		const entries = await readdir(join(ROOT, directory), { recursive: true });
		files.push(...entries.filter((entry) => entry.endsWith("actions.js")).map((entry) => join(directory, entry)));
	}
	return files.filter((file) => !USER_ACTION_FILES.has(file));
}

// Each exported function's source, up to the next top-level export.
function readExportedFunctions(source) {
	const starts = [...source.matchAll(/^export (async )?function (\w+)\(/gm)];
	return starts.map((match, index) => ({
		name: match[2],
		isAsync: Boolean(match[1]),
		body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
	}));
}

async function listTools(key) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result.tools;
}

before(async () => {
	app = await startTestApp();
	m = {
		registry: await import("../lib/actions/registry.js"),
		rest: await import("../lib/api/rest.js"),
		openapi: await import("../lib/docs/openapi.js"),
		reference: await import("../lib/docs/reference.js"),
		llms: await import("../lib/docs/llms.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
	};
});

after(() => app?.stop());

describe("every action", () => {
	test("has its own REST route, which leads back to it", () => {
		const routes = new Set();
		for (const action of m.registry.ACTIONS) {
			const route = `${action.http.method} ${action.http.path}`;
			assert.ok(!routes.has(route), `${route} belongs to two actions`);
			routes.add(route);
			const segments = action.http.path.split("/").filter(Boolean).map((part) => (part.startsWith("{") ? SAMPLE_ID : part));
			assert.equal(m.rest.matchRoute(action.http.method, segments)?.action.name, action.name, `${route} should run ${action.name}`);
		}
	});

	test("is an MCP tool with the same name, schemas and annotations", async () => {
		const user = await signIn("parity@example.com");
		await activate(user);
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Parity", level: "full" })));
		const tools = new Map((await listTools(key)).map((tool) => [tool.name, tool]));

		for (const action of m.registry.ACTIONS) {
			const tool = tools.get(action.name);
			assert.ok(tool, `${action.name} has no MCP tool`);
			assert.equal(tool.title, action.title, action.name);
			assert.equal(tool.description, action.description, action.name);
			assert.deepEqual(
				tool.annotations,
				{
					title: action.title,
					readOnlyHint: action.readOnly,
					destructiveHint: action.destructive,
					idempotentHint: action.idempotent,
					openWorldHint: action.openWorld,
				},
				action.name
			);
			const { $schema, ...inputSchema } = tool.inputSchema;
			assert.deepEqual(inputSchema, m.reference.toJsonSchema(action.input, "input"), `${action.name} input`);
			assert.equal(tool.outputSchema?.type, "object", `${action.name} has a structured result`);
		}
		assert.equal(tools.size, m.registry.ACTIONS.length, "no tool without an action");
	});

	test("is documented in OpenAPI, the reference pages, llms-full.txt and llms.txt", () => {
		const openapi = m.openapi.getOpenApiDocument(APP_URL);
		const operations = new Map(
			Object.entries(openapi.paths).flatMap(([path, methods]) =>
				Object.entries(methods).map(([method, operation]) => [operation.operationId, `${method.toUpperCase()} ${path}`])
			)
		);
		const pages = new Set(m.reference.getEndpoints(APP_URL).map(({ name }) => name));
		const full = m.llms.getLlmsFull(APP_URL);
		const index = m.llms.getLlmsIndex(APP_URL);

		for (const action of m.registry.ACTIONS) {
			assert.equal(operations.get(action.name), `${action.http.method} ${action.http.path}`, `${action.name} in OpenAPI`);
			assert.ok(pages.has(action.name), `${action.name} on /docs/api`);
			assert.ok(full.includes(`\`${action.http.method} /api/v1${action.http.path}\` · MCP tool \`${action.name}\``), `${action.name} in llms-full.txt`);
			assert.ok(index.includes(`(MCP tool ${action.name})`), `${action.name} in llms.txt`);
		}
		assert.equal(operations.size, m.registry.ACTIONS.length, "no operation without an action");
	});

	test("explains itself and each of its inputs", () => {
		for (const action of m.registry.ACTIONS) {
			assert.match(action.title, /^[A-Z][^.]*[a-z]$/, `${action.name}: a title in sentence case`);
			assert.ok(action.description.length >= 40 && /\.$/.test(action.description), `${action.name}: a description in sentences`);
			const { properties = {} } = m.reference.toJsonSchema(action.input, "input");
			for (const [field, schema] of Object.entries(properties)) {
				assert.ok(schema.description, `${action.name}.${field} needs a description`);
			}
		}
	});

	test("that sends is marked destructive and says sending can't be undone", () => {
		const sends = m.registry.ACTIONS.filter((action) => action.destructive && action.openWorld && action.group === "Campaigns");
		assert.deepEqual(sends.map(({ name }) => name).sort(), [...SEND_TOOLS].sort());
		for (const action of sends) {
			assert.match(action.description, /Sending can't be undone/, action.name);
			assert.equal(action.readOnly, false, action.name);
		}
	});
});

describe("dashboard server actions", () => {
	test("import nothing but the registry's runner and Next.js navigation", async () => {
		const files = await findServerActionFiles();
		assert.ok(files.length >= 6, "found the dashboard's action files");
		for (const file of files) {
			const source = await readFile(join(ROOT, file), "utf8");
			assert.match(source, /^"use server";/, `${file} is a server action file`);
			for (const [, specifier] of source.matchAll(/^import [^;]+ from "([^"]+)";$/gm)) {
				assert.ok(ALLOWED_IMPORTS.has(specifier), `${file} imports ${specifier}: server actions go through runDashboardAction`);
			}
		}
	});

	test("each one runs a registered action", async () => {
		const used = new Set();
		for (const file of await findServerActionFiles()) {
			const source = await readFile(join(ROOT, file), "utf8");
			const functions = readExportedFunctions(source);
			assert.ok(functions.length > 0, file);
			assert.equal(functions.length, (source.match(/^export /gm) ?? []).length, `${file} only exports functions`);
			for (const { name, isAsync, body } of functions) {
				assert.ok(isAsync, `${file} ${name} is async`);
				if (VIEW_ACTIONS.has(name)) continue;
				const names = [...body.matchAll(/runDashboardAction\(\s*"([a-z_]+)"/g)].map(([, action]) => action);
				assert.ok(names.length > 0, `${file} ${name} doesn't run a registered action`);
				for (const action of names) {
					assert.ok(m.registry.getAction(action), `${file} ${name} runs ${action}, which isn't registered`);
					used.add(action);
				}
			}
		}
		assert.ok(used.size >= 25, `the dashboard uses ${used.size} actions`);
	});

	test("the image picker's route runs the upload and list actions too", async () => {
		const source = await readFile(join(ROOT, "app/api/uploads/route.js"), "utf8");
		assert.match(source, /runAction\("upload_image"/);
		assert.match(source, /runAction\("list_images"/);
		assert.doesNotMatch(source, /from "@\/models\//);
	});
});
