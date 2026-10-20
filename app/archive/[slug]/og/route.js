import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { countReaders, getArchiveIssue, getArchiveNewsletter } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getIssueDate } from "@/lib/archive-issues";
import { SHARE_IMAGE_SIZE } from "@/lib/archive-seo";
import { mixColors } from "@/lib/colors";
import { getAppUrl } from "@/lib/config";
import { formatDate, formatNumber } from "@/lib/format";
import { readLogo } from "@/lib/og-image";
import { resolveTheme } from "@/lib/themes";

const [geistRegular, geistSemiBold] = await Promise.all([
	readFile(join(process.cwd(), "assets/fonts/Geist-Regular.ttf")),
	readFile(join(process.cwd(), "assets/fonts/Geist-SemiBold.ttf")),
]);
const FONTS = [
	{ name: "Geist", data: geistRegular, weight: 400, style: "normal" },
	{ name: "Geist", data: geistSemiBold, weight: 600, style: "normal" },
];
const COLORS = { foreground: "#0a0a0a", muted: "#737373", border: "#e5e5e5" };

// Each issue gets its own soft tint, so archive cards stand out from the page and a row of them
// doesn't look like one card repeated. A newsletter theme's palette tints toward its accent instead.
function issueBackground(slug, theme) {
	let hue = 0;
	for (const character of slug) hue = (hue * 31 + character.codePointAt(0)) % 360;
	if (theme.isAdaptive) return `linear-gradient(135deg, hsl(${hue}, 85%, 96%), hsl(${(hue + 45) % 360}, 75%, 89%))`;
	const { background, accent } = theme.colors;
	const step = (hue % 4) * 0.05;
	return `linear-gradient(135deg, ${mixColors(background, accent, 0.06 + step)}, ${mixColors(background, accent, 0.26 + step)})`;
}

function getColors(theme) {
	if (theme.isAdaptive) return { background: "#ffffff", ...COLORS };
	return { background: theme.colors.background, foreground: theme.colors.text, muted: theme.palette.mutedText, border: theme.palette.border };
}

// Share card for the archive home, and for issues that have no thumbnail of their own.
export async function GET(request, { params }) {
	const { slug } = await params;
	const newsletter = await getArchiveNewsletter(slug);
	if (!newsletter) return new Response("Not found", { status: 404 });

	const postSlug = new URL(request.url).searchParams.get("p");
	const issue = postSlug ? await getArchiveIssue(newsletter, postSlug) : null;
	if (postSlug && !issue) return new Response("Not found", { status: 404 });

	const [logo, readers] = await Promise.all([readLogo(newsletter.imageUrl), countReaders(newsletter)]);
	const domain = new URL(getArchiveUrls(newsletter).siteIndex).host;
	const footer = issue ? formatDate(getIssueDate(issue)) : readers >= 100 ? `Join ${formatNumber(readers)} readers` : "";
	const theme = resolveTheme(newsletter.theme);
	const colors = getColors(theme);

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: 72,
				backgroundColor: colors.background,
				...(issue && { backgroundImage: issueBackground(issue.archiveSlug, theme) }),
				fontFamily: "Geist",
				color: colors.foreground,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 20 }}>
				{logo && (
					// eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>
					<img
						src={logo}
						width={issue ? 64 : 112}
						height={issue ? 64 : 112}
						style={{ borderRadius: issue ? 16 : 28, border: `1px solid ${colors.border}` }}
						alt=""
					/>
				)}
				{issue && <span style={{ fontSize: 32, fontWeight: 600 }}>{newsletter.name}</span>}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
				<span
					style={{
						fontSize: issue ? 64 : 88,
						fontWeight: 600,
						lineHeight: 1.08,
						letterSpacing: issue ? -2 : -3,
					}}
				>
					{issue ? issue.subject : newsletter.name}
				</span>
				{(issue ? issue.previewText : newsletter.description) && (
					<span style={{ fontSize: 32, lineHeight: 1.35, color: colors.muted }}>
						{issue ? issue.previewText : newsletter.description}
					</span>
				)}
			</div>

			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: colors.muted }}>
				<span>{footer}</span>
				<span>{domain}</span>
			</div>
		</div>,
		{
			...SHARE_IMAGE_SIZE,
			fonts: FONTS,
			headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
		}
	);
}
