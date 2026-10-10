import AvatarNewsletter from "@/components/AvatarNewsletter";

// One entry of a SparkLoop directory (a newsletter, a partner program, a brand offer): who it is, what it
// pays, what it says, and its buttons.
export default function CardDirectory({ logo, name, url, payout, title, description, details = [], children }) {
	const shown = details.filter(Boolean);
	return (
		<li className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-border">
			<div className="flex items-start gap-3">
				<AvatarNewsletter newsletter={{ name, imageUrl: logo || null }} size={40} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{name}</p>
					{url && (
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
						>
							{url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
						</a>
					)}
				</div>
			</div>
			{payout && (
				<span className="w-fit rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
					{payout}
				</span>
			)}
			{title && <p className="text-sm font-medium text-pretty">{title}</p>}
			{description && <p className="line-clamp-3 text-xs text-pretty text-muted-foreground">{description}</p>}
			{shown.length > 0 && <p className="text-xs text-muted-foreground">{shown.join(" · ")}</p>}
			<div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">{children}</div>
		</li>
	);
}
