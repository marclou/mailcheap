import { redirect } from "next/navigation";
import CardSummaryEmail from "@/components/CardSummaryEmail";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { scoped } from "@/lib/account-scope";
import { APP_NAME, getEmailFrom, isCloud } from "@/lib/config";
import { gravatarHash } from "@/lib/gravatar";
import { NOTIFICATIONS_SECTION, SETTINGS_PARENT, SETTINGS_PATH } from "@/lib/newsletter-sections";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { requireRole } from "@/lib/selected-newsletter";
import { SUMMARY_HOUR, getSummaryFrequency, isSummaryEligible } from "@/lib/summary";
import { OWNER_ROLE } from "@/lib/team-rules";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: NOTIFICATIONS_SECTION.label };

// What MailCheap emails its owner about the open newsletter, a card for each kind. A self-hosted server sends none of
// them: its settings have no such page.
export default async function NotificationsPage() {
	if (!isCloud()) redirect(SETTINGS_PATH);
	const { user, account, selected } = await requireRole(OWNER_ROLE);
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: selected._id })).select({ name: 1, notifications: 1 }).lean();
	const newsletterId = String(newsletter._id);

	return (
		<LayoutNarrow>
			<HeaderPage title={NOTIFICATIONS_SECTION.label} parent={SETTINGS_PARENT} />
			<div className="flex flex-col gap-4">
				<CardSummaryEmail
					key={newsletterId}
					newsletterId={newsletterId}
					frequency={getSummaryFrequency(newsletter)}
					isEligible={isSummaryEligible(account)}
					hour={SUMMARY_HOUR}
					sender={getSummarySender()}
					recipient={getSummaryRecipient(user)}
					stagger={1}
				/>
			</div>
		</LayoutNarrow>
	);
}

// MailCheap as the preview shows the sender, the way the inbox will.
function getSummarySender() {
	const from = getEmailFrom() ?? "";
	return { name: APP_NAME, fromName: APP_NAME, fromEmail: /<([^>]+)>/.exec(from)?.[1] ?? from, imageUrl: "/icon-192.png" };
}

// Summaries go to the account's owner (lib/summary-send.js), who is always the one signed in.
function getSummaryRecipient(user) {
	return { name: user.name, email: user.email, image: user.image, gravatarHash: gravatarHash(user.email) };
}
