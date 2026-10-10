import { Suspense } from "react";
import Link from "next/link";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import ButtonSparkLoop from "@/components/ButtonSparkLoop";
import CardDirectory from "@/components/CardDirectory";
import FormSearchDirectory from "@/components/FormSearchDirectory";
import GridStats from "@/components/GridStats";
import NavPages from "@/components/NavPages";
import SectionPage, { SectionCount } from "@/components/SectionPage";
import ShellSparkLoop, { NoticeError } from "@/components/ShellSparkLoop";
import StatInline from "@/components/StatInline";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/format";
import { createSparkLoop } from "@/lib/sparkloop";
import { loadSparkLoopPage } from "@/lib/sparkloop-account";
import { SPARKLOOP_URLS } from "@/lib/sparkloop-content";
import { describeGeo, describeOfferPayout } from "@/lib/sparkloop-format";

export const metadata = { title: "Offers" };

export default async function OffersPage({ searchParams }) {
	const params = await searchParams;
	const page = await loadSparkLoopPage(params.newsletter);
	const query = String(params.q ?? "").slice(0, 100);
	const pageNumber = Math.max(1, Number.parseInt(params.page, 10) || 1);
	const isArchived = params.status === "archived";

	return (
		<ShellSparkLoop feature="offers" page={page} basePath="/sparkloop/offers" dashboardHref={SPARKLOOP_URLS.offers}>
			<div className="flex flex-col gap-8">
				<Suspense key={`mine-${page.publicationUuid}-${isArchived}`} fallback={<SkeletonOffers />}>
					<SectionsMine apiKey={page.apiKey} newsletter={page.selected} isArchived={isArchived} />
				</Suspense>
				<Suspense key={`browse-${page.publicationUuid}-${query}-${pageNumber}`} fallback={<SkeletonDirectory />}>
					<SectionDirectory apiKey={page.apiKey} newsletter={page.selected} query={query} pageNumber={pageNumber} />
				</Suspense>
			</div>
		</ShellSparkLoop>
	);
}

async function SectionsMine({ apiKey, newsletter, isArchived }) {
	const client = createSparkLoop(apiKey).publication(newsletter.sparkloop.publicationUuid);
	const id = newsletter._id.toString();
	let stats;
	let offers;
	try {
		[{ stats }, { offers }] = await Promise.all([
			client.getOfferStats(),
			client.listOffers({ status: isArchived ? "archived" : undefined }),
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
							value: formatMoney(stats?.earnings?.confirmed),
							detail: "confirmed",
							tone: stats?.earnings?.confirmed > 0 ? "good" : undefined,
						},
						{
							label: "Conversions",
							value: formatNumber(stats?.conversions?.total),
							detail: `${formatNumber(stats?.conversions?.confirmed)} confirmed · ${formatNumber(stats?.conversions?.pending)} pending`,
						},
						{
							label: "Signup flow",
							value: formatNumber(channels.signup_flow?.impressions),
							detail: `views · ${formatMoney(channels.signup_flow?.earnings?.confirmed)}`,
						},
						{
							label: "In emails",
							value: formatNumber(channels.campaigns?.clicks),
							detail: `clicks · ${formatMoney(channels.campaigns?.earnings?.confirmed)}`,
						},
					]}
				/>
			</SectionPage>

			<SectionPage
				title={isArchived ? "Archived offers" : "Your offers"}
				stagger={1}
				action={
					<Link
						href={`/sparkloop/offers?newsletter=${id}${isArchived ? "" : "&status=archived"}`}
						scroll={false}
						className="text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{isArchived ? "Show active" : "Show archived"}
					</Link>
				}
			>
				{offers.length === 0 ? (
					<p className="rounded-xl px-4 py-6 text-center text-sm text-pretty text-muted-foreground shadow-border">
						{isArchived ? "No archived offers" : "No offers yet. Add one from the list below to start earning."}
					</p>
				) : (
					<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
						{offers.map(({ uuid, status, offer, stats: offerStats }) => (
							<li key={uuid} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<AvatarNewsletter newsletter={{ name: offer.brand?.name, imageUrl: offer.brand?.logo_url }} size={36} />
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">{offer.headline}</p>
										<p className="truncate text-xs text-muted-foreground">
											{offer.brand?.name} · {describeOfferPayout(offer) ?? "Commission"}
										</p>
									</div>
								</div>
								<dl className="grid shrink-0 grid-cols-4 gap-4 text-right text-xs sm:w-80">
									<StatInline label="Views" value={formatNumber(offerStats?.impressions)} />
									<StatInline label="Claims" value={formatNumber(offerStats?.claims)} />
									<StatInline label="Sales" value={formatNumber(offerStats?.conversions)} />
									<StatInline label="Earned" value={formatMoney(offerStats?.earnings)} />
								</dl>
								<div className="flex shrink-0 justify-end sm:w-28">
									{status === "archived" ? (
										<ButtonSparkLoop
											newsletterId={id}
											action="reactivateOffer"
											uuid={uuid}
											icon="restore"
											variant="ghost"
											aria-label={`Bring back ${offer.headline}`}
											success="Offer is back"
										>
											Bring back
										</ButtonSparkLoop>
									) : (
										<ButtonSparkLoop
											newsletterId={id}
											action="archiveOffer"
											uuid={uuid}
											icon="archive"
											variant="ghost"
											aria-label={`Archive ${offer.headline}`}
											success="Offer archived"
											undo="reactivateOffer"
										>
											Archive
										</ButtonSparkLoop>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
				{!isArchived && offers.length > 0 && (
					<p className="text-xs text-muted-foreground">
						Active offers show in the signup flow. To put one in an issue, type / in the editor and pick Offer.
					</p>
				)}
			</SectionPage>
		</>
	);
}

async function SectionDirectory({ apiKey, newsletter, query, pageNumber }) {
	const id = newsletter._id.toString();
	const client = createSparkLoop(apiKey).publication(newsletter.sparkloop.publicationUuid);
	let directory;
	try {
		directory = await client.browseOffers({ q: query || undefined, page: pageNumber });
	} catch (error) {
		return (
			<SectionPage title="Find offers" stagger={2}>
				<NoticeError error={error} isPartnerOnly />
			</SectionPage>
		);
	}
	const offers = directory.offers ?? [];
	const href = (number) =>
		`/sparkloop/offers?newsletter=${id}${query ? `&q=${encodeURIComponent(query)}` : ""}&page=${number}`;

	return (
		<SectionPage
			title="Find offers"
			meta={<SectionCount label="available" value={directory.meta?.total_offers} />}
			stagger={2}
			action={<FormSearchDirectory action="/sparkloop/offers" query={query} hidden={{ newsletter: id }} placeholder="Search offers" />}
		>
			{offers.length === 0 ? (
				<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">
					{query ? `No offers match “${query}”` : "No offers available right now"}
				</p>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{offers.map((offer) => (
						<CardDirectory
							key={offer.uuid}
							logo={offer.brand?.logo_url}
							name={offer.brand?.name}
							payout={describeOfferPayout(offer)}
							title={offer.headline}
							description={offer.description}
							details={[describeGeo(offer.geo_restrictions)]}
						>
							<ButtonSparkLoop newsletterId={id} action="recommendOffer" uuid={offer.uuid} icon="add" success="Offer added">
								Add
							</ButtonSparkLoop>
						</CardDirectory>
					))}
				</ul>
			)}
			<NavPages page={directory.meta?.page ?? pageNumber} totalPages={directory.meta?.total_pages} href={href} />
		</SectionPage>
	);
}

function SkeletonOffers() {
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
				<Skeleton key={index} className="h-56 rounded-xl" />
			))}
		</div>
	);
}
