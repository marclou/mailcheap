import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import ImageShareCard from "@/components/ImageShareCard";
import { countReaders, getArchiveIssue, getArchiveNewsletter } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getIssueDate } from "@/lib/archive-issues";
import { SHARE_IMAGE_SIZE } from "@/lib/archive-seo";
import { formatDate, formatNumber } from "@/lib/format";
import { readLogo } from "@/lib/og-image";
import { getIssueBackground, getShareCardColors } from "@/lib/share-card";
import { THEME_MODES, resolveTheme } from "@/lib/themes";

const [geistRegular, geistSemiBold] = await Promise.all([
	readFile(join(process.cwd(), "assets/fonts/Geist-Regular.ttf")),
	readFile(join(process.cwd(), "assets/fonts/Geist-SemiBold.ttf")),
]);
const FONTS = [
	{ name: "Geist", data: geistRegular, weight: 400, style: "normal" },
	{ name: "Geist", data: geistSemiBold, weight: 600, style: "normal" },
];

// Share card for the archive home, and for issues that have no thumbnail of their own: in the mode the theme is made
// for, or ?m= another of its modes, which the website shows its readers in that mode.
export async function GET(request, { params }) {
	const { slug } = await params;
	const newsletter = await getArchiveNewsletter(slug);
	if (!newsletter) return new Response("Not found", { status: 404 });

	const { searchParams } = new URL(request.url);
	const postSlug = searchParams.get("p");
	const askedMode = searchParams.get("m");
	const issue = postSlug ? await getArchiveIssue(newsletter, postSlug) : null;
	if (postSlug && !issue) return new Response("Not found", { status: 404 });

	const [logo, readers] = await Promise.all([readLogo(newsletter.imageUrl), countReaders(newsletter)]);
	const domain = new URL(getArchiveUrls(newsletter).siteIndex).host;
	const footer = issue ? formatDate(getIssueDate(issue)) : readers >= 100 ? `Join ${formatNumber(readers)} readers` : "";
	const theme = resolveTheme(newsletter.theme);
	const mode = THEME_MODES.includes(askedMode) ? askedMode : theme.mode;

	return new ImageResponse(
		<ImageShareCard
			title={issue ? issue.subject : newsletter.name}
			description={issue ? issue.previewText : newsletter.description}
			name={newsletter.name}
			logo={logo}
			footer={footer}
			domain={domain}
			colors={getShareCardColors(theme, mode)}
			background={issue && getIssueBackground(issue.archiveSlug, theme, mode)}
			isIssue={Boolean(issue)}
			fontFamily="Geist"
		/>,
		{
			...SHARE_IMAGE_SIZE,
			fonts: FONTS,
			headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
		}
	);
}
