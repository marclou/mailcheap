import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import CardIssue from "@/components/CardIssue";
import FormSubscribe from "@/components/FormSubscribe";
import LinksSocial from "@/components/LinksSocial";
import ScriptJsonLd from "@/components/ScriptJsonLd";
import { countReaders, getArchiveNewsletter, listArchiveIssues } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getHomeSeo } from "@/lib/archive-seo";
import { formatNumber } from "@/lib/format";

export const revalidate = 3600;

export function generateStaticParams() {
	return [];
}

export async function generateMetadata({ params }) {
	const newsletter = await getArchiveNewsletter((await params).slug);
	return newsletter ? getHomeSeo(newsletter).metadata : {};
}

export default async function ArchivePage({ params }) {
	const newsletter = await getArchiveNewsletter((await params).slug);
	if (!newsletter) notFound();

	const [issues, readers] = await Promise.all([
		listArchiveIssues(newsletter),
		countReaders(newsletter),
	]);
	const urls = getArchiveUrls(newsletter);
	const pinned = issues.filter((issue) => issue.archivePinned);
	const latest = pinned.length > 0 ? null : issues[0];
	const rest = pinned.length > 0 ? issues.filter((issue) => !issue.archivePinned) : issues.slice(1);

	return (
		<>
			<ScriptJsonLd data={getHomeSeo(newsletter).jsonLd} />
			<section className="relative isolate overflow-hidden">
				<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-dots" />
				<div className="mx-auto flex max-w-2xl flex-col items-center px-5 pt-16 pb-14 text-center sm:pt-24 sm:pb-20">
					<AvatarNewsletter
						newsletter={newsletter}
						size={72}
						className="rounded-2xl shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)] animate-enter"
					/>
					<h1 style={{ "--stagger": 1 }} className="mt-6 text-4xl font-theme-heading animate-enter sm:text-5xl">
						{newsletter.name}
					</h1>
					{newsletter.description && (
						<p
							style={{ "--stagger": 2 }}
							className="mt-4 max-w-xl text-lg text-muted-foreground text-balance animate-enter"
						>
							{newsletter.description}
						</p>
					)}
					<div
						id="subscribe"
						style={{ "--stagger": 3 }}
						className="mt-8 w-full max-w-md scroll-mt-24 animate-enter"
					>
						<FormSubscribe newsletterSlug={newsletter.slug} />
					</div>
					<div style={{ "--stagger": 4 }} className="mt-4 flex flex-col items-center gap-4 animate-enter">
						{readers >= 100 && (
							<p className="text-sm text-muted-foreground tabular-nums">
								Join {formatNumber(readers)} readers. Free, unsubscribe anytime.
							</p>
						)}
						<LinksSocial links={newsletter.socialLinks} />
					</div>
				</div>
			</section>

			{pinned.length > 0 && (
				<section style={{ "--stagger": 5 }} className="mx-auto max-w-5xl px-5 animate-enter">
					<h2 className="mb-6 text-sm font-medium text-muted-foreground">Featured</h2>
					<ol className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
						{pinned.map((issue, index) => (
							<li key={issue._id.toString()}>
								<CardIssue
									issue={issue}
									newsletter={newsletter}
									href={urls.post(issue.archiveSlug)}
									isEager={index === 0}
								/>
							</li>
						))}
					</ol>
				</section>
			)}

			{latest && (
				<section style={{ "--stagger": 5 }} className="mx-auto max-w-5xl px-5 animate-enter">
					<h2 className="mb-4 text-sm font-medium text-muted-foreground">Latest issue</h2>
					<CardIssue
						issue={latest}
						newsletter={newsletter}
						href={urls.post(latest.archiveSlug)}
						isFeatured
						isEager
					/>
				</section>
			)}

			{rest.length > 0 && (
				<section className="mx-auto max-w-5xl px-5 pt-20 pb-24">
					<h2 className="mb-6 border-b border-border/60 pb-4 text-sm font-medium text-muted-foreground">
						All issues
					</h2>
					<ol className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
						{rest.map((issue) => (
							<li key={issue._id.toString()}>
								<CardIssue issue={issue} newsletter={newsletter} href={urls.post(issue.archiveSlug)} />
							</li>
						))}
					</ol>
				</section>
			)}
		</>
	);
}
