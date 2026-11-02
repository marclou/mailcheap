import LogoGoogleAnalytics from "@/components/LogoGoogleAnalytics";
import LogoMeta from "@/components/LogoMeta";
import LogoTagManager from "@/components/LogoTagManager";
import { cn } from "@/lib/utils";

const LOGOS = { googleAnalytics: LogoGoogleAnalytics, googleTagManager: LogoTagManager, metaPixel: LogoMeta };

// An analytics tool's own logo (lib/website-analytics.js), not its favicon: favicon services answer both Google tools
// with Google's G, and Meta's on a white square that shows in dark mode.
export default function LogoAnalyticsTool({ tool, size = 16, className }) {
	const Logo = LOGOS[tool];
	return <Logo size={size} className={cn("shrink-0", className)} />;
}
