import { Send } from "lucide-react";
import ButtonNewCampaign from "@/components/ButtonNewCampaign";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import TableCampaigns from "@/components/TableCampaigns";
import { getIssuePageUrl } from "@/lib/archive-data";
import { listRecentCampaigns } from "@/lib/campaign-queries";
import { NEWSLETTER_SUMMARY_FIELDS, toNewsletterMap, toNewsletterOptions } from "@/lib/newsletters";
import { listNewsletters } from "@/lib/records";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
	const [campaigns, newsletters] = await Promise.all([
		listRecentCampaigns(200),
		listNewsletters(`${NEWSLETTER_SUMMARY_FIELDS} archiveEnabled`),
	]);
	const newslettersById = new Map(newsletters.map((newsletter) => [newsletter._id.toString(), newsletter]));
	const pageUrls = Object.fromEntries(
		campaigns
			.map((campaign) => [
				campaign._id.toString(),
				getIssuePageUrl({ campaign, newsletter: newslettersById.get(campaign.newsletterId.toString()) }),
			])
			.filter(([, url]) => url)
	);

	return (
		<>
			<HeaderPage title="Campaigns">
				<ButtonNewCampaign newsletters={toNewsletterOptions(newsletters)} />
			</HeaderPage>

			{campaigns.length === 0 ? (
				<StateEmpty icon={Send} title="No campaigns yet" />
			) : (
				<div className="animate-enter">
					<TableCampaigns
						campaigns={campaigns}
						newsletters={toNewsletterMap(newsletters)}
						hasActions
						pageUrls={pageUrls}
					/>
				</div>
			)}
		</>
	);
}
