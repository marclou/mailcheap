import AvatarNewsletter from "@/components/AvatarNewsletter";
import LinksSocial from "@/components/LinksSocial";
import { currentYear } from "@/lib/format";

export default function FooterArchive({ newsletter, indexHref }) {
	return (
		<footer className="border-t border-border/60">
			<div className="mx-auto grid max-w-5xl gap-6 px-5 pt-10 pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
				<div className="flex flex-col gap-3">
					<a href={indexHref} className="flex items-center gap-2.5 font-medium tracking-tight [font-family:var(--theme-font-heading)]">
						<AvatarNewsletter newsletter={newsletter} size={28} />
						{newsletter.name}
					</a>
					{newsletter.description && (
						<p className="max-w-sm text-sm text-muted-foreground text-pretty">{newsletter.description}</p>
					)}
				</div>
				<LinksSocial links={newsletter.socialLinks} className="-ml-2.5 sm:-mr-2.5 sm:ml-0" />
			</div>
			<p className="mx-auto max-w-5xl px-5 pb-10 text-xs text-muted-foreground tabular-nums">
				© {currentYear()} {newsletter.name}
			</p>
		</footer>
	);
}
