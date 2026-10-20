import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ArticleDemo } from "@/components/SiteExtensions";
import { isCloud } from "@/lib/config";
import { HELP_PATH, getHelpArticle, getHelpArticles, getHelpHref } from "@/lib/help";
import { siteExtensions } from "@/lib/site-extensions";
import { cn } from "@/lib/utils";

// An article of the help center (lib/help.js): its group, title and summary, on MailCheap Cloud the picture of its feature,
// its sections, then the articles around it. One this server doesn't have (cloud only) answers 404. Sections are h2s
// with an id, for links to them.
export default function ArticleHelp({ slug, children }) {
	const article = getHelpArticle(slug);
	if (!article) notFound();
	const articles = getHelpArticles();
	const index = articles.findIndex((item) => item.slug === slug);
	const neighbors = [
		{ article: articles[index - 1], label: "Previous", icon: ArrowLeft },
		{ article: articles[index + 1], label: "Next", icon: ArrowRight },
	];
	const { supportChatPath } = siteExtensions;

	return (
		<article className="max-w-2xl">
			<header className="mb-10 animate-enter">
				<p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
					<Link href={HELP_PATH} className="transition-colors duration-150 hover:text-foreground">
						Help
					</Link>
					<span aria-hidden="true">/</span>
					<span>{article.group}</span>
				</p>
				<h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{article.title}</h1>
				<p className="mt-4 text-[17px] leading-8 text-pretty text-muted-foreground">{article.summary}</p>
			</header>

			{isCloud() && ArticleDemo && <ArticleDemo slug={slug} />}

			<div style={{ "--stagger": 1 }} className={cn(PROSE, "animate-enter")}>
				{children}
			</div>

			<nav aria-label="More articles" className="mt-16 grid gap-3 sm:grid-cols-2">
				{neighbors.map(({ article: neighbor, label, icon: Icon }) =>
					neighbor ? (
						<Link
							key={label}
							href={getHelpHref(neighbor.slug)}
							className={cn(
								"group flex flex-col gap-1 rounded-xl bg-card p-4 shadow-border transition-shadow duration-150 hover:shadow-border-hover",
								label === "Next" && "sm:col-start-2 sm:items-end sm:text-right"
							)}
						>
							<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
								{label === "Previous" && <Icon className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" />}
								{label}
								{label === "Next" && <Icon className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />}
							</span>
							<span className="font-medium">{neighbor.title}</span>
						</Link>
					) : null
				)}
			</nav>

			{supportChatPath && (
				<p className="mt-10 text-sm text-pretty text-muted-foreground">
					Still stuck?{" "}
					<a href={supportChatPath} className={LINK_CLASS}>
						Chat with us
					</a>{" "}
					from your dashboard.
				</p>
			)}
		</article>
	);
}

const LINK_CLASS = "font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground";

// The articles are plain HTML elements: headings, paragraphs, lists, links, keys and tables.
const PROSE = [
	"text-[15px] leading-7 text-pretty text-foreground/80 [&>:first-child]:mt-0",
	"[&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
	"[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
	"[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-2 [&_li]:pl-1",
	"[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground",
	"[&_strong]:font-semibold [&_strong]:text-foreground",
	"[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-foreground",
	"[&_kbd]:rounded-md [&_kbd]:bg-muted [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-sans [&_kbd]:text-[13px] [&_kbd]:text-foreground",
	"[&_table]:mt-5 [&_table]:w-full [&_table]:text-left [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:py-2 [&_th]:pr-4 [&_th]:font-medium [&_th]:text-foreground",
	"[&_td]:border-b [&_td]:border-border/60 [&_td]:py-2.5 [&_td]:pr-4 [&_td]:align-top [&_td]:tabular-nums",
].join(" ");
