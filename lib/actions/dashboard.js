import "server-only";
import { getTeamAccess } from "@/lib/account-scope";
import { ERROR_CODES } from "@/lib/account-state";
import { toActionError } from "@/lib/actions/errors";
import { runAction } from "@/lib/actions/run-action";
import { requireAccount } from "@/lib/auth";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";

const UPGRADE_CODES = new Set(Object.values(ERROR_CODES));
// The owner's plan and account aren't the team's to change: their toast says who can, without the paywall.
const OWNER_NEEDED = {
	[ERROR_CODES.subscriptionRequired]: "This newsletter's owner needs a plan for this",
	[ERROR_CODES.accountBlocked]: "This newsletter's account is paused for now: its owner knows why",
	[ERROR_CODES.planLimitEmails]: "This newsletter's plan has no emails left this month: its owner can upgrade it",
	[ERROR_CODES.planLimitSubscribers]: "This newsletter's plan is over its subscribers: its owner can upgrade it",
};

// Every dashboard server action goes through here, so the dashboard runs exactly what an API key runs, in the account
// of the newsletter it has open (lib/selected-newsletter.js): the user's own, or one a team shares with them, with what
// their role there allows. An account without a plan runs only the actions marked tryWithoutPlan; the others fail with
// subscription_required, which opens the paywall. Failures come back as { failure: { code, message } }: a thrown error
// would replace the page with the error boundary.
export async function runDashboardAction(name, input) {
	const { user, account } = await getSelectedNewsletter();
	return run(name, { account, user, input });
}

// What the user does for their own account whichever newsletter is open: billing, and adding a newsletter of their own.
export async function runAccountAction(name, input) {
	const { user, account } = await requireAccount();
	return run(name, { account, user, input });
}

async function run(name, { account, user, input }) {
	try {
		return { output: await runAction(name, { account, user, input, via: "dashboard" }) };
	} catch (error) {
		const failure = toActionError(error);
		if (getTeamAccess(account) && UPGRADE_CODES.has(failure.code)) return { failure: { code: "forbidden", message: OWNER_NEEDED[failure.code] } };
		return { failure };
	}
}

// What toasts show. Plan and account codes stay, so the toast can link to billing.
export function toFormError({ code, message }) {
	return { error: message, ...(UPGRADE_CODES.has(code) && { code }) };
}

// Billing's failures go back to the billing page, which says what happened from ?error=.
export function toBillingError({ code }) {
	return code === "rate_limited" ? "rate_limited" : "stripe";
}
