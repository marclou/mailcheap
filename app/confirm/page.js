import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import FormConfirm from "@/components/FormConfirm";
import StyleTheme from "@/components/StyleTheme";
import { hasPublishedIssue } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { verifyConfirmToken } from "@/lib/confirmation";
import { connectDb } from "@/lib/db";
import { findOpenNewsletter } from "@/lib/public-newsletters";

// The URL carries the confirmation token: keep it out of search results and referrer headers.
export const metadata = {
	title: "Confirm your subscription",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

export default async function ConfirmPage({ searchParams }) {
	const { token } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyConfirmToken(validToken);
	const newsletter = reference ? await getNewsletter(reference.newsletterId) : null;

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<StyleTheme theme={newsletter?.theme} />
			{newsletter ? (
				<FormConfirm
					token={validToken}
					newsletterName={newsletter.name}
					fromName={newsletter.fromName}
					fromEmail={newsletter.fromEmail}
					archiveUrl={newsletter.isArchiveLive ? getArchiveUrls(newsletter).siteIndex : null}
				/>
			) : (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					It may be older than 30 days. Sign up again and use the newest confirmation email.
				</CardNotice>
			)}
		</main>
	);
}

async function getNewsletter(newsletterId) {
	try {
		await connectDb();
		const newsletter = await findOpenNewsletter({ _id: newsletterId });
		return newsletter && { ...newsletter, isArchiveLive: newsletter.archiveEnabled && (await hasPublishedIssue(newsletter)) };
	} catch (error) {
		console.error("[confirm] Could not load the newsletter:", error.message);
		return null;
	}
}
