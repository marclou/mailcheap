import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronRight, Newspaper, Plus } from "lucide-react";
import BannerUsage from "@/components/BannerUsage";
import ButtonPeriod from "@/components/ButtonPeriod";
import CardUsage from "@/components/CardUsage";
import ChartSends from "@/components/ChartSends";
import ChartSubscribers from "@/components/ChartSubscribers";
import CookieTimezone from "@/components/CookieTimezone";
import HeaderPage from "@/components/HeaderPage";
import ListLegend from "@/components/ListLegend";
import ListStats from "@/components/ListStats";
import NoticeOwnDomain from "@/components/NoticeOwnDomain";
import SkeletonCampaigns from "@/components/SkeletonCampaigns";
import { SkeletonSends, SkeletonStats, SkeletonSubscribers } from "@/components/SkeletonOverview";
import StateEmpty from "@/components/StateEmpty";
import TableCampaigns from "@/components/TableCampaigns";
import { Button } from "@/components/ui/button";
import { hasActiveSubscription } from "@/lib/account-state";
import { listNewsletterCampaigns } from "@/lib/campaign-queries";
import { getSharedDomain } from "@/lib/config";
import { formatNumber, formatSigned } from "@/lib/format";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { getEmailStats, getSends, getSubscriberHistory } from "@/lib/overview-data";
import { buildSendBars, getBarUnit, getPeriodPoints, readPeriod } from "@/lib/overview-series";
import { getAccountPlan } from "@/lib/plans";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { findAccountDomains } from "@/lib/sender";
import { getOwnDomainNudge, isOwnDomainNudgeShown } from "@/lib/sender-rules";
import { OWNER_ROLE } from "@/lib/team-rules";
import { TIME_ZONE_COOKIE, resolveTimeZone, timeZoneLabel, toDateKey } from "@/lib/time-zone";
import { getUsage, hasWelcomeEmailsOn } from "@/lib/usage";
import { cn } from "@/lib/utils";

// The open newsletter's numbers, then the plan its account's newsletters share. The page waits for the
// newsletter; every section then loads on its own behind a skeleton of its size. The header's button picks the
// period of the numbers and both charts (?days=, or ?from= and ?to=), which their Suspense keys leave out: another
// period replaces them in place, without skeletons.
export default async function OverviewPage({ searchParams }) {
	const [view, params, cookieStore] = await Promise.all([getSelectedNewsletter(), searchParams, cookies()]);
	openNewsletter(view, params.newsletter, "/");
	const { account, selected } = view;
	// The plan and the sender's domain are the owner's: a team member sees the newsletter's numbers.
	const isOwner = view.role === OWNER_ROLE;
	const usage = await getUsage(account);
	const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
	const now = new Date();
	const todayKey = toDateKey(now, timeZone);
	const period = readPeriod(params, todayKey);
	const points = getPeriodPoints(period, { timeZone, now });
	const fades = "transition-opacity duration-200 group-has-[[data-pending]]/overview:opacity-60";
	const selectedId = selected?._id.toString();
	const accountId = account._id;
	const hasPlan = isOwner && hasActiveSubscription(account);
	const isWelcomePaused = usage.welcomeEmailsPaused && (await hasWelcomeEmailsOn(accountId));
	// With a plan only: until then there's no shared address, and adding a domain waits for one.
	const domainNudge =
		selected && hasPlan
			? getOwnDomainNudge({ fromEmail: selected.fromEmail, domains: await findAccountDomains(accountId), sharedDomain: getSharedDomain() })
			: null;

	return (
		<div className="group/overview">
			<Suspense fallback={null}>
				<CookieTimezone />
			</Suspense>
			{hasPlan && <BannerUsage usage={usage} isWelcomePaused={isWelcomePaused} />}
			<HeaderPage title="Overview">{selected && <ButtonPeriod period={period} todayKey={todayKey} />}</HeaderPage>

			<div className="flex flex-col gap-8">
				{isOwnDomainNudgeShown(domainNudge, selected) && (
					<NoticeOwnDomain
						variant="card"
						nudge={domainNudge}
						newsletter={{ _id: selectedId, name: selected.name }}
						stagger={1}
					/>
				)}
				{selected ? (
					<>
						<Section aria-label={period.label} stagger={1}>
							<div className={cn("overflow-hidden rounded-2xl bg-card shadow-border", fades)}>
								<Suspense key={`stats-${selectedId}`} fallback={<SkeletonStats />}>
									<StatsEmail accountId={accountId} newsletterId={selected._id} timeZone={timeZone} period={period} />
								</Suspense>
								<div className="border-t border-border/60">
									<Suspense key={`subscribers-${selectedId}`} fallback={<SkeletonSubscribers />}>
										<CardSubscribers accountId={accountId} newsletterId={selected._id} timeZone={timeZone} period={period} points={points} />
									</Suspense>
								</div>
							</div>
						</Section>

						<Section aria-label="Emails sent" stagger={2}>
							<div className={fades}>
								<Suspense key={`sends-${selectedId}`} fallback={<SkeletonSends />}>
									<CardSends accountId={accountId} newsletterId={selected._id} timeZone={timeZone} period={period} points={points} />
								</Suspense>
							</div>
						</Section>

						<Section title="Campaigns" href="/campaigns" stagger={3}>
							<Suspense key={`campaigns-${selectedId}`} fallback={<SkeletonCampaigns rows={5} />}>
								<TableRecentCampaigns account={account} newsletter={selected} />
							</Suspense>
						</Section>
					</>
				) : (
					<StateEmpty icon={Newspaper} title="No newsletters yet">
						<Button asChild variant="outline" size="sm">
							<Link href={ADD_NEWSLETTER_PATH}>
								<Plus data-icon="inline-start" />
								Add a newsletter
							</Link>
						</Button>
					</StateEmpty>
				)}

				{hasPlan && usage.emailsLimit !== null && (
					<Section title={`${getAccountPlan(account)?.name ?? "Your"} plan`} href="/billing" stagger={4}>
						<CardUsage usage={usage} isShared={view.ownCount > 1} />
					</Section>
				)}
			</div>
		</div>
	);
}

async function StatsEmail({ accountId, newsletterId, timeZone, period }) {
	const stats = await getEmailStats({ accountId, newsletterId, timeZone, days: period.days, from: period.from, to: period.to });
	return (
		<div className="animate-fade-in">
			<ListStats current={stats.current} previous={stats.previous} span={period.span} />
		</div>
	);
}

async function CardSubscribers({ accountId, newsletterId, timeZone, period, points }) {
	const history = await getSubscriberHistory({ accountId, newsletterId, timeZone, points });

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
							{formatSigned(history.growth)} in {period.span}
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "line", label: period.label, value: formatSigned(history.growth) },
						{ swatch: "dashed", label: `Previous ${period.span}`, value: formatSigned(history.previousGrowth) },
					]}
				/>
			</div>
			<ChartSubscribers current={history.current} previous={history.previous} />
		</div>
	);
}

async function CardSends({ accountId, newsletterId, timeZone, period, points }) {
	const counts = await getSends({ accountId, newsletterId, timeZone, points });
	const unit = getBarUnit(points);
	const sent = counts.current.reduce((total, count) => total + count, 0);
	const previousSent = counts.previous.reduce((total, count) => total + count, 0);

	return (
		<div className="flex flex-col gap-6 rounded-2xl bg-card p-5 shadow-border animate-fade-in sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Emails sent per {unit}</h2>
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(sent)}</span>
						<span className="text-sm text-muted-foreground tabular-nums">
							{formatNumber(previousSent)} in the previous {period.span}
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "bar", label: period.label },
						{ swatch: "ghost", label: `Previous ${period.span}` },
						{ label: timeZoneLabel(timeZone) },
					]}
				/>
			</div>
			<ChartSends bars={buildSendBars(points, counts)} unit={unit} isLive={!period.from} />
		</div>
	);
}

async function TableRecentCampaigns({ account, newsletter }) {
	const campaigns = await listNewsletterCampaigns(account, newsletter._id, 5);
	if (campaigns.length === 0) {
		return (
			<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border animate-fade-in">
				No campaigns yet
			</p>
		);
	}

	return (
		<div className="animate-fade-in">
			<TableCampaigns campaigns={campaigns} newsletter={newsletter} />
		</div>
	);
}

function Section({ title, href, stagger, children, ...props }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter" {...props}>
			{title && <SectionTitle href={href}>{title}</SectionTitle>}
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

function growthTone(value) {
	if (value > 0) return "text-emerald-600 dark:text-emerald-400";
	if (value < 0) return "text-red-600 dark:text-red-400";
	return "text-muted-foreground";
}
