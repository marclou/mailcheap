import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { Skeleton } from "@/components/ui/skeleton";
import { SETTINGS_PARENT } from "@/lib/newsletter-sections";

const NAME_WIDTHS = [44, 32, 52, 38, 46];

// A page of the newsletter's settings while it loads (loading.js): its title, then its cards, or children in their place.
export default function SkeletonSettings({ title, cards, children }) {
	return (
		<LayoutNarrow>
			<HeaderPage title={title} parent={SETTINGS_PARENT} />
			{children ?? <SkeletonCards cards={cards} />}
		</LayoutNarrow>
	);
}

// CardSettings while they load. cards: how many rows each one has.
export function SkeletonCards({ cards = [3, 2] }) {
	return (
		<div aria-hidden="true" className="flex flex-col gap-4">
			{cards.map((rows, card) => (
				<div key={card} className="rounded-xl bg-card shadow-border">
					<div className="flex h-12 items-center px-4">
						<Skeleton className="h-3.5 w-28" />
					</div>
					<div className="divide-y divide-border/60 border-t border-border/60">
						{Array.from({ length: rows }, (_, row) => (
							<div key={row} className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
								<Skeleton className="h-3.5 w-20 sm:mt-2.5" />
								<Skeleton className="h-9 rounded-lg" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

// A short table while it loads, like the API keys or a team.
export function SkeletonList({ rows = 3 }) {
	return (
		<div aria-hidden="true" className="divide-y divide-border/60 overflow-hidden rounded-xl shadow-border">
			<div className="flex h-10 items-center px-4">
				<Skeleton className="h-3 w-16" />
			</div>
			{Array.from({ length: rows }, (_, row) => (
				<div key={row} className="flex h-13 items-center gap-3 px-4">
					<Skeleton className="size-7 shrink-0 rounded-full" />
					<Skeleton className="h-3.5" style={{ width: `${NAME_WIDTHS[row % NAME_WIDTHS.length]}%` }} />
					<Skeleton className="ml-auto h-3 w-16" />
				</div>
			))}
		</div>
	);
}
