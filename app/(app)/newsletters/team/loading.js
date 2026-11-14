import SkeletonSettings, { SkeletonList } from "@/components/SkeletonSettings";
import { TEAM_SECTION } from "@/lib/newsletter-sections";

export default function Loading() {
	return (
		<SkeletonSettings title={TEAM_SECTION.label}>
			<SkeletonList rows={2} />
		</SkeletonSettings>
	);
}
