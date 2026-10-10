import { and, eq, isNotNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import { isSendingEnabled } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getProviderInfo, listSendingDomains } from "@/lib/email";
import { findNewsletterById } from "@/lib/records";
import { contacts } from "@/lib/schema";
import { serialize } from "@/lib/serialize";
import { isIdString } from "@/lib/validation";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage({ params }) {
	const { id } = await params;
	const isNew = id === "new";
	if (!isNew && !isIdString(id)) notFound();

	const [newsletter, domains, cleanupTotals] = await Promise.all([
		isNew ? null : findNewsletterById(id),
		listSendingDomains(),
		isNew ? null : getCleanupTotals(id),
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
			/>
			<FormNewsletter
				newsletter={newsletter ? serialize(newsletter) : null}
				verifiedDomains={verifiedDomains}
				isSendingEnabled={isSendingEnabled()}
				testEmail={process.env.ADMIN_EMAIL}
				cleanupTotals={cleanupTotals}
				providerLabel={getProviderInfo().label}
			/>
		</>
	);
}

// Over contacts who ever got the last-chance email. They answered when a sign of life came after it
// (lib/cleanup.js getLastSignOfLife).
async function getCleanupTotals(newsletterId) {
	const lastSignOfLife = sql`greatest(${contacts.lastEngagedAt}, ${contacts.lastOpenAt}, ${contacts.lastClickAt}, ${contacts.confirmedAt}, coalesce(${contacts.subscribedAt}, ${contacts.createdAt}))`;
	const hasAnswered = sql`${contacts.lastChanceAt} < ${lastSignOfLife}`;
	const [totals] = await getDb()
		.select({
			waiting: sql`count(*) filter (where ${contacts.status} = 'active' and not ${hasAnswered})`.mapWith(Number),
			kept: sql`count(*) filter (where ${contacts.status} = 'active' and ${hasAnswered})`.mapWith(Number),
			dormant: sql`count(*) filter (where ${contacts.status} = 'dormant')`.mapWith(Number),
		})
		.from(contacts)
		.where(and(eq(contacts.newsletterId, newsletterId), isNotNull(contacts.lastChanceAt)));
	return { waiting: totals?.waiting ?? 0, kept: totals?.kept ?? 0, dormant: totals?.dormant ?? 0 };
}
