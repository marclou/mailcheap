import HeaderPage from "@/components/HeaderPage";
import { Skeleton } from "@/components/ui/skeleton";
import { DESIGN_SECTION, SETTINGS_PARENT } from "@/lib/newsletter-sections";

export default function Loading() {
	return (
		<div className="mx-auto w-full max-w-5xl">
			<HeaderPage title={DESIGN_SECTION.label} parent={SETTINGS_PARENT} />
			<Skeleton aria-hidden="true" className="h-[32rem] rounded-xl" />
		</div>
	);
}
