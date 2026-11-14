import HeaderPage from "@/components/HeaderPage";
import { SkeletonList } from "@/components/SkeletonSettings";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<>
			<HeaderPage title="API keys">
				<Skeleton className="h-9 w-28 rounded-lg" />
			</HeaderPage>
			<SkeletonList />
		</>
	);
}
