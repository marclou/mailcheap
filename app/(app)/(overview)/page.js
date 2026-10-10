import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronRight, Newspaper, Settings2, TriangleAlert } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonNewCampaign from "@/components/ButtonNewCampaign";
import ChartSends from "@/components/ChartSends";
import ChartSubscribers from "@/components/ChartSubscribers";
import CookieTimezone from "@/components/CookieTimezone";
import ListDomainStatus from "@/components/ListDomainStatus";
import ListStats from "@/components/ListStats";
import SkeletonCampaigns from "@/components/SkeletonCampaigns";
import {
	SkeletonDomainList,
	SkeletonSends,
	SkeletonSesAccount,
	SkeletonStats,
	SkeletonSubscribers,
} from "@/components/SkeletonOverview";
import StateEmpty from "@/components/StateEmpty";
import SwatchChart from "@/components/SwatchChart";
import TableCampaigns from "@/components/TableCampaigns";
import TabsNewsletter from "@/components/TabsNewsletter";
import { Button } from "@/components/ui/button";
import { listRecentCampaigns } from "@/lib/campaign-queries";
import { listNewslettersWithActiveCounts } from "@/lib/contacts";
import { getProviderInfo, getSendingAccount, listSendingDomains } from "@/lib/email";
import { formatCompact, formatNumber, formatSigned } from "@/lib/format";
import { NEWSLETTER_SUMMARY_FIELDS, toNewsletterMap, toNewsletterOptions } from "@/lib/newsletters";
import { getEmailStats, getHourlySends, getSubscriberHistory } from "@/lib/overview-data";
import { PERIOD_DAYS } from "@/lib/overview-series";
import { TIME_ZONE_COOKIE, resolveTimeZone, timeZoneLabel } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

// Everything above Domains is about one newsletter, the largest unless ?newsletter= picks one. The page
// waits for one query (the tabs); every section then loads on its own behind a skeleton of its size.
export default async function OverviewPage({ searchParams }) {
	const [{ newsletter: newsletterParam }, cookieStore] = await Promise.all([searchParams, cookies()]);
	const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
	const newsletters = await listNewslettersWithActiveCounts(NEWSLETTER_SUMMARY_FIELDS);
	const bySize = newsletters.toSorted((a, b) => b.activeCount - a.activeCount);
	const selected = bySize.find(({ _id }) => _id.toString() === newsletterParam) ?? bySize[0];
	const selectedId = selected?._id.toString();

	return (
		<>
			<h1 className="sr-only">Overview</h1>
			<Suspense fallback={null}>
				<CookieTimezone />
			</Suspense>

			<header className="mb-6 flex items-center justify-between gap-3 animate-enter">
				{selected ? (
					<div className="flex min-w-0 items-center gap-1">
						<TabsNewsletter newsletters={bySize} selectedId={selectedId} />
						<Link
							href={`/newsletters/${selectedId}`}
							aria-label={`${selected.name} settings`}
							title="Newsletter settings"
							className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
						>
							<Settings2 className="size-4" />
						</Link>
					</div>
				) : (
					<span />
				)}
				<div className="shrink-0">
					<ButtonNewCampaign newsletters={toNewsletterOptions(newsletters)} />
				</div>
			</header>

			<div className="flex flex-col gap-8">
				{selected ? (
					<>
						<Section title={`Last ${PERIOD_DAYS} days`} stagger={1}>
							<div className="overflow-hidden rounded-2xl bg-card shadow-border">
								<Suspense key={`stats-${selectedId}`} fallback={<SkeletonStats />}>
									<StatsEmail newsletterId={selected._id} />
								</Suspense>
								<div className="border-t border-border/60">
									<Suspense key={`subscribers-${selectedId}`} fallback={<SkeletonSubscribers />}>
										<CardSubscribers newsletterId={selected._id} timeZone={timeZone} />
									</Suspense>
								</div>
							</div>
						</Section>

						<Section title="Today" stagger={2}>
							<Suspense key={`sends-${selectedId}`} fallback={<SkeletonSends />}>
								<CardSends newsletterId={selected._id} timeZone={timeZone} />
							</Suspense>
						</Section>

						<Section title="Campaigns" href="/campaigns" stagger={3}>
							<Suspense key={`campaigns-${selectedId}`} fallback={<SkeletonCampaigns rows={5} />}>
								<TableRecentCampaigns newsletterId={selected._id} newsletters={newsletters} />
							</Suspense>
						</Section>
					</>
				) : (
					<StateEmpty icon={Newspaper} title="No newsletters yet">
						<Button asChild variant="outline" size="sm">
							<Link href="/newsletters">Go to newsletters</Link>
						</Button>
					</StateEmpty>
				)}

				<Section title="Domains" href="/domains" stagger={4}>
					<Suspense fallback={<SkeletonDomainList />}>
						<SectionDomains />
					</Suspense>
				</Section>

				<Section title="System" stagger={5}>
					<Suspense fallback={<SkeletonSesAccount />}>
						<StripSendingAccount />
					</Suspense>
				</Section>
			</div>
		</>
	);
}

async function StatsEmail({ newsletterId }) {
	const stats = await getEmailStats({ newsletterId });
	return (
		<div className="animate-fade-in">
			<ListStats current={stats.current} previous={stats.previous} />
		</div>
	);
}

async function CardSubscribers({ newsletterId, timeZone }) {
	const history = await getSubscriberHistory({ newsletterId, timeZone });

	return (
		<div className="flex flex-col gap-6 p-5 animate-fade-in sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Subscribers</h2>
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-4xl font-semibold tracking-tight tabular-nums">
							{formatNumber(history.total)}
						</span>
						<span className={cn("text-sm font-medium tabular-nums", growthTone(history.growth))}>
							{formatSigned(history.growth)} in {PERIOD_DAYS} days
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "line", label: `Last ${PERIOD_DAYS} days`, value: formatSigned(history.growth) },
						{ swatch: "dashed", label: `Previous ${PERIOD_DAYS} days`, value: formatSigned(history.previousGrowth) },
					]}
				/>
			</div>
			<ChartSubscribers current={history.current} previous={history.previous} />
		</div>
	);
}

async function CardSends({ newsletterId, timeZone }) {
	const hours = await getHourlySends({ newsletterId, timeZone });
	const sentToday = hours.reduce((sum, { today }) => sum + (today ?? 0), 0);
	const sentYesterday = hours.reduce((sum, { yesterday }) => sum + yesterday, 0);

	return (
		<div className="flex flex-col gap-6 rounded-2xl bg-card p-5 shadow-border animate-fade-in sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Emails sent per hour</h2>
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(sentToday)}</span>
						<span className="text-sm text-muted-foreground tabular-nums">
							{formatNumber(sentYesterday)} yesterday
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "bar", label: "Today" },
						{ swatch: "ghost", label: "Yesterday" },
						{ label: timeZoneLabel(timeZone) },
					]}
				/>
			</div>
			<ChartSends hours={hours} />
		</div>
	);
}

async function TableRecentCampaigns({ newsletterId, newsletters }) {
	const campaigns = await listRecentCampaigns(5, newsletterId);
	if (campaigns.length === 0) {
		return (
			<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border animate-fade-in">
				No campaigns yet
			</p>
		);
	}

	return (
		<div className="animate-fade-in">
			<TableCampaigns campaigns={campaigns} newsletters={toNewsletterMap(newsletters)} />
		</div>
	);
}

async function SectionDomains() {
	const domains = await listSendingDomains();
	const { label } = getProviderInfo();

	if (domains.error || domains.length === 0) {
		return (
			<p className="flex items-center gap-3 rounded-xl px-4 py-4 text-sm text-muted-foreground shadow-border animate-fade-in">
				{domains.error && <TriangleAlert className="size-4 shrink-0 text-amber-500" />}
				<span className="truncate">{domains.error ? `${label} unreachable: ${domains.error}` : `No domains in ${label}`}</span>
			</p>
		);
	}

	return (
		<div className="animate-fade-in">
			<ListDomainStatus domains={domains} />
		</div>
	);
}

async function StripSendingAccount() {
	const account = await getSendingAccount();
	const { label } = getProviderInfo();

	if (account.error) {
		return (
			<p className="flex items-center gap-3 rounded-xl px-4 py-4 text-sm text-muted-foreground shadow-border animate-fade-in">
				<TriangleAlert className="size-4 shrink-0 text-amber-500" />
				<span className="truncate">{label} unreachable: {account.error}</span>
			</p>
		);
	}

	const items = account.provider === "resend" ? getResendItems(account) : getSesItems(account);
	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-border animate-fade-in">
			<dl className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
				{items.map(({ label: itemLabel, value }) => (
					<div key={itemLabel} className="flex min-h-[66px] flex-col items-start justify-center gap-1.5 bg-card px-4 py-3">
						<dt className="text-xs text-muted-foreground">{itemLabel}</dt>
						<dd className="w-full text-sm font-medium tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

// Resend has no account endpoint: its domains and the team's request limit stand in.
function getResendItems(account) {
	const isTracking = account.openTracking || account.clickTracking;
	return [
		{ label: "Provider", value: <BadgeStatus status="active" label="Resend" /> },
		{
			label: "Domains",
			value: (
				<BadgeStatus
					status={account.verifiedDomains > 0 ? "verified" : "pending"}
					label={`${formatNumber(account.verifiedDomains)} of ${formatNumber(account.domains)} verified`}
				/>
			),
		},
		{
			label: "Resend tracking",
			value: <BadgeStatus status={isTracking ? "pending" : "active"} label={isTracking ? "On, turn it off" : "Off"} />,
		},
		{ label: "API rate limit", value: account.maxRequestRate ? `${formatNumber(account.maxRequestRate)}/s` : "Unknown" },
	];
}

function getSesItems(account) {
	const accountLabel = account.productionAccess
		? "Production"
		: account.reviewStatus === "PENDING"
			? "Sandbox, in review"
			: "Sandbox";
	const quotaUsed = account.max24HourSend ? Math.min(account.sentLast24Hours / account.max24HourSend, 1) : 0;
	return [
		{
			label: "SES account",
			value: <BadgeStatus status={account.productionAccess ? "active" : "sandbox"} label={accountLabel} />,
		},
		{ label: "Health", value: <BadgeStatus status={account.enforcementStatus} /> },
		{
			label: "Daily quota",
			value: (
				<span className="flex w-full flex-col gap-1.5">
					{formatNumber(account.sentLast24Hours)} / {formatCompact(account.max24HourSend)}
					<span className="h-1 w-full max-w-32 overflow-hidden rounded-full bg-muted">
						<span
							className="block h-full rounded-full bg-foreground/70"
							style={{ width: `${Math.max(quotaUsed * 100, quotaUsed > 0 ? 2 : 0)}%` }}
						/>
					</span>
				</span>
			),
		},
		{ label: "Max rate", value: `${formatNumber(account.maxSendRate)}/s` },
	];
}

function Section({ title, href, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter">
			<SectionTitle href={href}>{title}</SectionTitle>
			{children}
		</section>
	);
}

function SectionTitle({ href, children }) {
	if (!href) return <h2 className="text-sm font-medium text-muted-foreground">{children}</h2>;
	return (
		<h2 className="text-sm font-medium text-muted-foreground">
			<Link href={href} className="group inline-flex items-center gap-1 transition-colors hover:text-foreground">
				{children}
				<ChevronRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
			</Link>
		</h2>
	);
}

function ListLegend({ items }) {
	return (
		<ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
			{items.map(({ swatch, label, value }) => (
				<li key={label} className="flex items-center gap-2">
					{swatch && <SwatchChart kind={swatch} />}
					{label}
					{value && <span className="font-medium text-foreground tabular-nums">{value}</span>}
				</li>
			))}
		</ul>
	);
}

function growthTone(value) {
	if (value > 0) return "text-emerald-600 dark:text-emerald-400";
	if (value < 0) return "text-red-600 dark:text-red-400";
	return "text-muted-foreground";
}
