import NavHelp from "@/components/NavHelp";
import { ArticleUpsell } from "@/components/SiteExtensions";
import { isCloud } from "@/lib/config";
import { getHelpGroups } from "@/lib/help";

export const metadata = {
	title: { default: "Help", template: "%s · MailCheap help" },
	description: "How MailCheap works, in plain words: your newsletter, contacts, writing and sending, and your account.",
};

export default function HelpLayout({ children }) {
	return (
		<div className="mx-auto grid max-w-(--site-width) grid-cols-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[12.5rem_minmax(0,1fr)] md:gap-12 md:py-10 lg:px-8">
			<aside className="min-w-0 md:sticky md:top-24 md:self-start">
				<NavHelp groups={getHelpGroups()} />
			</aside>
			<main className="min-w-0 pb-24">
				{children}
				{isCloud() && ArticleUpsell && <ArticleUpsell />}
			</main>
		</div>
	);
}
