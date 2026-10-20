import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import DialogSegment from "@/components/DialogSegment";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// The contacts list's segments as cards: everyone, then each segment with the active contacts it picks now. The one
// picked filters the list below and can be edited. hrefFor(id) keeps the list's other filters.
export default function ListSegments({ newsletterId, segments, selectedId, everyoneCount, hrefFor }) {
	return (
		<nav aria-label="Segments" className="-mx-1 -my-1 overflow-x-auto px-1 py-1 animate-enter [scrollbar-width:none]">
			<ul className="flex items-stretch gap-2">
				<li className="shrink-0">
					<CardSegment href={hrefFor(null)} name="Everyone" count={everyoneCount} description="Every subscribed contact" isActive={!selectedId} />
				</li>
				{segments.map((segment) => {
					const isActive = segment.id === selectedId;
					return (
						<li key={segment.id} className="relative shrink-0">
							<CardSegment
								href={hrefFor(segment.id)}
								name={segment.name}
								count={segment.contacts}
								description={segment.description}
								isActive={isActive}
							/>
							{isActive && (
								<DialogSegment
									newsletterId={newsletterId}
									segment={segment}
									trigger={
										<Button variant="ghost" size="icon-sm" aria-label="Edit segment" className="absolute top-2 right-2 text-muted-foreground">
											<Pencil />
										</Button>
									}
								/>
							)}
						</li>
					);
				})}
				<li className="shrink-0">
					<DialogSegment
						newsletterId={newsletterId}
						trigger={
							<button
								type="button"
								className="flex h-full min-h-24 w-40 flex-col justify-between gap-3 rounded-xl border-[1.5px] border-dashed p-3 text-left text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
							>
								<Plus className="size-4" aria-hidden="true" />
								<span className="text-sm font-medium">New segment</span>
							</button>
						}
					/>
				</li>
			</ul>
		</nav>
	);
}

function CardSegment({ href, name, count, description, isActive }) {
	return (
		<Link
			href={href}
			scroll={false}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"flex h-full min-h-24 w-48 flex-col gap-1.5 rounded-xl p-3 outline-none transition-[background-color,box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
				isActive ? "bg-muted/60 shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "shadow-border hover:bg-muted/60"
			)}
		>
			<span className={cn("truncate text-sm font-medium", isActive && "pr-7")}>{name}</span>
			<span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{formatNumber(count)}</span>
			<span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{description}</span>
		</Link>
	);
}
