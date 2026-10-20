import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import FormKeep from "@/components/FormKeep";
import StyleTheme from "@/components/StyleTheme";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { connectDb } from "@/lib/db";
import { verifyKeepToken } from "@/lib/last-chance";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";

// The URL carries the keep token: keep it out of search results and referrer headers.
export const metadata = {
	title: "Keep getting the newsletter",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

export default async function KeepPage({ searchParams }) {
	const { token } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyKeepToken(validToken);
	const newsletter = reference ? await getNewsletter(reference.newsletterId) : null;

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<StyleTheme theme={newsletter?.theme} />
			{newsletter ? (
				<FormKeep
					token={validToken}
					newsletterName={newsletter.name}
					archiveUrl={newsletter.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null}
				/>
			) : (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					It may be older than 90 days. Sign up again to keep getting the newsletter.
				</CardNotice>
			)}
		</main>
	);
}

async function getNewsletter(newsletterId) {
	try {
		await connectDb();
		return await findNewsletterAnywhere({ _id: newsletterId });
	} catch (error) {
		console.error("[keep] Could not load the newsletter:", error.message);
		return null;
	}
}
