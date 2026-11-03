// An issue's page on the website starts as its email: the subject as its title, the preview text as its description, the
// email's content, and its first picture on its cards and in link previews. Campaign.web keeps where it differs: a title,
// a description and a picture picked for the website, and once the issue is out there, content of its own, which leaves
// the email as it was sent (models/Campaign.js).

// The picture MailCheap draws with the title (app/archive/[slug]/og/route.js), picked instead of one of the issue's.
export const WEB_CARD = "card";
export const MAX_WEB_TITLE_LENGTH = 200;
export const MAX_WEB_DESCRIPTION_LENGTH = 300;
export const MAX_WEB_IMAGE_URL_LENGTH = 2000;

export function getWebTitle(campaign) {
	return campaign?.web?.title || campaign?.subject || "";
}

export function getWebDescription(campaign) {
	return campaign?.web?.description || campaign?.previewText || "";
}

export function hasWebContent(campaign) {
	return Boolean(campaign?.web?.format);
}

// What the page shows: its own content once it has some, else the email's, as stored.
export function getWebContent(campaign) {
	const { format, html, markdown } = hasWebContent(campaign) ? campaign.web : (campaign ?? {});
	return { format, html, markdown };
}

// The picture of its cards and link previews: one picked for it, the drawn card (null), or the content's first one.
export function getWebImageUrl(campaign) {
	const image = campaign?.web?.image;
	if (image === WEB_CARD) return null;
	return image || campaign?.thumbnailUrl || null;
}

// A picture picked for the website: an https:// address, or the drawn card. Empty goes back to the content's first one.
export function isWebImage(value) {
	if (value === "" || value === WEB_CARD) return true;
	if (typeof value !== "string" || value.length > MAX_WEB_IMAGE_URL_LENGTH || !URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
}
