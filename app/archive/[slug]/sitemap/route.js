import { getArchiveAuthor } from "@/lib/archive-author";
import { getArchiveNewsletter, listArchiveIssues } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getIssueDate } from "@/lib/archive-issues";

export const revalidate = 3600;

function escapeXml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function entry(loc, date) {
	const lastmod = date ? `<lastmod>${new Date(date).toISOString()}</lastmod>` : "";
	return `<url><loc>${escapeXml(loc)}</loc>${lastmod}</url>`;
}

export async function GET(_request, { params }) {
	const newsletter = await getArchiveNewsletter((await params).slug);
	if (!newsletter) return new Response("Not found", { status: 404 });

	const urls = getArchiveUrls(newsletter);
	const issues = await listArchiveIssues(newsletter);
	const latestDate = getIssueDate(issues[0]);
	const xml = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		entry(urls.siteIndex, latestDate),
		entry(urls.absoluteAuthor(getArchiveAuthor(newsletter).slug), latestDate),
		...issues.map((issue) => entry(urls.absolutePost(issue.archiveSlug), issue.editedAt ?? getIssueDate(issue))),
		"</urlset>",
	].join("\n");

	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
		},
	});
}
