import NavDocs from "@/components/NavDocs";
import { ArticleUpsell } from "@/components/SiteExtensions";
import { getAppUrl, isCloud } from "@/lib/config";
import { DOC_PAGES } from "@/lib/docs/llms";
import { getEndpointGroups } from "@/lib/docs/reference";

export const metadata = {
	title: { default: "API and MCP", template: "%s · MailCheap API and MCP" },
	description: "The MailCheap REST API and MCP server: every action of the dashboard, from code or an AI assistant.",
};

export default function DocsLayout({ children }) {
	const groups = getEndpointGroups(getAppUrl()).map(({ group, slug, endpoints }) => ({ group, slug, count: endpoints.length }));

	return (
		<div
			data-layout="docs"
			className="mx-auto grid max-w-(--site-width) grid-cols-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[12.5rem_minmax(0,1fr)] md:gap-12 md:py-10 lg:px-8"
		>
			<aside className="min-w-0 md:sticky md:top-24 md:self-start">
				<NavDocs pages={DOC_PAGES} groups={groups} />
			</aside>
			<main className="min-w-0 pb-24">
				{children}
				{isCloud() && ArticleUpsell && <ArticleUpsell />}
			</main>
		</div>
	);
}
