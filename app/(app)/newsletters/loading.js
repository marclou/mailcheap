import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { Skeleton } from "@/components/ui/skeleton";
import { SETTINGS_SECTIONS } from "@/lib/newsletter-sections";

// The sections' cards, then the form's and the design's.
const CARDS = SETTINGS_SECTIONS.length + 2;

export default function Loading() {
	return (
		<LayoutNarrow>
			<HeaderPage title="Settings" />
			<ul aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{Array.from({ length: CARDS }, (_, index) => (
					<li key={index} className="flex items-center gap-3.5 rounded-xl bg-card p-4 shadow-border">
						<Skeleton className="size-10 shrink-0 rounded-lg" />
						<span className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-3.5 w-24" />
							<Skeleton className="h-3 w-36" />
						</span>
					</li>
				))}
			</ul>
		</LayoutNarrow>
	);
}
