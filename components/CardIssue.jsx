import Image from "next/image";
import BadgeDate from "@/components/BadgeDate";
import BadgeViews from "@/components/BadgeViews";
import { getIssueDate } from "@/lib/archive-issues";
import { getShareCardUrl } from "@/lib/archive-seo";
import { isOptimizableImage } from "@/lib/thumbnail";
import { cn } from "@/lib/utils";

// Widths of the archive's grid: three columns in max-w-5xl, two from sm, one on phones.
const CARD_SIZES = "(min-width: 1024px) 307px, (min-width: 640px) calc(50vw - 36px), calc(100vw - 40px)";
const FEATURED_SIZES = "(min-width: 1024px) 566px, (min-width: 768px) 54vw, calc(100vw - 40px)";

export default function CardIssue({ issue, newsletter, href, isFeatured = false, isEager = false }) {
	return (
		<a
			href={href}
			className={cn(
				"group flex flex-col gap-4",
				isFeatured && "md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center md:gap-10"
			)}
		>
			<ImageIssue
				issue={issue}
				newsletter={newsletter}
				sizes={isFeatured ? FEATURED_SIZES : CARD_SIZES}
				isEager={isEager}
			/>
			<div className="flex flex-col gap-2">
				<MetaIssue issue={issue} />
				<h3
					className={cn(
						"font-theme-heading text-balance decoration-foreground/30 underline-offset-4 group-hover:underline",
						isFeatured ? "text-2xl sm:text-3xl" : "text-lg leading-snug"
					)}
				>
					{issue.subject}
				</h3>
				{issue.previewText && (
					<p className={cn("text-muted-foreground text-pretty", isFeatured ? "text-lg" : "line-clamp-2")}>
						{issue.previewText}
					</p>
				)}
			</div>
		</a>
	);
}

// Issues without a picture of their own show the card their link previews use.
function ImageIssue({ issue, newsletter, sizes, isEager }) {
	const src = issue.thumbnailUrl || getShareCardUrl(newsletter, issue);

	return (
		<div className="relative aspect-[1200/630] overflow-hidden rounded-xl bg-muted outline -outline-offset-1 outline-foreground/10">
			<Image
				src={src}
				alt=""
				fill
				sizes={sizes}
				unoptimized={!isOptimizableImage(src)}
				loading={isEager ? "eager" : "lazy"}
				fetchPriority={isEager ? "high" : "auto"}
				className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.2,0,0,1)] motion-safe:group-hover:scale-[1.03]"
			/>
		</div>
	);
}

function MetaIssue({ issue }) {
	const date = getIssueDate(issue);
	const views = issue.webViews ?? 0;

	return (
		<p className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
			{date && <BadgeDate date={date} />}
			{views > 0 && <BadgeViews views={views} isCompact />}
		</p>
	);
}
