import { notFound } from "next/navigation";
import FooterArchive from "@/components/FooterArchive";
import HeaderArchive from "@/components/HeaderArchive";
import ProviderSubscribe from "@/components/ProviderSubscribe";
import ScriptBotId from "@/components/ScriptBotId";
import StyleTheme from "@/components/StyleTheme";
import { countReaders, getArchiveNewsletter } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { BOTID_WEBSITE, isBotIdEnabled } from "@/lib/bot-check";

export default async function ArchiveLayout({ children, params }) {
	const newsletter = await getArchiveNewsletter((await params).slug);
	if (!newsletter) notFound();

	const readers = await countReaders(newsletter);
	const { index } = getArchiveUrls(newsletter);
	const pitch = {
		name: newsletter.name,
		slug: newsletter.slug,
		imageUrl: newsletter.imageUrl,
		description: newsletter.description,
	};

	return (
		<ProviderSubscribe newsletter={pitch} readers={readers}>
			<StyleTheme theme={newsletter.theme} />
			{isBotIdEnabled() && <ScriptBotId protect={BOTID_WEBSITE} />}
			<div className="flex min-h-dvh flex-col">
				<HeaderArchive newsletter={newsletter} indexHref={index} />
				<main className="flex-1">{children}</main>
				<FooterArchive newsletter={newsletter} indexHref={index} />
			</div>
		</ProviderSubscribe>
	);
}
