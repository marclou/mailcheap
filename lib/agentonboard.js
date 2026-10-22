import "server-only";
import mongoose from "mongoose";
import { after } from "next/server";
import { APIError } from "better-auth/api";
import { normalizeEmail, verifyAgentToken } from "@agentonboard/sdk";
import { sendAlert } from "@/lib/alerts";
import { AUTH_MODELS, ensureAccount, isUserAllowed } from "@/lib/accounts";
import { isDeletionPending } from "@/lib/account-state";
import { getAuth } from "@/lib/auth";
import { getAppUrl, isCloud } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { ACTIONS } from "@/lib/actions/registry";
import { formatWindow } from "@/lib/format";
import { getOAuthIssuer } from "@/lib/oauth-rules";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import Account from "@/models/Account";

// AgentOnboard (agentonboard.xyz) is identity for AI agents. An agent setup mints a 5-minute RS256 token
// for this server's hostname from its holder's AgentOnboard key; the token verifies here against
// AgentOnboard's public keys and carries the person's verified email. Acting with one means what that
// person's own full access API key would: the account the email maps to scopes every query, and
// runAction's permission, plan and rate-limit checks run unchanged.

// The base path agents call. It mirrors lib/api/rest.js's routes, from the same ACTIONS registry.
export const AGENT_API_BASE = "/api/v1/agents";

// A token is three dot-joined segments: an API key is one mc_ string, and the one other bearer JWT — an
// OAuth access token — names this server as its issuer, so both hold first.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function readAgentBearer(authorization) {
	const match = /^Bearer\s+(\S+)$/i.exec(String(authorization ?? "").trim());
	return match ? match[1] : null;
}

export function isAgentToken(token) {
	return TOKEN_PATTERN.test(String(token ?? "")) && readClaims(token) && readClaims(token).iss !== getOAuthIssuer(getAppUrl());
}

function readClaims(token) {
	try {
		return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
	} catch {
		return null;
	}
}

// The audience tokens are minted for: the bare hostname this server answers on — what auth.md publishes
// and what the token verification checks, the same string.
export function getAgentAudience() {
	return new URL(getAppUrl()).hostname;
}

// The keys a test signs with, instead of a JWKS over the network: the SDK's jwks option is how a test
// supplies keys (agentonboard.xyz/docs/verify), and no test may reach the network.
let testJwks = null;

export function setAgentonboardJwksForTests(keys) {
	testJwks = keys;
}

// Where a code answers: token failures are an API key's 401, except the identity being real but
// accountless — 403, since re-authenticating can't create an account — and our lookup failing, 500.
const CODE_STATUS = { ACCOUNT_REQUIRED: 403, CONFIG_ERROR: 500, RESOLVER_ERROR: 500 };

export function statusForAgentCode(code) {
	return CODE_STATUS[code] ?? 401;
}

function agentResponse(code, error, status) {
	return Response.json({ code, error }, { status });
}

// The verified identity or the SDK's failure, which it never throws (agentonboard.xyz/docs/errors).
async function verifyToken(token) {
	try {
		return await verifyAgentToken({
			token,
			audience: getAgentAudience(),
			...(testJwks && { jwks: testJwks }),
		});
	} catch {
		return { ok: false, code: "MALFORMED_TOKEN", error: "The token is not one this server can check" };
	}
}

async function findAgentUser(email) {
	await connectDb();
	return mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.findOne({ email: normalizeEmail(email) }, { projection: { email: 1, emailVerified: 1 } });
}

// The user and the account a verified email resolves to, or null: no user, an owner off a self-hosted
// server's allowlist, or an account waiting to be deleted. A lookup that fails stays a throw, answered as
// RESOLVER_ERROR — never as a missing account.
async function resolveAgentAccount(email) {
	const user = await findAgentUser(email);
	if (!user || (!isCloud() && !isUserAllowed(user))) return null;
	const account = (await Account.findOne({ ownerId: user._id }).lean()) ?? (await ensureAccount(user._id));
	if (!account || isDeletionPending(account)) return null;
	return { user: { id: String(user._id), email: user.email }, account };
}

function agentFailure(code, error) {
	return { ok: false, code, error, status: statusForAgentCode(code) };
}

// The agent identity for an MCP (lib/mcp/server.js) or agent API (lib/api/agents.js) request: what a full
// access key carries, with an apiKey shape that only names the identity the rate limiters count — the
// token's subject, the verified email — never a stored key.
export async function authenticateAgentRequest(request) {
	const token = readAgentBearer(request.headers.get("authorization"));
	if (!token) return agentFailure("MALFORMED_TOKEN", "Send an agent identity: Authorization: Bearer <token>");
	const identity = await verifyToken(token);
	if (!identity.ok) return agentFailure(identity.code, identity.error);

	let resolved;
	try {
		resolved = await resolveAgentAccount(identity.email);
	} catch (error) {
		console.error("[agentonboard] account lookup failed:", error.message);
		return agentFailure("RESOLVER_ERROR", "The account lookup failed, try again in a minute");
	}
	if (!resolved) {
		return agentFailure(
			"ACCOUNT_REQUIRED",
			isCloud()
				? `This identity has no MailCheap account yet: create one at POST ${AGENT_API_BASE}/signup with the same token, then retry this request once`
				: `This identity has no account on this server: sign in once at ${getAppUrl()}/signin, then retry this request once`
		);
	}
	return {
		ok: true,
		account: resolved.account,
		user: resolved.user,
		level: "full",
		apiKey: { _id: `agent:${normalizeEmail(identity.email)}`, name: "AgentOnboard", level: "full", prefix: "agent" },
		email: normalizeEmail(identity.email),
	};
}

// The POST /api/v1/agents/signup handler, MailCheap Cloud only. The one endpoint that may open an
// account: the human signup rules run in Better Auth's user-create hooks (lib/auth.js), so an agent gets
// nobody signed up with an address a human couldn't sign up with.
export async function handleAgentSignup(request) {
	if (!isCloud()) return agentResponse("not_found", "This server has no agent signup: sign in the usual way, then use a key", 404);

	const token = readAgentBearer(request.headers.get("authorization"));
	if (!token) return agentResponse("MALFORMED_TOKEN", "Send an agent identity: Authorization: Bearer <token>", 401);
	const identity = await verifyToken(token);
	if (!identity.ok) return agentResponse(identity.code, identity.error, statusForAgentCode(identity.code));
	const email = normalizeEmail(identity.email);

	let user;
	try {
		user = await findAgentUser(email);
	} catch (error) {
		console.error("[agentonboard] account lookup failed:", error.message);
		return agentResponse("RESOLVER_ERROR", "The account lookup failed, try again in a minute", 500);
	}
	// The identity's own count, so one valid token can't hammer this endpoint however its requests answer.
	if (await isRateLimited({ name: "agent-signup", limit: 10, window: "1 m", key: email })) {
		return agentResponse("rate_limited", "Too many signups for this identity just now, try again in a minute", 429);
	}
	if (user) {
		try {
			const account = await Account.findOne({ ownerId: user._id }).lean();
			// On its way out, the human restores it: not rebuilt.
			if (isDeletionPending(account)) {
				return agentResponse("signup_not_allowed", "An account exists at this address and is being deleted; its human can restore it by signing in", 403);
			}
			// A user row without its account, left by an interruption, just needs the account finished — never
			// a second user for the same email, which the unique address would refuse.
			const created = !account;
			const ready = account ?? (await ensureAccount(user._id));
			if (created) agentAccountAlert(ready, email);
			return Response.json({ user: String(user._id), created }, { status: 201 });
		} catch (error) {
			console.error("[agentonboard] signup failed:", error.message);
			return agentResponse("RESOLVER_ERROR", "Creating the account failed, try again in a minute", 500);
		}
	}

	// The per-IP cap of the human signups, counted apart: an agent signs up from wherever it runs.
	if (await isRateLimited({ name: "agent-signup-ip", limit: 3, window: "1 d", key: getClientIp(request.headers) })) {
		return agentResponse("rate_limited", "Too many agent signups from this address today: try again tomorrow", 429);
	}

	try {
		const auth = await getAuth();
		const created = await (await auth.$context).internalAdapter.createUser({ email, name: "", emailVerified: true });
		const id = String(created.id ?? created._id);
		const account = await ensureAccount(id);
		agentAccountAlert(account, email);
		return Response.json({ user: id, created: true }, { status: 201 });
	} catch (error) {
		// The refusals are the user-create hooks (a throwaway inbox, one another account reaches), which
		// throw as Better Auth's APIError: no account was made, so this is a refusal, not a lookup failure.
		if (error instanceof APIError) {
			return agentResponse("signup_not_allowed", error.message ?? error.body?.message ?? "This address can't sign up here", 403);
		}
		console.error("[agentonboard] signup failed:", error.message);
		return agentResponse("RESOLVER_ERROR", "Creating the account failed, try again in a minute", 500);
	}
}

// The owner's receipt: the signup endpoint is the one place an account opens without the human at the
// keyboard, so they hear about it at once.
function agentAccountAlert(account, email) {
	after(() =>
		sendAlert({
			accountId: account._id,
			key: "agent-account-created",
			title: "Your agent created this MailCheap account",
			detail: `An AI agent signed the account of ${email} up through AgentOnboard.`,
			action: `If that wasn't you, delete the account on the account page: ${getAppUrl()}/account.`,
			cooldownMinutes: 0,
		})
	);
}

// The discovery file an agent reads before it mints (agentonboard.xyz/docs/auth-md): the audience, the
// endpoints under AGENT_API_BASE, and the rejection table — every code these responses return, and only
// those.
export function getAgentAuthMd() {
	const appUrl = getAppUrl();
	const audience = getAgentAudience();
	const lines = [
		"# MailCheap agent API",
		"",
		"This service accepts AgentOnboard. A verified agent request runs as the account the verified email maps to, with everything that account's full access API key can do: the actions documented at",
		`${appUrl}/docs/api, each under ${AGENT_API_BASE}.`,
		"",
		"## Audience",
		"",
		`\`${audience}\``,
		"",
		`    get_token(domain: "${audience}")`,
		"",
		"Send the token on every request as `Authorization: Bearer <token>`.",
		"",
		"## Endpoints",
		"",
	];
	if (isCloud()) {
		lines.push(
			`### \`POST ${AGENT_API_BASE}/signup\``,
			"",
			"Create the calling account. This is the one endpoint that may mint an account: an agent that got `403 ACCOUNT_REQUIRED` elsewhere calls it with the same token, then retries its original request. Calling it for an email that already has an account signs in instead — no duplicate.",
			"",
			"- Request: no body",
			"- Success: `201` with `{ user: string, created: boolean }`",
			"",
		);
	}
	for (const action of ACTIONS) {
		lines.push(`### \`${action.http.method} ${AGENT_API_BASE}${action.http.path}\``, "", `- ${action.title}.`);
		if (action.rateLimit) lines.push(`- ${action.rateLimit.limit} calls ${formatWindow(action.rateLimit.window)} for the identity and its account.`);
		lines.push("", `Request and response fields: ${appUrl}/docs/api.`, "");
	}
	lines.push(
		"## When a request is rejected",
		"",
		"| Status | code | What to do |",
		"|---|---|---|",
		`| 401 | any | The token was rejected. Call the get_token tool for \`${audience}\` again and retry **once**. If it fails again, stop and tell the human — do not retry in a loop. |`,
	);
	if (isCloud()) {
		lines.push(
			`| 403 | ACCOUNT_REQUIRED | The identity is genuine but has no MailCheap account. Create one at \`POST ${AGENT_API_BASE}/signup\` with the same token, then retry the original request **once**. Retrying without that will never work. |`,
			"| 403 | signup_not_allowed | This address can't open an account here: a throwaway inbox, one another account reaches, or an account being deleted. Stop and tell the human. |",
		);
	} else {
		lines.push(
			`| 403 | ACCOUNT_REQUIRED | The identity is genuine but has no account on this server. Ask the human to sign in once at ${appUrl}/signin, then retry the original request **once**. Retrying without that will never work. |`,
		);
	}
	lines.push(
		`| 402 | subscription_required | The account has no plan. Tell the human to pick one at ${appUrl}/billing. |`,
		"| 429 | rate_limited | Too many requests, or too many of one action. Wait, then slow down. |",
		"| 500 | RESOLVER_ERROR | MailCheap's account lookup failed. Retry after a short delay; do not re-authenticate, the token is fine. |",
		`| any other | MailCheap's own codes | The request reached the account and the action answered; branch on code as the docs describe: ${appUrl}/docs/errors. |`,
	);
	return lines.join("\n");
}
