import "server-only";
import { getTeamAccess } from "@/lib/account-scope";
import { ERROR_CODES, getBlockedMessage, hasActiveSubscription, isBlocked, isDeletionPending } from "@/lib/account-state";
import { canKeyUse } from "@/lib/actions/define-action";
import { ERRORS, actionError, formatIssues } from "@/lib/actions/errors";
import { getAction } from "@/lib/actions/registry";
import { getKeyLevel } from "@/lib/api-keys";
import { connectDb } from "@/lib/db";
import { formatWindow } from "@/lib/format";
import { isRateLimited } from "@/lib/rate-limit";
import { getSupportChatUrl } from "@/lib/support";
import { hasRole } from "@/lib/team-rules";

// Each API key and connected app counts on its own and against its account, which the dashboard's calls count
// against too (limitDashboard): an account gets an action's limit once, however many keys and apps it has.
function getRateLimits({ action, account, input, via, apiKey, connection }) {
	if (!action.rateLimit) return {};
	const perAccount = { name: `account-${action.name}`, ...action.rateLimit, key: String(account._id) };
	const caller = apiKey ? String(apiKey._id) : connection && `oauth-${connection.id}`;
	if (caller) return { perCaller: { name: `api-${action.name}`, ...action.rateLimit, key: caller }, perAccount };
	if (via !== "dashboard") return {};
	const { limitDashboard } = action;
	const counts = typeof limitDashboard === "function" ? limitDashboard(input ?? {}) : limitDashboard;
	return counts ? { perAccount } : {};
}

// "Send a test email" -> "You can send a test email 30 times an hour. Try again later."
function getDashboardLimitMessage({ title, rateLimit }) {
	return `You can ${title[0].toLowerCase()}${title.slice(1)} ${rateLimit.limit} times ${formatWindow(rateLimit.window)}. Try again later.`;
}

// "Send a campaign now" -> "Only the newsletter's admins can send a campaign now"
function getRoleMessage({ title, role }) {
	const who = role === "admin" ? "the newsletter's admins" : "the account's owner";
	return `Only ${who} can ${title[0].toLowerCase()}${title.slice(1)}`;
}

// The one way in for the dashboard (via "dashboard", a signed-in user), the REST API ("api") and MCP
// ("mcp"), with an API key or, on MCP, an app connected with OAuth (connection, full access, with its user).
// Same permission, plan, rate limit and input checks for all of them. Throws errors with a code from
// lib/actions/errors.js. A member of a newsletter's team works in its owner's account (lib/account-scope.js), from the
// dashboard alone: their role has to allow the action, and it runs on their newsletter, the one a left-out newsletter
// input means and the only one the lookups find.
export async function runAction(name, { account, input = {}, via, user = null, apiKey = null, connection = null }) {
	const action = getAction(name);
	if (!action) throw actionError("not_found", `There's no ${name} action`);
	if (isDeletionPending(account)) throw actionError("unauthorized", "This account is being deleted");
	const team = getTeamAccess(account);
	if (team && (via !== "dashboard" || !hasRole(team.role, action.role))) throw actionError("forbidden", getRoleMessage(action));
	if (apiKey && !canKeyUse(getKeyLevel(apiKey), action)) {
		throw actionError("forbidden", `This key can only add contacts: ${name} needs a full access key`);
	}
	if (isBlocked(account) && !action.whileBlocked) {
		throw actionError(ERROR_CODES.accountBlocked, getBlockedMessage(account, via === "dashboard" ? null : getSupportChatUrl()));
	}
	const isTrial = via === "dashboard" && action.tryWithoutPlan;
	if (action.requiresPlan && !isTrial && !hasActiveSubscription(account)) {
		throw actionError(ERROR_CODES.subscriptionRequired, "The account has no active plan");
	}
	const { perCaller, perAccount } = getRateLimits({ action, account, input, via, apiKey, connection });
	if (perCaller && (await isRateLimited(perCaller))) throw actionError("rate_limited", `Too many ${name} calls, try again later`);
	if (perAccount && (await isRateLimited(perAccount))) {
		throw actionError("rate_limited", via === "dashboard" ? getDashboardLimitMessage(action) : `Too many ${name} calls on this account, try again later`);
	}
	const schema = via === "dashboard" && action.dashboardInput ? action.input.extend(action.dashboardInput.shape) : action.input;
	const values = team && "newsletter" in schema.shape && !input?.newsletter ? { ...input, newsletter: team.newsletterId } : input;
	const parsed = schema.safeParse(values ?? {});
	if (!parsed.success) throw actionError("validation_failed", formatIssues(parsed.error.issues));

	await connectDb();
	try {
		return await action.handler({ account, input: parsed.data, via, user, apiKey, connection });
	} catch (error) {
		if (!Object.hasOwn(ERRORS, error?.code ?? "")) console.error(`[actions] ${name} failed:`, error);
		throw error;
	}
}
