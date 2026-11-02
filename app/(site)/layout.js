import FooterSite from "@/components/FooterSite";
import HeaderSite from "@/components/HeaderSite";
import { SiteAnalytics, SiteBand } from "@/components/SiteExtensions";
import { getAppUrl, isCloud } from "@/lib/config";
import { newsreader } from "@/lib/fonts";
import { SITE_OPEN_GRAPH } from "@/lib/site";
import { siteExtensions } from "@/lib/site-extensions";
import { cn } from "@/lib/utils";

const TWITTER_CREATOR = isCloud() ? siteExtensions.twitterCreator : null;

export const metadata = {
	metadataBase: new URL(getAppUrl()),
	robots: { index: true, follow: true },
	manifest: "/site.webmanifest",
	openGraph: SITE_OPEN_GRAPH,
	twitter: { card: "summary_large_image", ...(TWITTER_CREATOR && { creator: TWITTER_CREATOR }) },
};

// The docs need a wider page than the rest, and so does the help center, for the list of an article's sections beside
// it; the header and footer follow whichever page is open.
export default function SiteLayout({ children }) {
	return (
		<div
			className={cn(
				newsreader.variable,
				"flex min-h-dvh flex-col bg-site [--site-width:72rem] has-[[data-layout=docs]]:[--site-width:80rem] has-[[data-layout=help]]:[--site-width:80rem]"
			)}
		>
			<HeaderSite />
			<div className="flex-1">{children}</div>
			{isCloud() && SiteBand && <SiteBand />}
			<FooterSite />
			{SiteAnalytics && <SiteAnalytics />}
		</div>
	);
}
