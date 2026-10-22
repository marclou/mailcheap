import "server-only";
import * as z from "zod";
import { actionError, getErrorStatus, toActionError } from "@/lib/actions/errors";
import { ACTIONS } from "@/lib/actions/registry";
import { runAction } from "@/lib/actions/run-action";
import { authenticateRequest } from "@/lib/api-keys";
import { isRateLimited } from "@/lib/rate-limit";
import { isPlainObject } from "@/lib/validation";

export const API_BASE_PATH = "/api/v1";
// Every request with a key, REST and MCP alike, on top of each action's own limit.
export const REQUESTS_PER_KEY = { name: "api-requests", limit: 300, window: "1 m" };
// Signups only keys end up in website code, so the endpoint they can use answers browsers. The others
// don't: a full access key belongs on a server.
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-max-age": "86400",
};
const UNAUTHORIZED_HEADERS = { "www-authenticate": 'Bearer realm="MailCheap"' };

function countFixedSegments(segments) {
	return segments.filter((segment) => !segment.startsWith("{")).length;
}

// Fixed segments win over parameters: /contacts/export before /contacts/{id}.
const ROUTES = ACTIONS.map((action) => ({ action, segments: action.http.path.split("/").filter(Boolean) })).toSorted(
	(a, b) => countFixedSegments(b.segments) - countFixedSegments(a.segments)
);

function matchSegments(pattern, segments) {
	if (pattern.length !== segments.length) return null;
	const params = {};
	for (const [index, part] of pattern.entries()) {
		if (part.startsWith("{")) params[part.slice(1, -1)] = segments[index];
		else if (part !== segments[index]) return null;
	}
	return params;
}

// The action for a method and the path after /api/v1, or null.
export function matchRoute(method, segments) {
	for (const route of ROUTES) {
		if (route.action.http.method !== method) continue;
		const params = matchSegments(route.segments, segments);
		if (params) return { action: route.action, params };
	}
	return null;
}

export function getRestPath(action) {
	return `${API_BASE_PATH}${action.http.path}`;
}

const queryTypes = new Map();

// Query strings are text; numbers and booleans become what the action's schema expects.
function getQueryTypes(action) {
	if (!queryTypes.has(action.name)) {
		const { properties = {} } = z.toJSONSchema(action.input, { io: "input" });
		queryTypes.set(
			action.name,
			Object.fromEntries(
				Object.entries(properties).map(([key, schema]) => [key, [schema.type, ...(schema.anyOf ?? []).map(({ type }) => type)].flat()])
			)
		);
	}
	return queryTypes.get(action.name);
}

function coerce(value, types = []) {
	if ((types.includes("integer") || types.includes("number")) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (types.includes("boolean") && (value === "true" || value === "false")) return value === "true";
	return value;
}

export async function readInput(request, action) {
	if (request.method === "GET" || request.method === "DELETE") {
		const types = getQueryTypes(action);
		return Object.fromEntries([...new URL(request.url).searchParams].map(([key, value]) => [key, coerce(value, types[key])]));
	}
	const text = await request.text();
	if (!text.trim()) return {};
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		throw actionError("validation_failed", "Send a JSON object");
	}
	if (!isPlainObject(body)) throw actionError("validation_failed", "Send a JSON object");
	return body;
}

export function errorResponse(error, headers = {}) {
	const { code, message } = toActionError(error);
	return Response.json({ error: { code, message } }, { status: getErrorStatus(code), headers });
}

// segments: the path after /api/v1. Path parameters win over the same names in the body or query.
export async function handleRestRequest(request, segments = []) {
	const match = matchRoute(request.method, segments);
	if (!match) return errorResponse(actionError("not_found", `There's no ${request.method} ${API_BASE_PATH}/${segments.join("/")}`));
	const cors = match.action.permission === "signups" ? CORS_HEADERS : {};

	const auth = await authenticateRequest(request);
	if (!auth) {
		return errorResponse(actionError("unauthorized", "Send a valid API key: Authorization: Bearer <key>"), { ...cors, ...UNAUTHORIZED_HEADERS });
	}
	if (await isRateLimited({ ...REQUESTS_PER_KEY, key: String(auth.apiKey._id) })) {
		return errorResponse(actionError("rate_limited", "Too many requests with this key, try again in a minute"), { ...cors, "retry-after": "60" });
	}

	try {
		const input = { ...(await readInput(request, match.action)), ...match.params };
		const output = await runAction(match.action.name, { account: auth.account, apiKey: auth.apiKey, input, via: "api" });
		const { status } = match.action.http;
		return Response.json(output, { status: typeof status === "function" ? status(output) : status, headers: cors });
	} catch (error) {
		return errorResponse(error, cors);
	}
}

// Browsers ask first; only the signups endpoint says yes.
export function handleRestPreflight(request, segments = []) {
	const method = request.headers.get("access-control-request-method") ?? "POST";
	const match = matchRoute(method, segments);
	return new Response(null, { status: 204, headers: match?.action.permission === "signups" ? CORS_HEADERS : {} });
}
