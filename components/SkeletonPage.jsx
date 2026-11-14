import { Skeleton } from "@/components/ui/skeleton";

// A page whose layout depends on what it loads, like a campaign that's a draft or a report: a title and what's under it.
// hasBack: the room of its back arrow.
export default function SkeletonPage({ hasBack = false }) {
	return (
		<div aria-hidden="true">
			<div className="mb-8 flex items-center gap-2">
				{hasBack && <span className="-ml-2 size-9 shrink-0" />}
				<div className="flex flex-col gap-2.5">
					<Skeleton className="h-7 w-56" />
					<Skeleton className="h-3.5 w-40" />
				</div>
			</div>
			<div className="flex flex-col gap-6">
				<Skeleton className="h-24 rounded-xl" />
				<Skeleton className="h-96 rounded-xl" />
			</div>
		</div>
	);
}
