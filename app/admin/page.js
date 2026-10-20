import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import CardPostmaster from "@/components/CardPostmaster";
import CardSendingCapacity from "@/components/CardSendingCapacity";
import CardSettings from "@/components/CardSettings";
import CardStat from "@/components/CardStat";
import CardUndeliverable from "@/components/CardUndeliverable";
import ChartSendsDaily from "@/components/ChartSendsDaily";
import HeaderPage from "@/components/HeaderPage";
import ListAttention from "@/components/ListAttention";
import { SkeletonSendingCapacity, SkeletonSesAccount } from "@/components/SkeletonOverview";
import StateEmpty from "@/components/StateEmpty";
import TableAccounts from "@/components/TableAccounts";
import TableRecentCampaigns from "@/components/TableRecentCampaigns";
import TextEmpty from "@/components/TextEmpty";
import { Input } from "@/components/ui/input";
import { listAccountsForAdmin } from "@/lib/accounts";
import { getAccountTotals, getEmailStats, listAttention, listRecentCampaigns } from "@/lib/admin-stats";
import { requireAdmin } from "@/lib/auth";
import { LIMITS, isCloud } from "@/lib/config";
import { formatNumber, formatPercent } from "@/lib/format";
import { countGlobalSuppressions } from "@/lib/global-suppressions";
import { getSendingCapacity } from "@/lib/sending-capacity";
import { serialize } from "@/lib/serialize";
import { cn } from "@/lib/utils";
import { isObjectIdString } from "@/lib/validation";

const MAX_SEARCH_LENGTH = 100;
const ACCOUNTS_SHOWN = 50;

export const metadata = { title: "Overview" };

// The numbers count the whole database; the list shows the newest 50 accounts, or the ones ?q= matches. ?account=<id>,
// where the support chat links: that account first and selected, however old it is.
export default async function AdminPage({ searchParams }) {
	await requireAdmin();
	const { postmaster, account, q } = await searchParams;
	const search = typeof q === "string" ? q.trim().slice(0, MAX_SEARCH_LENGTH) : "";
	const pinnedId = isObjectIdString(account) ? account : null;
	const now = new Date();
	const capacity = getSendingCapacity({ now });
	const [totals, emails, campaigns, attention, accounts, pinned, undeliverable] = await Promise.all([
		getAccountTotals({ now }),
		getEmailStats({ now }),
		listRecentCampaigns(),
		listAttention({ now }),
		listAccountsForAdmin({ search, limit: ACCOUNTS_SHOWN }),
		pinnedId ? listAccountsForAdmin({ accountId: pinnedId }) : [],
		countGlobalSuppressions(),
	]);
	const hasPlans = isCloud();
	const listed = [...pinned, ...accounts.filter(({ _id }) => String(_id) !== pinnedId)];

	return (
		<>
			<HeaderPage title="Overview" />
			<div className="flex flex-col gap-8">
				<div className={cn("grid grid-cols-2 gap-3 animate-enter", hasPlans ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
					<CardStat label="Accounts" value={formatNumber(totals.accounts)} detail={`${formatNumber(totals.newThisWeek)} new this week`} />
					{hasPlans && <CardStat label="Paying" value={formatNumber(totals.paying)} detail={describePaying(totals)} />}
					<CardStat label="Blocked" value={formatNumber(totals.blocked)} tone={totals.blocked > 0 ? "warn" : "default"} />
					<CardStat label="Emails sent" value={formatNumber(emails.sent)} detail="Last 30 days" />
				</div>

				<div className="grid gap-8 lg:grid-cols-3">
					<CardSettings
						title="Emails"
						action={<span className="text-xs text-muted-foreground">Customers, last 30 days</span>}
						stagger={1}
						className="min-w-0 lg:col-span-2"
					>
						<dl className="grid grid-cols-3 gap-px bg-border/60">
							<Metric label="Bounces" value={emails.bounceRate} limit={LIMITS.pause.bounceRate} />
							<Metric label="Spam complaints" value={emails.complaintRate} limit={LIMITS.pause.complaintRate} />
							<div className="flex flex-col gap-1 bg-card px-4 py-3">
								<dt className="text-xs text-muted-foreground">Sent, all time</dt>
								<dd className="text-lg font-semibold tracking-tight tabular-nums">{formatNumber(emails.total)}</dd>
							</div>
						</dl>
						<div className="px-4 pt-5 pb-4">
							<ChartSendsDaily days={emails.days} />
						</div>
					</CardSettings>
					<Suspense fallback={<SkeletonSendingCapacity />}>
						<CardSendingCapacity capacity={capacity} />
					</Suspense>
				</div>

				<div style={{ "--stagger": 2 }} className="grid gap-8 animate-enter lg:grid-cols-3">
					<section className="flex min-w-0 flex-col gap-3 lg:col-span-2">
						<h2 className="text-sm font-medium text-muted-foreground">Recent campaigns</h2>
						<TableRecentCampaigns campaigns={serialize(campaigns)} />
					</section>
					<section className="flex min-w-0 flex-col gap-3">
						<h2 className="text-sm font-medium text-muted-foreground">Needs a look</h2>
						<ListAttention attention={serialize(attention)} now={now.getTime()} />
					</section>
				</div>

				<section style={{ "--stagger": 3 }} className="flex flex-col gap-3 animate-enter">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-sm font-medium text-muted-foreground">
							Accounts
							<span className="font-normal tabular-nums">
								{search
									? ` · ${formatNumber(accounts.length)} found${accounts.length === ACCOUNTS_SHOWN ? ", the newest" : ""}`
									: ` · the newest ${formatNumber(accounts.length)} of ${formatNumber(totals.accounts)}`}
							</span>
							{search && (
								<Link href="/admin" className="ml-2 font-normal text-foreground underline decoration-foreground/30 underline-offset-4">
									Clear
								</Link>
							)}
						</h2>
						<Form action="/admin" className="relative w-full sm:w-72">
							<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
							<Input
								type="search"
								name="q"
								defaultValue={search}
								maxLength={MAX_SEARCH_LENGTH}
								placeholder="Email, newsletter or account ID"
								aria-label="Search accounts"
								className="pl-9"
							/>
						</Form>
					</div>
					{listed.length > 0 ? (
						<TableAccounts accounts={serialize(listed)} pinnedId={pinnedId} />
					) : search ? (
						<p className="rounded-xl bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-border">No account matches “{search}”</p>
					) : (
						<StateEmpty icon={Users} title="No accounts yet" />
					)}
				</section>

				<section style={{ "--stagger": 4 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Undeliverable addresses</h2>
					<CardUndeliverable bounces={undeliverable.bounces} traps={undeliverable.traps} />
				</section>

				<section style={{ "--stagger": 5 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Gmail spam rates</h2>
					<Suspense fallback={<SkeletonSesAccount />}>
						<CardPostmaster notice={typeof postmaster === "string" ? postmaster : undefined} />
					</Suspense>
				</section>
			</div>
		</>
	);
}

// A rate turns red past the level that pauses a send.
function Metric({ label, value, limit }) {
	return (
		<div className="flex flex-col gap-1 bg-card px-4 py-3">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className={cn("text-lg font-semibold tracking-tight tabular-nums", value > limit && "text-red-600 dark:text-red-400")}>
				{value === null ? <TextEmpty /> : formatPercent(value)}
			</dd>
		</div>
	);
}

// "2 past due · 1 on a free plan", with only what applies.
function describePaying({ pastDue, onFreePlan }) {
	const parts = [pastDue > 0 && `${formatNumber(pastDue)} past due`, onFreePlan > 0 && `${formatNumber(onFreePlan)} on a free plan`].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : null;
}
