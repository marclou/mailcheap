import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeDate from "@/components/BadgeDate";
import BadgeViews from "@/components/BadgeViews";
import CardIssue from "@/components/CardIssue";
import FrameIssue from "@/components/FrameIssue";
import LinksShare from "@/components/LinksShare";
import PitchSubscribe from "@/components/PitchSubscribe";
import ScriptJsonLd from "@/components/ScriptJsonLd";
import TrackView from "@/components/TrackView";
import TriggerSubscribe from "@/components/TriggerSubscribe";
import { getArchiveAuthor } from "@/lib/archive-author";
import { renderIssueBody } from "@/lib/archive-content";
import { countReaders, getArchiveIssue, getArchiveNewsletter, listArchiveIssues } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getIssueDate } from "@/lib/archive-issues";
import { getIssueSeo } from "@/lib/archive-seo";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

export function generateStaticParams() {
	return [];
}

async function getIssuePage(params) {
	const { slug, post } = await params;
	const newsletter = await getArchiveNewsletter(slug);
	const issue = newsletter && (await getArchiveIssue(newsletter, post));
	return issue ? { newsletter, issue } : null;
}

export async function generateMetadata({ params }) {
	const page = await getIssuePage(params);
	return page ? getIssueSeo(page.newsletter, page.issue).metadata : {};
}

export default async function IssuePage({ params }) {
	const page = await getIssuePage(params);
	if (!page) notFound();
	const { newsletter, issue } = page;

	const [more, readers] = await Promise.all([
		listArchiveIssues(newsletter, { limit: 3, excludeId: issue._id }),
		countReaders(newsletter),
	]);
	const urls = getArchiveUrls(newsletter);
	const body = renderIssueBody(issue);
	const date = getIssueDate(issue);
	const views = issue.webViews ?? 0;
	const author = getArchiveAuthor(newsletter);
	const pitch = {
		name: newsletter.name,
		slug: newsletter.slug,
		imageUrl: newsletter.imageUrl,
		description: newsletter.description,
	};

	return (
		<>
			<ScriptJsonLd data={getIssueSeo(newsletter, issue).jsonLd} />
			<article className="mx-auto max-w-2xl px-5 pt-12 sm:pt-16">
				<header className="animate-enter">
					<h1 className="text-4xl font-theme-heading text-balance sm:text-[2.75rem] sm:leading-[1.1]">
						{issue.subject}
					</h1>
					{issue.previewText && (
						<p className="mt-4 text-xl text-muted-foreground text-pretty">{issue.previewText}</p>
					)}
					<div className="mt-6 flex items-center justify-between gap-4">
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
							<a
								href={urls.author(author.slug)}
								rel="author"
								className="flex min-w-0 items-center gap-2 font-medium text-foreground transition-opacity duration-150 hover:opacity-75"
							>
								<AvatarNewsletter
									newsletter={{ name: author.name, imageUrl: author.imageUrl }}
									size={24}
									className="rounded-full"
								/>
								<span className="truncate">{author.name}</span>
							</a>
							{date && <BadgeDate date={date} />}
							{views > 0 && <BadgeViews views={views} />}
						</div>
						<LinksShare
							url={urls.absolutePost(issue.archiveSlug)}
							text={issue.subject}
							className="-mr-2.5 shrink-0"
						/>
					</div>
				</header>

				{body.kind === "article" ? (
					<div
						style={{ "--stagger": 1 }}
						className="prose-issue mt-10 animate-enter"
						dangerouslySetInnerHTML={{ __html: body.html }}
					/>
				) : (
					<FrameIssue html={body.html} className="-mx-5 mt-10 rounded-none sm:mx-0 sm:rounded-xl" />
				)}
			</article>

			<section id="subscribe" className={cn("mx-auto max-w-2xl scroll-mt-24 px-5 pt-16", more.length === 0 && "pb-24")}>
				<div className="rounded-2xl bg-card px-6 py-10 shadow-border sm:px-10">
					<PitchSubscribe newsletter={pitch} readers={readers} />
				</div>
			</section>

			{more.length > 0 && (
				<section className="mx-auto max-w-5xl px-5 pt-20 pb-24">
					<div className="mb-6 flex items-baseline justify-between gap-4 border-b border-border/60 pb-4">
						<h2 className="text-sm font-medium text-muted-foreground">Keep reading</h2>
						<a
							href={urls.index}
							className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
						>
							All issues →
						</a>
					</div>
					<ol className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
						{more.map((other) => (
							<li key={other._id.toString()}>
								<CardIssue issue={other} newsletter={newsletter} href={urls.post(other.archiveSlug)} />
							</li>
						))}
					</ol>
				</section>
			)}

			<TriggerSubscribe newsletterSlug={newsletter.slug} />
			<TrackView issueId={issue._id.toString()} />
		</>
	);
}
