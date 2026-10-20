import "server-only";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { canKeyUse } from "@/lib/actions/define-action";
import { actionError, toActionError } from "@/lib/actions/errors";
import { ACTIONS } from "@/lib/actions/registry";
import { runAction } from "@/lib/actions/run-action";
import { REQUESTS_PER_KEY, errorResponse } from "@/lib/api/rest";
import { readBearerToken } from "@/lib/api-key-tokens";
import { authenticateRequest } from "@/lib/api-keys";
import { getAppUrl } from "@/lib/config";
import { MAX_NEWSLETTERS_PER_ACCOUNT } from "@/lib/newsletters";
import { authenticateAccessToken, createUnauthorizedError, getOAuthChallenge } from "@/lib/oauth";
import { getMcpResource } from "@/lib/oauth-rules";
import { isRateLimited } from "@/lib/rate-limit";

export const MCP_SERVER_INFO = { name: "mailcheap", title: "MailCheap", version: "1.0.0" };
const SEND_TOOLS = ACTIONS.filter((action) => action.destructive && action.openWorld && action.group === "Campaigns").map(({ name }) => name);
export const MCP_INSTRUCTIONS = [
	`MailCheap runs newsletters. An account has up to ${MAX_NEWSLETTERS_PER_ACCOUNT}, sharing its plan's emails and subscribers. Tools that take a newsletter use the account's first one when it's left out: when list_newsletters shows several, ask which one the user means and pass its slug.`,
	`Sending can't be undone. Before ${SEND_TOOLS.join(", ")}, show the user the subject and how many contacts it goes to, and ask them to confirm. Prefer send_test_email first.`,
	"A failed call answers { error: { code, message } }: conflict means the campaign is already sending or sent (don't retry); plan_limit_emails and plan_limit_subscribers mean the user has to upgrade (change_plan returns a link).",
].join("\n");

export function getToolAnnotations(action) {
	return {
		title: action.title,
		readOnlyHint: action.readOnly,
		destructiveHint: action.destructive,
		idempotentHint: action.idempotent,
		openWorldHint: action.openWorld,
	};
}

function toToolResult(output) {
	return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

function toToolError(error) {
	const { code, message } = toActionError(error);
	return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}

// One server per request, holding only the tools the key's level can use. OAuth tokens have full access.
// The tool list never changes during a connection, and saying it may (the SDK's default) has 2026-07-28 clients
// such as Claude hold a subscriptions/listen stream open until the function times out.
const CAPABILITIES = { tools: { listChanged: false } };

function createServer({ authInfo }) {
	const { account, apiKey, connection, user, level } = authInfo.extra;
	const server = new McpServer(MCP_SERVER_INFO, { capabilities: CAPABILITIES, instructions: MCP_INSTRUCTIONS, maxToolInputElements: 12_000 });
	for (const action of ACTIONS) {
		if (!canKeyUse(level, action)) continue;
		server.registerTool(
			action.name,
			{
				title: action.title,
				description: action.description,
				inputSchema: action.input,
				outputSchema: action.output,
				annotations: getToolAnnotations(action),
			},
			async (input) => {
				try {
					return toToolResult(await runAction(action.name, { account, apiKey, connection, user, input, via: "mcp" }));
				} catch (error) {
					return toToolError(error);
				}
			}
		);
	}
	return server;
}

// Streamable HTTP, stateless: the 2026-07-28 protocol, and 2025-era clients (initialize, then calls)
// served by the SDK's stateless fallback. ChatGPT and Claude are on the 2025 revisions.
const handler = createMcpHandler(createServer, { onerror: (error) => console.error("[mcp]", error.message) });

// An API key, as Claude Code, Codex and Cursor send it, or an OAuth access token from ChatGPT or Claude. Either
// decides the account; requests are limited per key or per connected app.
async function authenticate(request) {
	if (readBearerToken(request.headers.get("authorization"))) {
		const auth = await authenticateRequest(request);
		if (!auth) throw createUnauthorizedError("Send a valid API key: Authorization: Bearer <key>");
		return { authInfo: { token: auth.apiKey.prefix, clientId: String(auth.apiKey._id), scopes: [auth.level], extra: auth }, limitKey: String(auth.apiKey._id) };
	}
	const auth = await authenticateAccessToken(request);
	return {
		authInfo: {
			token: auth.connection.id,
			clientId: auth.connection.clientId,
			scopes: auth.scopes,
			expiresAt: auth.expiresAt,
			resource: new URL(getMcpResource(getAppUrl())),
			extra: { ...auth, level: "full" },
		},
		limitKey: `oauth-${auth.connection.id}`,
	};
}

export async function handleMcpRequest(request) {
	let auth;
	try {
		auth = await authenticate(request);
	} catch (error) {
		// The challenge points at /.well-known/oauth-protected-resource/mcp, where ChatGPT and Claude start OAuth.
		const challenge = getOAuthChallenge(error);
		if (!challenge) throw error;
		return errorResponse(actionError(challenge.status === 403 ? "forbidden" : "unauthorized", error.message), { "www-authenticate": challenge.header });
	}
	if (await isRateLimited({ ...REQUESTS_PER_KEY, key: auth.limitKey })) {
		return errorResponse(actionError("rate_limited", "Too many requests with this key, try again in a minute"), { "retry-after": "60" });
	}
	return handler.fetch(request, { authInfo: auth.authInfo });
}
