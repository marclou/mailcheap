import Image from "next/image";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { isOptimizableImage } from "@/lib/thumbnail";
import { cn } from "@/lib/utils";
import { getWebImageUrl } from "@/lib/web-page";

export default function ThumbnailCampaign({ campaign, newsletter, width = 64, height = 40, hasBadge = true, className }) {
	const src = getWebImageUrl(campaign);

	return (
		<span style={{ width, height }} className={cn("relative shrink-0", className)}>
			{src ? (
				<Image
					src={src}
					alt=""
					width={width}
					height={height}
					unoptimized={!isOptimizableImage(src)}
					loading="lazy"
					className="size-full rounded-md bg-muted object-cover outline -outline-offset-1 outline-black/10 dark:outline-white/10"
				/>
			) : (
				<span className="grid size-full place-items-center rounded-md bg-muted">
					<AvatarNewsletter newsletter={newsletter} size={Math.round(height * 0.6)} />
				</span>
			)}
			{src && hasBadge && (
				<AvatarNewsletter
					newsletter={newsletter}
					size={18}
					className="absolute -right-1.5 -bottom-1.5 ring-2 ring-background"
				/>
			)}
		</span>
	);
}
