import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import CardIssue from "@/components/CardIssue";
import LinksSocial from "@/components/LinksSocial";
import ScriptJsonLd from "@/components/ScriptJsonLd";
import { getArchiveAuthor } from "@/lib/archive-author";
import { getArchiveNewsletter, listArchiveIssues } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getAuthorSeo } from "@/lib/archive-seo";
import { formatNumber } from "@/lib/format";

export const revalidate = 3600;

export function generateStaticParams() {
	return [];
}

async function getAuthorPage(params) {
	const { slug, author: authorSlug } = await params;
	const newsletter = await getArchiveNewsletter(slug);
	if (!newsletter) return null;
	const author = getArchiveAuthor(newsletter);
	return author.slug === authorSlug ? { newsletter, author } : null;
}

export async function generateMetadata({ params }) {
	const page = await getAuthorPage(params);
	return page ? getAuthorSeo(page.newsletter).metadata : {};
}

export default async function AuthorPage({ params }) {
	const page = await getAuthorPage(params);
	if (!page) notFound();
	const { newsletter, author } = page;

	const issues = await listArchiveIssues(newsletter);
	const urls = getArchiveUrls(newsletter);
	const firstName = author.name.split(" ")[0];

	return (
		<>
			<ScriptJsonLd data={getAuthorSeo(newsletter).jsonLd} />
			<section className="relative isolate overflow-hidden">
				<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-dots" />
				<div className="mx-auto flex max-w-2xl flex-col items-center px-5 pt-16 pb-14 text-center sm:pt-24 sm:pb-16">
					<AvatarNewsletter
						newsletter={{ name: author.name, imageUrl: author.imageUrl }}
						size={96}
						className="rounded-full shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)] animate-enter"
					/>
					<h1 style={{ "--stagger": 1 }} className="mt-6 text-4xl font-theme-heading animate-enter sm:text-5xl">
						{author.name}
					</h1>
					{author.bio && (
						<p
							style={{ "--stagger": 2 }}
							className="mt-4 max-w-xl text-lg text-muted-foreground text-balance animate-enter"
						>
							{author.bio}
						</p>
					)}
					<p style={{ "--stagger": 3 }} className="mt-3 text-sm text-muted-foreground tabular-nums animate-enter">
						Writes{" "}
						<a
							href={urls.index}
							className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
						>
							{newsletter.name}
						</a>{" "}
						· {formatNumber(issues.length)} issues
					</p>
					<div style={{ "--stagger": 4 }} className="mt-6 animate-enter">
						<LinksSocial links={newsletter.socialLinks} />
					</div>
				</div>
			</section>

			{issues.length > 0 && (
				<section className="mx-auto max-w-5xl px-5 pb-24">
					<h2 className="mb-6 border-b border-border/60 pb-4 text-sm font-medium text-muted-foreground">
						Issues by {firstName}
					</h2>
					<ol className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
						{issues.map((issue, index) => (
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
		</>
	);
}
