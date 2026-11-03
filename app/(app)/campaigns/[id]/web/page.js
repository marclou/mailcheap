import { isValidObjectId } from "mongoose";
import { notFound, redirect } from "next/navigation";
import FormWebPage from "@/components/FormWebPage";
import { scoped } from "@/lib/account-scope";
import { getArchiveAuthor } from "@/lib/archive-author";
import { listOtherIssuePictures } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getFieldOptions } from "@/lib/contact-fields";
import { formatDate } from "@/lib/format";
import { markdownToHtml } from "@/lib/markdown";
import { isOnWebsite, sendsEmail } from "@/lib/publish-to";
import { forWeb } from "@/lib/sections";
import { findInNewsletters, getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { serialize } from "@/lib/serialize";
import { hasRole } from "@/lib/team-rules";
import { getWebContent, hasWebContent } from "@/lib/web-page";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Web page" };

// The page of an issue that's on its website, which changes without its emails (lib/web-page.js). Before it goes out,
// the send step sets its picture, title and description, and the email's content is the page's.
export default async function WebPagePage({ params }) {
	const [{ id }, view] = await Promise.all([params, getSelectedNewsletter()]);
	const { account } = view;
	if (!isValidObjectId(id)) notFound();

	const campaign = await findInNewsletters(view, Campaign, id);
	if (!campaign || campaign.status === "canceled") notFound();
	openNewsletter(view, campaign.newsletterId, `/campaigns/${id}/web`);
	if (!campaign.newsletterId.equals(view.selected._id)) notFound();
	// A sent issue's page is the newsletter's admins' to change.
	if (!hasRole(view.role, "admin")) redirect(`/campaigns/${id}`);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).lean();
	if (!newsletter) notFound();
	if (!newsletter.archiveEnabled || !campaign.archiveSlug || !isOnWebsite(campaign)) redirect(`/campaigns/${id}`);

	const { _id, subject, previewText, web = {} } = campaign;
	const urls = getArchiveUrls(newsletter);
	const publishedAt = campaign.sentAt ?? campaign.startedAt;
	const author = getArchiveAuthor(newsletter);
	return (
		<FormWebPage
			campaign={serialize({ _id, subject, previewText, archiveSlug: campaign.archiveSlug, web: { title: web.title, description: web.description, image: web.image } })}
			content={toEditorContent(getWebContent(campaign))}
			emailContent={hasWebContent(campaign) ? toEditorContent(campaign) : null}
			isWebOnly={!sendsEmail(campaign)}
			publishedOn={formatDate(publishedAt)}
			publishedAt={publishedAt?.toISOString() ?? null}
			newsletter={serialize(newsletter)}
			contactFields={getFieldOptions(account)}
			pageUrl={urls.absolutePost(campaign.archiveSlug)}
			urlBase={urls.absolutePost("")}
			otherPictures={await listOtherIssuePictures(newsletter, campaign._id)}
			isPinned={Boolean(campaign.archivePinned)}
			isListed={campaign.archiveListed !== false}
			author={{ name: author.name, imageUrl: author.imageUrl }}
		/>
	);
}

// What the editor opens on: the page as its website shows it, sections resolved and Markdown as the editor's HTML, and a
// designed HTML email as it is.
function toEditorContent({ format, html, markdown }) {
	if (format === "html") return { format, body: html ?? "" };
	return { format: "rich", body: format === "markdown" ? markdownToHtml(markdown ?? "") : forWeb(html ?? "") };
}
