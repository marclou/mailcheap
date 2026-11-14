import SkeletonSettings from "@/components/SkeletonSettings";
import { getSection } from "@/lib/newsletter-sections";

export default function Loading() {
	return <SkeletonSettings title={getSection("signups").label} cards={[2]} />;
}
