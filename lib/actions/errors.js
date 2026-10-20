import { ERROR_CODES } from "../account-state.js";

// Stable codes: scripts and agents branch on them, so a code never changes meaning. The REST API answers
// with the status next to each code, MCP with the same { code, message } in an error result.
export const ERRORS = {
	unauthorized: { status: 401, description: "The API key is missing, malformed, unknown or revoked." },
	forbidden: { status: 403, description: "The key's level doesn't allow this action: a signups only key can only add contacts." },
	not_found: { status: 404, description: "The newsletter, campaign, contact, segment, domain or key isn't in this account." },
	validation_failed: { status: 400, description: "The input doesn't match the schema or breaks a rule. The message names the field." },
	conflict: {
		status: 409,
		description: "The resource's state doesn't allow it, e.g. sending a campaign that is already sending or sent. Retrying won't help.",
	},
	rate_limited: {
		status: 429,
		description: "Too many requests with this key, or too many of one action for the account, whose keys, apps and dashboard share its limits. Wait and retry.",
	},
	[ERROR_CODES.subscriptionRequired]: { status: 402, description: "The account has no active plan." },
	billing_off: {
		status: 404,
		description: "The server is self-hosted without billing: every account has every feature, without plan limits.",
	},
	[ERROR_CODES.planLimitEmails]: { status: 402, description: "The send needs more emails than the plan has left this month." },
	[ERROR_CODES.planLimitSubscribers]: { status: 402, description: "The account has more active subscribers than its plan allows." },
	[ERROR_CODES.accountBlocked]: {
		status: 403,
		description:
			"The account is blocked after spam signals (bounce or complaint rates, Gmail's spam rate in Google Postmaster Tools, a spam trap, the email provider) or by an admin. Nothing is sent, the tracked links in its emails stop redirecting, and only reads, pausing, unscheduling, revoking access and billing work until an admin unblocks it.",
	},
	sender_not_allowed: {
		status: 422,
		description: "The from address is neither the newsletter's shared address nor on a verified domain of this account.",
	},
	send_check_failed: {
		status: 422,
		description: "A pre-send check failed: no postal address, subject or content, the email is over 100 KB, or its segment was deleted.",
	},
	no_recipients: { status: 422, description: "Nobody is left to send to." },
	sending_disabled: { status: 503, description: "Sending is turned off on this server." },
	unavailable: { status: 503, description: "A service the action needs isn't configured or didn't answer. Retry later." },
	internal_error: { status: 500, description: "Something failed on MailCheap's side." },
};

export function actionError(code, message) {
	return Object.assign(new Error(message), { code, isActionError: true });
}

export function getErrorStatus(code) {
	return ERRORS[code]?.status ?? 500;
}

// Library errors that carry one of the codes above keep it; anything else is an internal error.
export function toActionError(error) {
	if (Object.hasOwn(ERRORS, error?.code ?? "")) return { code: error.code, message: error.message };
	return { code: "internal_error", message: "Something went wrong, try again in a minute" };
}

export function formatIssues(issues) {
	return issues
		.slice(0, 3)
		.map(({ path, message }) => (path.length > 0 ? `${path.join(".")}: ${message}` : message))
		.join("; ");
}
