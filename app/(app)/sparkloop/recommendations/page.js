import { Suspense } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonSparkLoop from "@/components/ButtonSparkLoop";
import CardDirectory from "@/components/CardDirectory";
import DialogRecommendPaid from "@/components/DialogRecommendPaid";
import FormSearchDirectory from "@/components/FormSearchDirectory";
import GridStats from "@/components/GridStats";
import NavPages from "@/components/NavPages";
import StatInline from "@/components/StatInline";
import SectionPage, { SectionCount } from "@/components/SectionPage";
import ShellSparkLoop, { NoticeError } from "@/components/ShellSparkLoop";
import TabsLinks from "@/components/TabsLinks";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/format";
import { createSparkLoop } from "@/lib/sparkloop";
import { loadSparkLoopPage } from "@/lib/sparkloop-account";
import { describeGeo } from "@/lib/sparkloop-format";
import { SPARKLOOP_URLS } from "@/lib/sparkloop-content";
import { cn } from "@/lib/utils";

export const metadata = { title: "Recommendations" };

const BASE_PATH = "/sparkloop/recommendations";
const STATUS_LABELS = { awaiting_approval: "Waiting for approval", budget_used_up: "Budget used up" };

export default async function RecommendationsPage({ searchParams }) {
	const params = await searchParams;
	const page = await loadSparkLoopPage(params.newsletter);
	const tab = params.tab === "paid" ? "paid" : "free";
	const view = {
		tab,
		query: String(params.q ?? "").slice(0, 100),
		pageNumber: Math.max(1, Number.parseInt(params.page, 10) || 1),
		isArchived: params.status === "archived",
		orderBy: params.order === "newest" ? undefined : "commission",
	};
	const newsletterId = page.selected?._id.toString();
	const tabHref = (name) => `${BASE_PATH}?newsletter=${newsletterId}${name === "paid" ? "&tab=paid" : ""}`;
	const key = `${page.publicationUuid}-${JSON.stringify(view)}`;

	return (
		<ShellSparkLoop
			feature="recommendations"
			page={page}
			basePath={BASE_PATH}
			dashboardHref={tab === "paid" ? SPARKLOOP_URLS.paidRecommendations : SPARKLOOP_URLS.freeRecommendations}
			toolbar={
				<TabsLinks
					label="Kind of recommendation"
					tabs={[
						{ href: tabHref("free"), label: "Free", isActive: tab === "free" },
						{ href: tabHref("paid"), label: "Paid", isActive: tab === "paid" },
					]}
				/>
			}
		>
			<div className="flex flex-col gap-8">
				{tab === "free" ? (
					<>
						{!page.webhookUuid && <NoticeReferrals />}
						<Suspense key={`free-${key}`} fallback={<SkeletonMine />}>
							<SectionsFree apiKey={page.apiKey} newsletter={page.selected} view={view} />
						</Suspense>
						<Suspense key={`free-browse-${key}`} fallback={<SkeletonDirectory />}>
							<SectionFreeDirectory apiKey={page.apiKey} newsletter={page.selected} view={view} />
						</Suspense>
					</>
				) : (
					<>
						<Suspense key={`paid-${key}`} fallback={<SkeletonMine />}>
							<SectionsPaid apiKey={page.apiKey} newsletter={page.selected} view={view} />
						</Suspense>
						<Suspense key={`paid-browse-${key}`} fallback={<SkeletonDirectory />}>
							<SectionPaidDirectory apiKey={page.apiKey} newsletter={page.selected} view={view} />
						</Suspense>
					</>
				)}
			</div>
		</ShellSparkLoop>
	);
}

function clientFor(apiKey, newsletter) {
	return createSparkLoop(apiKey).publication(newsletter.sparkloop.publicationUuid);
}

function viewHref(newsletter, view, changes) {
	const next = { ...view, ...changes };
	const params = new URLSearchParams({ newsletter: newsletter._id.toString() });
	if (next.tab === "paid") params.set("tab", "paid");
	if (next.isArchived) params.set("status", "archived");
	if (next.query) params.set("q", next.query);
	if (next.tab === "paid" && !next.orderBy) params.set("order", "newest");
	if (next.pageNumber > 1) params.set("page", String(next.pageNumber));
	return `${BASE_PATH}?${params}`;
}

async function SectionsFree({ apiKey, newsletter, view }) {
	const client = clientFor(apiKey, newsletter);
	const id = newsletter._id.toString();
	let stats;
	let sending;
	let receiving;
	try {
		[{ stats }, { recommendations: sending }, { recommendations: receiving }] = await Promise.all([
			client.getFreeStats(),
			client.listFree({ role: "sending", status: view.isArchived ? "archived" : undefined }),
			client.listFree({ role: "receiving" }),
		]);
	} catch (error) {
		return <NoticeError error={error} href={SPARKLOOP_URLS.freeRecommendations} />;
	}

	return (
		<>
			<SectionPage title="Last 30 days">
				<GridStats
					items={[
						{ label: "Readers you sent", value: formatNumber(stats?.referrals_sent) },
						{
							label: "Readers you got",
							value: formatNumber(stats?.referrals_received),
							tone: stats?.referrals_received > 0 ? "good" : undefined,
						},
						{ label: "You recommend", value: formatNumber(stats?.sending_count), detail: "newsletters" },
						{ label: "Recommending you", value: formatNumber(stats?.receiving_count), detail: "newsletters" },
					]}
				/>
			</SectionPage>

			<SectionPage
				title={view.isArchived ? "Archived" : "You recommend"}
				stagger={1}
				action={
					<Link
						href={viewHref(newsletter, view, { isArchived: !view.isArchived, pageNumber: 1 })}
						scroll={false}
						className="text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{view.isArchived ? "Show active" : "Show archived"}
					</Link>
				}
			>
				<ListRecommendations
					recommendations={sending ?? []}
					empty={view.isArchived ? "Nothing archived" : "You don't recommend anyone yet. Pick newsletters below."}
					publicationKey="recommended_publication"
					renderAction={({ uuid, status, recommended_publication: publication }) => (
						<ButtonArchive
							newsletterId={id}
							uuid={uuid}
							name={publication?.name}
							isArchived={status === "archived"}
							actions={{ archive: "archiveFree", reactivate: "reactivateFree" }}
						/>
					)}
				/>
			</SectionPage>

			{!view.isArchived && (
				<SectionPage title="Recommending you" stagger={2}>
					<ListRecommendations
						recommendations={receiving ?? []}
						empty="No one yet. Ask newsletters below to swap recommendations with you."
						publicationKey="recommending_publication"
					/>
				</SectionPage>
			)}
		</>
	);
}

async function SectionFreeDirectory({ apiKey, newsletter, view }) {
	const id = newsletter._id.toString();
	let directory;
	try {
		directory = await clientFor(apiKey, newsletter).browseFree({ q: view.query || undefined, page: view.pageNumber });
	} catch (error) {
		return (
			<SectionPage title="Find newsletters" stagger={3}>
				<NoticeError error={error} href={SPARKLOOP_URLS.freeRecommendations} />
			</SectionPage>
		);
	}
	const publications = directory.recommendations ?? [];

	return (
		<SectionPage
			title="Find newsletters"
			meta={<SectionCount label="in the network" value={directory.meta?.total_recommendations} />}
			stagger={3}
			action={
				<FormSearchDirectory action={BASE_PATH} query={view.query} hidden={{ newsletter: id }} placeholder="Search newsletters" />
			}
		>
			{publications.length === 0 ? (
				<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">
					{view.query ? `No newsletters match “${view.query}”` : "No newsletters to show"}
				</p>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{publications.map((publication) => (
						<CardDirectory
							key={publication.uuid}
							logo={publication.logo_url}
							name={publication.name}
							url={publication.url}
							description={publication.description}
						>
							<ButtonSparkLoop
								newsletterId={id}
								action="requestFreePartnership"
								uuid={publication.uuid}
								icon="swap"
								variant="ghost"
								confirm={`Ask ${publication.name} to recommend ${newsletter.name}? They get a request and can accept it.`}
								success={`Asked ${publication.name} to recommend you`}
								doneLabel="Asked"
							>
								Ask to swap
							</ButtonSparkLoop>
							<ButtonSparkLoop
								newsletterId={id}
								action="recommendFree"
								uuid={publication.uuid}
								icon="add"
								success={`Recommending ${publication.name}`}
							>
								Recommend them
							</ButtonSparkLoop>
						</CardDirectory>
					))}
				</ul>
			)}
			<NavPages
				page={directory.meta?.page ?? view.pageNumber}
				totalPages={directory.meta?.total_pages}
				href={(number) => viewHref(newsletter, view, { pageNumber: number })}
			/>
		</SectionPage>
	);
}

async function SectionsPaid({ apiKey, newsletter, view }) {
	const client = clientFor(apiKey, newsletter);
	const id = newsletter._id.toString();
	let stats;
	let recommendations;
	try {
		[{ stats }, { recommendations }] = await Promise.all([
			client.getPaidStats(),
			client.listPaid({ status: view.isArchived ? "archived" : undefined }),
		]);
	} catch (error) {
		return <NoticeError error={error} isPartnerOnly />;
	}
	const channels = stats?.channels ?? {};

	return (
		<>
			<SectionPage title="Last 30 days">
				<GridStats
					items={[
						{
							label: "Earnings",
							value: formatMoney(stats?.earnings?.total),
							detail: `${formatMoney(stats?.earnings?.confirmed)} confirmed`,
							tone: stats?.earnings?.total > 0 ? "good" : undefined,
						},
						{
							label: "Referrals",
							value: formatNumber(stats?.referrals?.total),
							detail: `${formatNumber(stats?.referrals?.confirmed)} confirmed · ${formatNumber(stats?.referrals?.pending)} pending`,
						},
						{
							label: "Signup flow",
							value: formatNumber(channels.signup_flow?.impressions),
							detail: `views · ${formatMoney(channels.signup_flow?.earnings?.total)}`,
						},
						{
							label: "In emails",
							value: formatNumber(channels.campaigns?.clicks),
							detail: `clicks · ${formatMoney(channels.campaigns?.earnings?.total)}`,
						},
					]}
				/>
			</SectionPage>

			<SectionPage
				title={view.isArchived ? "Archived" : "You recommend"}
				stagger={1}
				action={
					<Link
						href={viewHref(newsletter, view, { isArchived: !view.isArchived, pageNumber: 1 })}
						scroll={false}
						className="text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{view.isArchived ? "Show active" : "Show archived"}
					</Link>
				}
			>
				<ListRecommendations
					recommendations={recommendations ?? []}
					empty={view.isArchived ? "Nothing archived" : "No paid recommendations yet. Pick partner programs below."}
					publicationKey="recommended_publication"
					isPaid
					renderAction={({ uuid, status, recommended_publication: publication }) => (
						<ButtonArchive
							newsletterId={id}
							uuid={uuid}
							name={publication?.name}
							isArchived={status === "archived"}
							actions={{ archive: "archivePaid", reactivate: "reactivatePaid" }}
						/>
					)}
				/>
				{!view.isArchived && (recommendations ?? []).length > 0 && (
					<p className="text-xs text-muted-foreground">
						Active ones show in the signup flow. To put one in an issue, type / in the editor and pick Recommendation.
					</p>
				)}
			</SectionPage>
		</>
	);
}

async function SectionPaidDirectory({ apiKey, newsletter, view }) {
	const id = newsletter._id.toString();
	let directory;
	try {
		directory = await clientFor(apiKey, newsletter).browsePaid({ page: view.pageNumber, orderBy: view.orderBy });
	} catch (error) {
		return (
			<SectionPage title="Find partner programs" stagger={2}>
				<NoticeError error={error} isPartnerOnly />
			</SectionPage>
		);
	}
	const programs = directory.recommendations ?? [];

	return (
		<SectionPage
			title="Find partner programs"
			meta={<SectionCount label="to join" value={directory.meta?.total_recommendations} />}
			stagger={2}
			action={
				<TabsLinks
					label="Sort"
					tabs={[
						{ href: viewHref(newsletter, view, { orderBy: "commission", pageNumber: 1 }), label: "Best paying", isActive: Boolean(view.orderBy) },
						{ href: viewHref(newsletter, view, { orderBy: undefined, pageNumber: 1 }), label: "Newest", isActive: !view.orderBy },
					]}
				/>
			}
		>
			{programs.length === 0 ? (
				<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">
					You&apos;ve joined every program you can for now
				</p>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{programs.map((program) => (
						<CardDirectory
							key={program.uuid}
							logo={program.publication?.logo_url}
							name={program.publication?.name}
							url={program.publication?.url}
							payout={`${formatMoney(program.commission)} per subscriber`}
							description={program.publication?.description}
							details={[
								program.expected_earning_per_referral
									? `~${formatMoney(program.expected_earning_per_referral)} per subscriber after screening`
									: null,
								describeGeo(program.geo_restrictions),
								program.engagement_screening?.days ? `${program.engagement_screening.days}-day screening` : null,
							]}
						>
							<DialogRecommendPaid newsletterId={id} uuid={program.uuid} name={program.publication?.name} />
						</CardDirectory>
					))}
				</ul>
			)}
			<NavPages
				page={directory.meta?.page ?? view.pageNumber}
				totalPages={directory.meta?.total_pages}
				href={(number) => viewHref(newsletter, view, { pageNumber: number })}
			/>
		</SectionPage>
	);
}

function ButtonArchive({ newsletterId, uuid, name, isArchived, actions }) {
	return isArchived ? (
		<ButtonSparkLoop
			newsletterId={newsletterId}
			action={actions.reactivate}
			uuid={uuid}
			icon="restore"
			variant="ghost"
			aria-label={`Recommend ${name} again`}
			success="Recommending again"
		>
			Bring back
		</ButtonSparkLoop>
	) : (
		<ButtonSparkLoop
			newsletterId={newsletterId}
			action={actions.archive}
			uuid={uuid}
			icon="archive"
			variant="ghost"
			aria-label={`Archive ${name}`}
			success="Archived"
			undo={actions.reactivate}
		>
			Archive
		</ButtonSparkLoop>
	);
}

// Swaps only grow the list when SparkLoop can send their readers here.
function NoticeReferrals() {
	return (
		<p className="flex flex-wrap items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-pretty text-amber-950 ring-1 ring-amber-500/30 animate-enter dark:bg-amber-500/10 dark:text-amber-50">
			<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
			<span className="min-w-0 flex-1">Readers other newsletters send you aren&apos;t reaching your list yet.</span>
			<Link href="/sparkloop" className="font-medium underline underline-offset-2">
				Set it up
			</Link>
		</p>
	);
}

function ListRecommendations({ recommendations, empty, publicationKey, isPaid = false, renderAction }) {
	if (recommendations.length === 0) {
		return <p className="rounded-xl px-4 py-6 text-center text-sm text-pretty text-muted-foreground shadow-border">{empty}</p>;
	}

	return (
		<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
			{recommendations.map((recommendation) => {
				const publication = recommendation[publicationKey] ?? {};
				const referrals = recommendation.stats?.referrals ?? {};
				return (
					<li key={recommendation.uuid} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
						<div className="flex min-w-0 flex-1 items-center gap-3">
							<AvatarNewsletter newsletter={{ name: publication.name, imageUrl: publication.logo_url }} size={36} />
							<div className="min-w-0">
								<p className="flex items-center gap-2 text-sm font-medium">
									<span className="truncate">{publication.name}</span>
									{recommendation.status !== "active" && (
										<BadgeStatus
											status={recommendation.status === "awaiting_approval" ? "pending" : recommendation.status}
											label={STATUS_LABELS[recommendation.status]}
										/>
									)}
								</p>
								<p className="truncate text-xs text-muted-foreground">
									{isPaid
										? `${formatMoney(recommendation.commission)} per subscriber · up to ${formatMoney(recommendation.max_payout)}`
										: publication.description}
								</p>
							</div>
						</div>
						<dl className={cn("grid shrink-0 gap-4 text-right text-xs", isPaid ? "grid-cols-3 sm:w-56" : "grid-cols-2 sm:w-36")}>
							<StatInline label="Confirmed" value={formatNumber(referrals.confirmed)} />
							<StatInline label="Pending" value={formatNumber(referrals.pending)} />
							{isPaid && <StatInline label="Earned" value={formatMoney(recommendation.stats?.earnings?.total)} />}
						</dl>
						{renderAction && <div className="flex shrink-0 justify-end sm:w-32">{renderAction(recommendation)}</div>}
					</li>
				);
			})}
		</ul>
	);
}

function SkeletonMine() {
	return (
		<div className="flex flex-col gap-8">
			<Skeleton className="h-[89px] rounded-xl" />
			<Skeleton className="h-40 rounded-xl" />
		</div>
	);
}

function SkeletonDirectory() {
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{[0, 1, 2].map((index) => (
				<Skeleton key={index} className="h-48 rounded-xl" />
			))}
		</div>
	);
}
