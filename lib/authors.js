import { scopedNewsletter } from "./account-scope.js";
import { MAX_AUTHORS } from "./author-rules.js";
import { isObjectIdString } from "./validation.js";
import Author from "../models/Author.js";
import Newsletter from "../models/Newsletter.js";

// A newsletter's authors, the first added first, as the editor's menu lists them.
export function listLiveAuthors(account, newsletterId) {
	return Author.find(scopedNewsletter(account, { newsletterId, deletedAt: null }))
		.sort({ createdAt: 1, _id: 1 })
		.limit(MAX_AUTHORS)
		.lean();
}

// One of the account's authors, of a team member's newsletter for them.
export function findLiveAuthor(account, id) {
	if (!isObjectIdString(String(id ?? ""))) return null;
	return Author.findOne(scopedNewsletter(account, { _id: id, deletedAt: null })).lean();
}

// The author a newsletter's new issues start with, whose address gets the replies to its own emails: the one picked on
// its Sender page (Newsletter.defaultAuthorId) while they're still one of its authors, else its first one.
export function pickDefaultAuthor(authors, defaultAuthorId) {
	return authors.find(({ _id }) => String(_id) === String(defaultAuthorId)) ?? authors[0] ?? null;
}

// A newsletter's authors (listLiveAuthors), and its default one among them (pickDefaultAuthor).
export async function findNewsletterAuthors(account, newsletterId) {
	const [authors, newsletter] = await Promise.all([
		listLiveAuthors(account, newsletterId),
		Newsletter.findOne(scopedNewsletter(account, { _id: newsletterId }, "_id")).select({ defaultAuthorId: 1 }).lean(),
	]);
	return { authors, defaultAuthor: pickDefaultAuthor(authors, newsletter?.defaultAuthorId) };
}

export async function findDefaultAuthorId(account, newsletterId) {
	return (await findNewsletterAuthors(account, newsletterId)).defaultAuthor?._id ?? null;
}

// What a newsletter's first author starts with: the signed-in user, at the address its replies went to before authors.
export function getAuthorSuggestion({ user, newsletter }) {
	return { name: user.name || newsletter?.fromName || "", email: newsletter?.replyTo || user.email };
}

// A campaign's author as they are now, as its page shows them. null without one, or once they're removed.
export async function findCurrentAuthor(campaign) {
	if (!campaign?.authorId) return null;
	return Author.findOne({
		accountId: campaign.accountId,
		newsletterId: campaign.newsletterId,
		_id: campaign.authorId,
		deletedAt: null,
	}).lean();
}

// Who a campaign's emails show and the check reads: the author its send started with (sentAuthor), so every email of a
// send is the same, else its author as they are now.
export async function findCampaignAuthor(campaign) {
	return campaign?.sentAuthor?.name ? campaign.sentAuthor : findCurrentAuthor(campaign);
}

// A campaign as its emails and its checks read it: with its author (findCampaignAuthor) as author.
export async function withAuthor(campaign) {
	return campaign && { ...campaign, author: await findCampaignAuthor(campaign) };
}

// What a send keeps of its author (Campaign.sentAuthor).
export function toSentAuthor(author) {
	return {
		name: author.name,
		email: author.email,
		...(author.imageUrl && { imageUrl: author.imageUrl }),
		showInEmails: author.showInEmails !== false,
	};
}

// The author an issue's page shows, { name, imageUrl }, or null: never their address, which isn't even read.
export async function findWebAuthor(newsletter, authorId) {
	if (!authorId) return null;
	const author = await Author.findOne({
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		_id: authorId,
		deletedAt: null,
		showOnWeb: true,
	})
		.select({ name: 1, imageUrl: 1 })
		.lean();
	return author ? { name: author.name, imageUrl: author.imageUrl || null } : null;
}

// An author as the API and the editor get them. defaultAuthor: their newsletter's (pickDefaultAuthor).
export function toAuthorView(author, defaultAuthor = null) {
	return {
		id: String(author._id),
		newsletterId: String(author.newsletterId),
		name: author.name,
		email: author.email,
		imageUrl: author.imageUrl || null,
		showOnWeb: author.showOnWeb !== false,
		showInEmails: author.showInEmails !== false,
		isDefault: Boolean(defaultAuthor) && String(defaultAuthor._id) === String(author._id),
	};
}
