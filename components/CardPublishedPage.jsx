import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Globe, PenLine, Pin } from "lucide-react";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonPinPage from "@/components/ButtonPinPage";
import ImageFavicon from "@/components/ImageFavicon";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import { Button } from "@/components/ui/button";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { isOptimizableImage } from "@/lib/thumbnail";
import { cn } from "@/lib/utils";

// A sent issue's page as its website and link previews show it, { title, description, imageUrl } (its own picture or
// the card MailCheap draws), with what changes it: its editor, its place at the top of the website, which only a page
// the website lists can take, and its address.
export default function CardPublishedPage({ id, page, slug, newsletter, isPinned, isListed, className, style }) {
	const urls = getArchiveUrls(newsletter);
	const pageUrl = urls.absolutePost(slug);
	const { host } = new URL(pageUrl);

	return (
		<section style={style} className={cn("flex flex-col overflow-hidden rounded-xl bg-card shadow-border", className)}>
			<div className="p-2 pb-0">
				<a
					href={pageUrl}
					target="_blank"
					rel="noreferrer"
					aria-label="View page"
					className="group relative block overflow-hidden rounded-lg bg-muted outline -outline-offset-1 outline-foreground/10"
				>
					{page.imageUrl ? (
						<Image
							src={page.imageUrl}
							alt=""
							width={600}
							height={315}
							unoptimized={!isOptimizableImage(page.imageUrl)}
							className="aspect-[1200/630] w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.015] motion-reduce:transition-none"
						/>
					) : (
						<span className="grid aspect-[1200/630] w-full place-items-center text-muted-foreground">
							<Globe className="size-6" />
						</span>
					)}
					{isPinned && (
						<span className="absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-background/85 px-2.5 text-xs font-medium shadow-sm backdrop-blur-sm">
							<Pin aria-hidden="true" className="size-3" />
							Pinned
						</span>
					)}
				</a>
			</div>
			<div className="flex flex-1 flex-col px-4 pt-4 pb-4">
				<p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
					<ImageFavicon domain={host} size={14} />
					<span className="truncate">{host}</span>
				</p>
				<h3 className="mt-2 line-clamp-2 text-base/snug font-semibold text-balance">{page.title || "Untitled"}</h3>
				{page.description && <p className="mt-1 line-clamp-2 text-sm text-pretty text-muted-foreground">{page.description}</p>}
				<div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
					<Button asChild size="sm">
						<Link href={`/campaigns/${id}/web`}>
							<PenLine data-icon="inline-start" />
							Edit web page
						</Link>
					</Button>
					<Button asChild variant="outline" size="sm">
						<a href={pageUrl} target="_blank" rel="noreferrer">
							<ExternalLink data-icon="inline-start" />
							View
						</a>
					</Button>
					{isListed && <ButtonPinPage id={id} isPinned={isPinned} />}
				</div>
			</div>
			<div className="flex items-center gap-1 border-t border-border/60 bg-muted/30 pr-1.5 pl-4 transition-colors duration-150 focus-within:bg-muted/50">
				<div className="min-w-0 flex-1">
					<InputCampaignSlug campaignId={id} initialSlug={slug} urlBase={urls.absolutePost("")} isPublished isCompact />
				</div>
				<ButtonCopy value={pageUrl} label="Copy link" />
			</div>
		</section>
	);
}
