import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { sendTimesPipeline } from "@/lib/campaign-queries";
import { isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { MESSAGE_STATS_GROUP } from "@/lib/message-stats";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import { getSparkLoopConnection } from "@/lib/sparkloop-account";
import { SPARKLOOP_PITCH } from "@/lib/sparkloop-content";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();

	await connectDb();
	const campaign = await Campaign.findById(id).lean();
	if (!campaign) notFound();
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
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

	const [audienceCount, domains, sendTimes, sparkloop] = await Promise.all([
		Contact.countDocuments({ newsletterId: newsletter._id, status: "active" }),
		listSesDomains(),
		getSendTimes(campaign),
		getSparkLoopConnection(),
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
			hasSparkLoopCards={
				SPARKLOOP_PITCH || (sparkloop.status === "connected" && Boolean(newsletter.sparkloop?.publicationUuid))
			}
		/>
	);
}

// A newsletter's first issue borrows the times the other newsletters go out.
async function getSendTimes(campaign) {
	const own = await Campaign.aggregate(
		sendTimesPipeline({ newsletterId: campaign.newsletterId, excludeId: campaign._id })
	);
	const rows = own.length > 0 ? own : await Campaign.aggregate(sendTimesPipeline({ excludeId: campaign._id }));
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}

// Only a send capped to the most engaged has a next step. Close enough for the dialog: contacts who
// left after receiving it make this a little low, and the send itself skips everyone who has it.
async function countRemaining(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit) return 0;
	const active = await Contact.countDocuments({ newsletterId: campaign.newsletterId, status: "active" });
	const reached = (campaign.stats?.recipients ?? 0) + (campaign.lastChance?.recipients ?? 0);
	return Math.max(0, active - reached);
}

async function getProviderBreakdown(campaignId) {
	const rows = await Message.aggregate([
		{ $match: { campaignId, kind: "campaign" } },
		{ $group: { _id: { $ifNull: ["$provider", "other"] }, ...MESSAGE_STATS_GROUP } },
		{ $sort: { sent: -1 } },
	]);
	return rows.filter(({ sent }) => sent > 0).map(({ _id, ...row }) => ({ provider: _id, ...row }));
}
