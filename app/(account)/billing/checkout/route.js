import { redirect } from "next/navigation";
import { hasActiveSubscription } from "@/lib/account-state";
import { runAccountAction, toBillingError } from "@/lib/actions/dashboard";
import { getCurrentAccount } from "@/lib/auth";
import { getPlan, isOnFreePlan, readInterval } from "@/lib/plans";

// The plans slider's Subscribe link, on the public pages, the paywall and billing: Stripe Checkout for that plan.
// Accounts that already pay get the billing page, where a plan change is confirmed on Stripe; one on a free plan gets
// Checkout. A plan that isn't on sale (change_plan's validation_failed) gets the billing page too.
export async function GET(request) {
	const url = new URL(request.url);
	const plan = getPlan(url.searchParams.get("plan"));
	const interval = readInterval(url.searchParams.get("interval"));
	const current = await getCurrentAccount();
	if (!current) redirect(`/signin?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	if (!plan || (hasActiveSubscription(current.account) && !isOnFreePlan(current.account))) redirect(`/billing?interval=${interval}`);

	const { output, failure } = await runAccountAction("change_plan", { plan: plan.id, interval });
	if (failure?.code === "validation_failed") redirect(`/billing?interval=${interval}`);
	redirect(failure ? `/billing?interval=${interval}&error=${toBillingError(failure)}` : output.url);
}
