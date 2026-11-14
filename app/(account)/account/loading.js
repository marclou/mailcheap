import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { SkeletonCards } from "@/components/SkeletonSettings";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<LayoutNarrow>
			<HeaderPage title="Account" icon={<Skeleton className="size-8 shrink-0 rounded-full" />} />
			<SkeletonCards cards={[2, 1, 1]} />
		</LayoutNarrow>
	);
}
