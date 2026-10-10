import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, Newspaper, Settings2, TriangleAlert } from "lucide-react";
import CardConnectSparkLoop from "@/components/CardConnectSparkLoop";
import FormLinkPublication from "@/components/FormLinkPublication";
import HeaderPage from "@/components/HeaderPage";
import PitchSparkLoop from "@/components/PitchSparkLoop";
import StateEmpty from "@/components/StateEmpty";
import TabsNewsletter from "@/components/TabsNewsletter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createSparkLoop } from "@/lib/sparkloop";
import { SPARKLOOP_FEATURES, SPARKLOOP_URLS } from "@/lib/sparkloop-content";

// Every SparkLoop page: the pitch until an account is connected, then one newsletter's data. The page's
// sections only render once that newsletter is linked to a SparkLoop publication. toolbar sits on the
// newsletter tabs' row (the Free/Paid tabs), meta next to the title.
export default function ShellSparkLoop({
	feature,
	page,
	basePath,
	dashboardHref,
	dashboardLabel = "Open in SparkLoop",
	meta,
	toolbar,
	children,
}) {
	const { title } = SPARKLOOP_FEATURES[feature];
	const isConnected = page.status === "connected";
	const hasTabs = isConnected && page.newsletters?.length > 1;

	return (
		<>
			<HeaderPage title={title} meta={isConnected && page.publicationUuid ? meta : null}>
				{isConnected && dashboardHref && (
					<Button asChild variant="outline">
						<a href={dashboardHref} target="_blank" rel="noopener">
							<span className="sm:hidden">SparkLoop</span>
							<span className="hidden sm:inline">{dashboardLabel}</span>
							<ArrowUpRight data-icon="inline-end" className="opacity-60" />
						</a>
					</Button>
				)}
				{isConnected && (
					<Button asChild variant="ghost" size="icon" aria-label="SparkLoop settings" title="SparkLoop settings">
						<Link href="/sparkloop">
							<Settings2 />
						</Link>
					</Button>
				)}
			</HeaderPage>

			{page.status === "disconnected" && <PitchSparkLoop feature={feature} />}
			{page.status === "unreadable" && (
				<div className="flex flex-col gap-4">
					<NoticeReconnect hint={page.hint} />
					<CardConnectSparkLoop />
				</div>
			)}
			{isConnected && page.newsletters.length === 0 && (
				<StateEmpty icon={Newspaper} title="No newsletters yet">
					<Button asChild variant="outline" size="sm">
						<Link href="/newsletters">Go to newsletters</Link>
					</Button>
				</StateEmpty>
			)}
			{isConnected && page.selected && (
				<div className="flex flex-col gap-8">
					{(hasTabs || (toolbar && page.publicationUuid)) && (
						<div className="flex flex-wrap items-center justify-between gap-3 animate-enter">
							{hasTabs ? (
								<TabsNewsletter newsletters={page.newsletters} selectedId={page.selected._id.toString()} basePath={basePath} />
							) : (
								<span />
							)}
							{page.publicationUuid && toolbar}
						</div>
					)}
					{page.publicationUuid ? (
						children
					) : (
						<Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
							<CardLinkPublication apiKey={page.apiKey} newsletter={page.selected} />
						</Suspense>
					)}
				</div>
			)}
		</>
	);
}

async function CardLinkPublication({ apiKey, newsletter }) {
	let publications;
	try {
		({ publications = [] } = await createSparkLoop(apiKey).listPublications());
	} catch (error) {
		return <NoticeError error={error} />;
	}

	return (
		<section className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-border animate-enter sm:p-6">
			<div>
				<h2 className="font-semibold tracking-tight">Which SparkLoop publication is {newsletter.name}?</h2>
				<p className="mt-1 text-sm text-pretty text-muted-foreground">
					SparkLoop calls each newsletter a publication. Pick the one that matches, and its numbers show up here.
				</p>
			</div>
			<FormLinkPublication
				newsletterId={newsletter._id.toString()}
				publications={publications.map(({ uuid, name }) => ({ uuid, name }))}
			/>
		</section>
	);
}

export function NoticeReconnect({ hint }) {
	return (
		<p className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-pretty text-amber-950 ring-1 ring-amber-500/30 animate-enter dark:bg-amber-500/10 dark:text-amber-50">
			<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
			The saved SparkLoop key{hint ? ` (ending in ${hint})` : ""} can&apos;t be read anymore, most likely because
			SESSION_SECRET changed. Paste it again to reconnect.
		</p>
	);
}

// A section that couldn't load, and how to sort it out: a key SparkLoop stopped accepting is replaced in
// the settings; offers and paid recommendations wait for SparkLoop to approve the newsletter as a partner.
export function NoticeError({ error, href, action, isPartnerOnly = false }) {
	const status = error?.status;
	const message =
		status === 401
			? "SparkLoop didn't accept the saved API key. Disconnect, then connect again with a new key."
			: isPartnerOnly && status === 403
				? "SparkLoop hasn't approved this newsletter as a partner yet. Offers and paid recommendations open once it does."
				: (error?.message ?? String(error));
	const link =
		status === 401
			? { href: "/sparkloop", action: "SparkLoop settings", isInternal: true }
			: isPartnerOnly
				? { href: SPARKLOOP_URLS.partnerApplication, action: "Apply in SparkLoop" }
				: href && { href, action: action ?? "Open SparkLoop" };

	return (
		<div className="flex flex-col items-start gap-3 rounded-xl px-4 py-4 text-sm shadow-border animate-fade-in sm:flex-row sm:items-center">
			<span className="flex min-w-0 flex-1 items-start gap-3 text-muted-foreground">
				<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
				<span className="text-pretty">{message}</span>
			</span>
			{link && (
				<Button asChild variant="outline" size="sm" className="shrink-0">
					{link.isInternal ? (
						<Link href={link.href}>{link.action}</Link>
					) : (
						<a href={link.href} target="_blank" rel="noopener">
							{link.action}
							<ArrowUpRight data-icon="inline-end" className="opacity-60" />
						</a>
					)}
				</Button>
			)}
		</div>
	);
}
