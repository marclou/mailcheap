import "server-only";
import { MAX_ACTIVE_API_KEYS } from "@/lib/actions/api-keys";
import { ERRORS } from "@/lib/actions/errors";
import { API_BASE_PATH, REQUESTS_PER_KEY } from "@/lib/api/rest";
import { APP_NAME } from "@/lib/config";
import { getMcpClients, getMcpConnectors, getMcpUrl } from "@/lib/docs/mcp-clients";
import { getEndpointGroups } from "@/lib/docs/reference";
import { getHelpArticles, getHelpHref } from "@/lib/help";
import { TAGLINE, getPageMetadata } from "@/lib/site";

// summary: a line in the docs' index for agents (llms.txt). description: what search results show under the title.
export const DOC_PAGES = [
	{
		href: "/docs",
		title: "Getting started",
		summary: "Make a first request and connect an AI assistant.",
		description: "Make your first request to the MailCheap REST API with an API key, or connect ChatGPT, Claude, Cursor or Claude Code to its MCP server.",
	},
	{
		href: "/docs/authentication",
		title: "Authentication",
		summary: "API keys, their two levels and the rate limits.",
		description: "MailCheap API keys: full access or signups only, sent as a bearer token, with the rate limits each key and each account get.",
	},
	{
		href: "/docs/errors",
		title: "Errors",
		summary: "The error shape and every code.",
		description: "Every error the MailCheap REST API and MCP server can answer: one JSON shape, and each code with its HTTP status and what it means.",
	},
	{
		href: "/docs/mcp",
		title: "MCP",
		summary: "The MCP server, its tools and setup for ChatGPT, Claude, Grok Bot, Claude Code, Codex and Cursor.",
		description: "Connect MailCheap's MCP server to ChatGPT, Claude, Grok Bot, Claude Code, Codex or Cursor, and see every tool your AI agent can use.",
	},
	{
		href: "/docs/api",
		title: "API reference",
		summary: "Every endpoint with its parameters and an example.",
		description: "Every MailCheap REST API endpoint with its parameters and a curl example: newsletters, campaigns, contacts, domains, images and API keys.",
	},
];

// The docs' layout template doesn't reach /docs, which shares its folder, so every docs page names the docs itself.
export function getDocsPageMetadata(href) {
	const { title, description } = DOC_PAGES.find((page) => page.href === href);
	return getPageMetadata({ title: { absolute: `${title} · ${APP_NAME} API and MCP` }, description, path: href });
}

function hintsOf({ readOnly, destructive, idempotent, openWorld }) {
	return [readOnly && "read-only", destructive && "can't be undone", idempotent && "safe to repeat", openWorld && "reaches outside MailCheap"].filter(Boolean);
}

// The short index at /llms.txt (llmstxt.org).
export function getLlmsIndex(appUrl) {
	const groups = getEndpointGroups(appUrl);
	return [
		"# MailCheap",
		"",
		`> ${TAGLINE}: a newsletter app where you pay for the emails you send, not for dormant subscribers, for a fraction of what other platforms charge. Write and schedule issues, send them to your list and publish them on the web from the dashboard, or let an AI agent do it: everything a customer does in the dashboard also works through a REST API and an MCP server, with the same checks and limits.`,
		"",
		`REST API: ${appUrl}${API_BASE_PATH}, with Authorization: Bearer <API key>. MCP server (Streamable HTTP): ${getMcpUrl(appUrl)}, same key, or OAuth for apps like ChatGPT, Claude and Grok Bot.`,
		"",
		"## API and MCP",
		"",
		...DOC_PAGES.map(({ href, title, summary }) => `- [${title}](${appUrl}${href}): ${summary}`),
		`- [OpenAPI document](${appUrl}${API_BASE_PATH}/openapi.json): the API as OpenAPI 3.1.`,
		`- [Full reference](${appUrl}/llms-full.txt): every endpoint and MCP tool in Markdown.`,
		"",
		"## Help",
		"",
		"How MailCheap works, for the people who use it.",
		"",
		...getHelpArticles().map(({ slug, title, summary }) => `- [${title}](${appUrl}${getHelpHref(slug)}): ${summary}`),
		"",
		"## Endpoints",
		"",
		...groups.flatMap(({ group, endpoints }) => [
			`### ${group}`,
			"",
			...endpoints.map(({ method, path, name, title }) => `- [${title}](${appUrl}/docs/api#${name.replaceAll("_", "-")}): ${method} ${path} (MCP tool ${name})`),
			"",
		]),
	].join("\n");
}

function parameterLines(parameters) {
	if (parameters.length === 0) return ["No parameters."];
	return parameters.map(
		({ name, in: location, type, required, description }) =>
			`- \`${name}\` (${location}, ${type}${required ? ", required" : ""})${description ? `: ${description}` : ""}`
	);
}

// The whole reference at /llms-full.txt, for agents that read docs as text.
export function getLlmsFull(appUrl) {
	const groups = getEndpointGroups(appUrl);
	return [
		"# MailCheap API and MCP reference",
		"",
		"Everything a MailCheap customer does in the dashboard works through the REST API and the MCP server. Both run the same actions as the dashboard, with the same plan limits, sender rules, pre-send checks, paused accounts and first-send steps.",
		"",
		"## Authentication",
		"",
		`Create an API key on the dashboard's API keys page and send it as \`Authorization: Bearer <key>\` to ${appUrl}${API_BASE_PATH} or to the MCP server at ${getMcpUrl(appUrl)}.`,
		"",
		"- Full access keys can do everything below, including creating more keys. Keep them on a server or in your AI assistant's settings.",
		"- Signups only keys can only add contacts (`POST /api/v1/contacts`, MCP tool `add_contact`), for signup forms in website code. That endpoint also answers browsers (CORS).",
		`- Every key gets ${REQUESTS_PER_KEY.limit} requests a minute across REST and MCP, and some actions have their own limit, for each key and for the account: its keys, connected apps and dashboard share the account's, so more keys don't raise it. Over a limit, the answer is 429 rate_limited.`,
		`- Keys are stored hashed and shown once. Revoked keys answer 401 unauthorized. An account has up to ${MAX_ACTIVE_API_KEYS} active keys.`,
		`- The MCP server also takes OAuth access tokens, for apps such as ChatGPT, Claude and Grok Bot: the user signs in to MailCheap and allows the app, which then has full access. Discovery starts at ${appUrl}/.well-known/oauth-protected-resource/mcp.`,
		"",
		"## Errors",
		"",
		"Every error answers `{ \"error\": { \"code\": \"…\", \"message\": \"…\" } }`. MCP tools answer the same object in an error result. Codes never change meaning:",
		"",
		...Object.entries(ERRORS).map(([code, { status, description }]) => `- \`${code}\` (${status}): ${description}`),
		"",
		"Sending a campaign that is already sending or sent answers `conflict`, so retrying a send never sends twice.",
		"",
		"## MCP",
		"",
		`The MCP server speaks Streamable HTTP at ${getMcpUrl(appUrl)}, without sessions. Each endpoint below is one tool with the same name, input and output; its annotations tell clients whether it's read-only, can't be undone, is safe to repeat or reaches outside MailCheap. The send tools can't be undone: ask the user before calling them.`,
		"",
		...getMcpConnectors(appUrl).flatMap(({ name, steps, note }) => [`### ${name}`, "", ...steps.map((step, index) => `${index + 1}. ${step}`), "", ...(note ? [note, ""] : [])]),
		...getMcpClients(appUrl).flatMap(({ name, file, code, note }) => [`### ${name}`, "", `${file}:`, "", "```", code, "```", "", note, ""]),
		"## Endpoints",
		"",
		...groups.flatMap(({ group, description, endpoints }) => [
			`### ${group}`,
			"",
			description,
			"",
			...endpoints.flatMap((endpoint) => [
				`#### ${endpoint.title}`,
				"",
				`\`${endpoint.method} ${endpoint.path}\` · MCP tool \`${endpoint.name}\` · ${endpoint.level}${hintsOf(endpoint.hints).length ? ` · ${hintsOf(endpoint.hints).join(", ")}` : ""}`,
				"",
				endpoint.description,
				"",
				...parameterLines(endpoint.parameters),
				"",
				"```bash",
				endpoint.curl,
				"```",
				"",
			]),
		]),
	].join("\n");
}
