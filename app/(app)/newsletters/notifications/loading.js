import SkeletonSettings from "@/components/SkeletonSettings";
import { NOTIFICATIONS_SECTION } from "@/lib/newsletter-sections";

export default function Loading() {
	return <SkeletonSettings title={NOTIFICATIONS_SECTION.label} cards={[2]} />;
}
