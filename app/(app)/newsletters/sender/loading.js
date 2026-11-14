import SkeletonSettings from "@/components/SkeletonSettings";
import { getSection } from "@/lib/newsletter-sections";

export default function Loading() {
	return <SkeletonSettings title={getSection("sender").label} cards={[3, 2]} />;
}
