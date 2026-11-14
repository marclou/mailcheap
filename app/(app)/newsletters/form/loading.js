import SkeletonSettings from "@/components/SkeletonSettings";
import { FORM_SECTION } from "@/lib/newsletter-sections";

export default function Loading() {
	return <SkeletonSettings title={FORM_SECTION.label} cards={[2]} />;
}
