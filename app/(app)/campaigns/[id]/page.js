import { and, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { listSendTimes } from "@/lib/campaign-queries";
import { isSendingEnabled } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getProviderInfo, listSendingDomains } from "@/lib/email";
import { MESSAGE_STATS_COLUMNS } from "@/lib/message-stats";
import { countActiveContacts, findCampaignById, findNewsletterById } from "@/lib/records";
import { messages } from "@/lib/schema";
import { serialize } from "@/lib/serialize";
import { isAiGatewayConfigured } from "@/lib/subject-ideas";
import { isIdString } from "@/lib/validation";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const { id } = await params;
	if (!isIdString(id)) notFound();

	const campaign = await findCampaignById(id);
	if (!campaign) notFound();
	const newsletter = await findNewsletterById(campaign.newsletterId);
	if (!newsletter) notFound();

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const [providers, remainingCount] = await Promise.all([
			getProviderBreakdown(campaign._id),
			countRemaining(campaign),
		]);
		return (
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				providers={providers}
				remainingCount={remainingCount}
			/>
		);
	}

	const [audienceCount, domains, sendTimes] = await Promise.all([
		countActiveContacts(newsletter._id),
		listSendingDomains(),
		getSendTimes(campaign),
	]);
	const fromDomain = newsletter.fromEmail.split("@")[1];
	const isDomainVerified =
		Array.isArray(domains) && domains.some(({ domain, verified }) => domain === fromDomain && verified);

	return (
		<FormCampaign
			campaign={serialize(campaign)}
			newsletter={serialize(newsletter)}
			audienceCount={audienceCount}
			isDomainVerified={isDomainVerified}
			isSendingEnabled={isSendingEnabled()}
			testEmail={process.env.ADMIN_EMAIL}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
			isAiEnabled={isAiGatewayConfigured()}
			providerLabel={getProviderInfo().label}
		/>
	);
}

// A newsletter's first issue borrows the times the other newsletters go out.
async function getSendTimes(campaign) {
	const own = await listSendTimes({ newsletterId: campaign.newsletterId, excludeId: campaign._id });
	const rows = own.length > 0 ? own : await listSendTimes({ excludeId: campaign._id });
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}

// Only a send capped to the most engaged has a next step. Close enough for the dialog: contacts who
// left after receiving it make this a little low, and the send itself skips everyone who has it.
async function countRemaining(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit) return 0;
	const active = await countActiveContacts(campaign.newsletterId);
	const reached = (campaign.stats?.recipients ?? 0) + (campaign.lastChance?.recipients ?? 0);
	return Math.max(0, active - reached);
}

async function getProviderBreakdown(campaignId) {
	const provider = sql`coalesce(${messages.provider}, 'other')`;
	const rows = await getDb()
		.select({ provider, ...MESSAGE_STATS_COLUMNS })
		.from(messages)
		.where(and(eq(messages.campaignId, campaignId), eq(messages.kind, "campaign")))
		.groupBy(sql.raw("1"))
		.orderBy(desc(MESSAGE_STATS_COLUMNS.sent));
	return rows.filter(({ sent }) => sent > 0);
}
