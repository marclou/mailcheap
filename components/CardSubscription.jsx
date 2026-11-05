import BadgeStatus from "@/components/BadgeStatus";
import { getAccountStatus, getBlockedMessage, getBlockedPlanEnd } from "@/lib/account-state";
import { formatDate } from "@/lib/format";
import { getAccountPlan, getPrice, isOnFreePlan } from "@/lib/plans";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function CardSubscription({ account }) {
	const plan = getAccountPlan(account);
	const status = getAccountStatus(account);
	const details = getPlanDetails(account);
	const warning = status === "blocked" ? getBlockedMessage(account) : WARNINGS[status];

	return (
		<div className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-border animate-enter sm:p-6">
			<div className="flex flex-wrap items-center gap-2.5">
				<h2 className="text-lg font-semibold tracking-tight">{plan?.name ?? "No plan"}</h2>
				<BadgeStatus status={status} />
			</div>
			{details.length > 0 && <p className="text-sm text-muted-foreground tabular-nums">{details.join(" · ")}</p>}
			{warning && <p className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>}
		</div>
	);
}

// The price and the next date, here and on the account page. A free plan has its end date, if it has one, and a
// blocked account's plan isn't billed (lib/billing-pause.js), and ends unless it's unblocked first.
export function getPlanDetails(account) {
	const plan = getAccountPlan(account);
	if (isOnFreePlan(account)) {
		return [`Free ${plan.name} plan from MailCheap`, account.comp.until && `Ends ${formatDate(account.comp.until)}`].filter(Boolean);
	}
	const price = plan && `${usd.format(getPrice(plan, account.interval))} per ${account.interval}`;
	const blockedEnd = getBlockedPlanEnd(account.billingPausedAt);
	if (blockedEnd && !(account.cancelAt && new Date(account.cancelAt) < blockedEnd)) {
		return [price, "Not billed while blocked", `Ends ${formatDate(blockedEnd)} unless unblocked`].filter(Boolean);
	}
	const nextDate = account.cancelAt ? `Ends ${formatDate(account.cancelAt)}` : account.currentPeriodEnd && `Renews ${formatDate(account.currentPeriodEnd)}`;
	return [price, nextDate].filter(Boolean);
}

const WARNINGS = {
	past_due: "Your last payment failed. Update your card in billing to keep sending.",
};
