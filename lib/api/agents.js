import "server-only";
import { authenticateAgentRequest } from "@/lib/agentonboard";
import { getErrorStatus, toActionError } from "@/lib/actions/errors";
import { runAction } from "@/lib/actions/run-action";
import { REQUESTS_PER_KEY, matchRoute, readInput } from "@/lib/api/rest";
import { isRateLimited } from "@/lib/rate-limit";

// The agents' mirror of the REST API: the same action routes one level under /api/v1/agents, an
// AgentOnboard token instead of an API key, and failures that answer its { code, error } shape so an
// agent can branch (agentonboard.xyz/docs/errors). Billing actions run too, where they can: without
// billing they answer 404 billing_off, with a plan the plan errors.
function agentFailure(code, errorText, status) {
	return Response.json({ code, error: errorText }, { status });
}

// segments: the path after /api/v1/agents, which is each action's http.path segments.
export async function handleAgentRestRequest(request, segments) {
	const match = matchRoute(request.method, segments);
	if (!match) return agentFailure("not_found", `Agents have no ${request.method} /${segments.join("/")}. The endpoints are in auth.md.`, 404);

	const auth = await authenticateAgentRequest(request);
	if (!auth.ok) return agentFailure(auth.code, auth.error, auth.status);
	if (await isRateLimited({ ...REQUESTS_PER_KEY, key: auth.apiKey._id })) {
		return agentFailure("rate_limited", "Too many requests with this identity, try again in a minute", 429);
	}

	try {
		const input = { ...(await readInput(request, match.action)), ...match.params };
		const output = await runAction(match.action.name, { account: auth.account, apiKey: auth.apiKey, user: auth.user, input, via: "api" });
		const { status } = match.action.http;
		return Response.json(output, { status: typeof status === "function" ? status(output) : status });
	} catch (error) {
		const { code, message } = toActionError(error);
		return agentFailure(code, message, getErrorStatus(code));
	}
}
