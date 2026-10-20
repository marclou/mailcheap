import Image from "next/image";
import { cn } from "@/lib/utils";

export default function AvatarNewsletter({ newsletter, size = 20, className }) {
	const radius = size >= 32 ? "rounded-lg" : "rounded-[5px]";

	// Files served by the app are resized to the avatar; remote ones are thumbnails already.
	if (newsletter?.imageUrl) {
		return (
			<Image
				src={newsletter.imageUrl}
				alt=""
				width={size}
				height={size}
				unoptimized={!newsletter.imageUrl.startsWith("/")}
				className={cn(
					"shrink-0 object-cover outline -outline-offset-1 outline-foreground/10",
					radius,
					className
				)}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
			className={cn(
				"grid shrink-0 place-items-center bg-muted font-semibold text-muted-foreground",
				radius,
				className
			)}
		>
			{newsletter?.name?.charAt(0).toUpperCase() || "?"}
		</span>
	);
}
