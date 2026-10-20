import "server-only";
import * as z from "zod";
import { getPathParams } from "@/lib/actions/define-action";
import { ACTIONS, ACTION_GROUPS, getAction } from "@/lib/actions/registry";
import { API_BASE_PATH } from "@/lib/api/rest";

export const GROUP_DESCRIPTIONS = {
	Overview: "Subscribers, email results and sends per hour, as on the dashboard's first page.",
	Newsletters: "Sender, postal address, welcome and confirmation emails, list cleanup, archive and theme.",
	Campaigns: "Drafts, test emails, scheduling, sending, sending in steps and reports.",
	Contacts: "Search, signups, imports with checks, status changes, deletes and exports.",
	Segments: "Saved conditions that pick some of a newsletter's contacts by engagement, signup date, source or address, to send campaigns to them only.",
	Domains: "Own sending domains with their DNS records, and the shared address.",
	Images: "Pictures for campaign content, on MailCheap's CDN, kept in the account's library to use again.",
	"API keys": "Keys for the REST API and MCP.",
	Billing: "Plan, usage and links to Stripe to change plan.",
};

const EXAMPLE_ID = "6650f1c2e9b1d4a012345678";

export function toJsonSchema(schema, io = "input") {
	const { $schema, ...json } = z.toJSONSchema(schema, { io, unrepresentable: "any" });
	return json;
}

export function getSlug(action) {
	return action.name.replaceAll("_", "-");
}

function describeType(schema = {}) {
	if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
	const types = [schema.type, ...(schema.anyOf ?? []).map(({ type }) => type)].flat().filter(Boolean);
	if (types.includes("array")) return `${describeType(schema.items)}[]`;
	return [...new Set(types)].join(" | ") || "any";
}

// Top-level fields, plus the fields of objects and of arrays of objects one level down.
function flattenFields(schema, location, prefix = "") {
	const required = new Set(schema.required ?? []);
	return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
		const path = `${prefix}${name}`;
		const row = { name: path, in: location, type: describeType(field), required: required.has(name), description: field.description ?? "" };
		const nested = field.type === "object" ? field : field.type === "array" && field.items?.type === "object" ? field.items : null;
		if (!nested || prefix) return [row];
		const childPrefix = field.type === "array" ? `${path}[].` : `${path}.`;
		return [{ ...row, type: field.type === "array" ? "object[]" : "object" }, ...flattenFields(nested, location, childPrefix)];
	});
}

function getParameters(action) {
	const schema = toJsonSchema(action.input);
	const pathParams = new Set(getPathParams(action.http.path));
	const location = ["GET", "DELETE"].includes(action.http.method) ? "query" : "body";
	return flattenFields(schema, location).map((row) => (pathParams.has(row.name) ? { ...row, in: "path", required: true } : row));
}

function exampleValue(name) {
	const examples = { id: EXAMPLE_ID, email: "jane@example.com", newsletter: "weekly", subject: "This week", previewText: "Three links worth your time" };
	return examples[name] ?? "…";
}

function getExampleBody(action, example) {
	const parameters = getParameters(action);
	const body = Object.fromEntries(
		parameters.filter((row) => row.in === "body" && row.required && !row.name.includes(".")).map((row) => [row.name, exampleValue(row.name)])
	);
	return { ...body, ...example };
}

export function getExamplePath(action) {
	return action.http.path.replaceAll(/\{[a-zA-Z]+\}/g, EXAMPLE_ID);
}

export function getCurlExample(action, appUrl, { apiKey = "$MAILCHEAP_API_KEY", example = action.example } = {}) {
	const isQuery = ["GET", "DELETE"].includes(action.http.method);
	const query = isQuery ? new URLSearchParams(Object.entries(example).map(([key, value]) => [key, String(value)])).toString() : "";
	const url = `${appUrl}${API_BASE_PATH}${getExamplePath(action)}${query ? `?${query}` : ""}`;
	const lines = [`curl${action.http.method === "GET" ? "" : ` -X ${action.http.method}`} "${url}"`, `  -H "Authorization: Bearer ${apiKey}"`];
	if (!isQuery) {
		const body = getExampleBody(action, example);
		if (Object.keys(body).length > 0) {
			lines.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(body).replaceAll("'", "'\\''")}'`);
		}
	}
	return lines.join(" \\\n");
}

// The contacts page's first signup, for one of the account's newsletters, with a key to paste in.
export function getAddContactCurl(appUrl, newsletterSlug) {
	return getCurlExample(getAction("add_contact"), appUrl, {
		apiKey: "YOUR_API_KEY",
		example: newsletterSlug ? { newsletter: newsletterSlug } : {},
	});
}

// What /docs/api, /llms-full.txt and the OpenAPI document say about each endpoint.
export function getEndpoints(appUrl) {
	return ACTIONS.map((action) => ({
		name: action.name,
		slug: getSlug(action),
		title: action.title,
		description: action.description,
		group: action.group,
		method: action.http.method,
		path: `${API_BASE_PATH}${action.http.path}`,
		level: action.permission === "signups" ? "Full access or signups only" : "Full access",
		requiresPlan: action.requiresPlan,
		hints: { readOnly: action.readOnly, destructive: action.destructive, idempotent: action.idempotent, openWorld: action.openWorld },
		parameters: getParameters(action),
		curl: getCurlExample(action, appUrl),
	}));
}

export function getEndpointGroups(appUrl) {
	const endpoints = getEndpoints(appUrl);
	return ACTION_GROUPS.map((group) => ({
		group,
		slug: group.toLowerCase().replaceAll(" ", "-"),
		description: GROUP_DESCRIPTIONS[group] ?? "",
		endpoints: endpoints.filter((endpoint) => endpoint.group === group),
	}));
}
