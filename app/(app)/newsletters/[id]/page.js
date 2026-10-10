import { Types, isValidObjectId } from "mongoose";
import Link from "next/link";
import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import { Button } from "@/components/ui/button";
import { cleanupTotalsPipeline } from "@/lib/cleanup";
import { isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import { getSparkLoopConnection } from "@/lib/sparkloop-account";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage({ params }) {
	const { id } = await params;
	const isNew = id === "new";
	if (!isNew && !isValidObjectId(id)) notFound();

	await connectDb();
	const [newsletter, domains, cleanupTotals, sparkloop] = await Promise.all([
		isNew ? null : Newsletter.findById(id).lean(),
		listSesDomains(),
		isNew ? null : getCleanupTotals(id),
		getSparkLoopConnection(),
	]);
	if (!isNew && !newsletter) notFound();

	const verifiedDomains = Array.isArray(domains)
		? domains.filter(({ verified }) => verified).map(({ domain }) => domain)
		: null;

	return (
		<>
			<HeaderPage
				title={isNew ? "New newsletter" : newsletter.name}
				backHref="/newsletters"
				icon={newsletter && <AvatarNewsletter newsletter={newsletter} size={32} />}
			>
				{newsletter && (
					<Button asChild variant="outline">
						<Link href={getSparkLoopHref(newsletter, sparkloop)}>SparkLoop</Link>
					</Button>
				)}
			</HeaderPage>
			<FormNewsletter
				newsletter={newsletter ? serialize(newsletter) : null}
				verifiedDomains={verifiedDomains}
				isSendingEnabled={isSendingEnabled()}
				testEmail={process.env.ADMIN_EMAIL}
				cleanupTotals={cleanupTotals}
			/>
		</>
	);
}

// Where this newsletter's SparkLoop settings are: its signup flow once linked, the setup page before.
function getSparkLoopHref(newsletter, connection) {
	if (connection.status === "connected" && newsletter.sparkloop?.publicationUuid) {
		return `/sparkloop/signup-flow?newsletter=${newsletter._id}`;
	}
	return "/sparkloop";
}

async function getCleanupTotals(newsletterId) {
	const [totals] = await Contact.aggregate(cleanupTotalsPipeline(new Types.ObjectId(newsletterId)));
	return { waiting: totals?.waiting ?? 0, kept: totals?.kept ?? 0, dormant: totals?.dormant ?? 0 };
}
