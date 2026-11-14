import SkeletonSettings from "@/components/SkeletonSettings";
import { getSection } from "@/lib/newsletter-sections";

export default function Loading() {
	return <SkeletonSettings title={getSection("general").label} cards={[3]} />;
}
