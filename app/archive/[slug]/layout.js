import { notFound } from "next/navigation";
import FooterArchive from "@/components/FooterArchive";
import HeaderArchive from "@/components/HeaderArchive";
import ProviderSubscribe from "@/components/ProviderSubscribe";
import ScriptSparkLoop from "@/components/ScriptSparkLoop";
import { countReaders, getArchiveNewsletter } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";

export default async function ArchiveLayout({ children, params }) {
	const newsletter = await getArchiveNewsletter((await params).slug);
	if (!newsletter) notFound();

	const readers = await countReaders(newsletter._id.toString());
	const { index } = getArchiveUrls(newsletter);
	const pitch = {
		name: newsletter.name,
		slug: newsletter.slug,
		imageUrl: newsletter.imageUrl,
		description: newsletter.description,
	};

	const { publicationUuid, signupFlowEnabled } = newsletter.sparkloop ?? {};

	return (
		<ProviderSubscribe newsletter={pitch} readers={readers}>
			{signupFlowEnabled && publicationUuid && <ScriptSparkLoop publicationUuid={publicationUuid} />}
			<div className="flex min-h-dvh flex-col">
				<HeaderArchive newsletter={newsletter} indexHref={index} />
				<main className="flex-1">{children}</main>
				<FooterArchive newsletter={newsletter} indexHref={index} />
			</div>
		</ProviderSubscribe>
	);
}
