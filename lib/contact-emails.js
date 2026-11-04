import "server-only";
import { scoped } from "@/lib/account-scope";
import { getEmailOutcome } from "@/lib/email-outcome";
import Campaign from "@/models/Campaign";
import CampaignLink from "@/models/CampaignLink";
import Message from "@/models/Message";

// Every kind a contact gets: a test email goes to the addresses typed for it and is no contact's, even read as one.
export const CONTACT_EMAIL_KINDS = ["campaign", "welcome", "confirmation", "last-chance"];
const FIELDS = {
	kind: 1,
	campaignId: 1,
	status: 1,
	error: 1,
	sentAt: 1,
	deliveredAt: 1,
	openedAt: 1,
	clickedAt: 1,
	clickedLinks: 1,
	bouncedAt: 1,
	complainedAt: 1,
	createdAt: 1,
};

// How many of a contact's emails went out, and how many of those it opened and clicked. Its own counters can't say:
// an import adds the opens and clicks of the previous platform to them.
export async function countContactEmails(account, contact) {
	const [counts] = await Message.aggregate([
		{ $match: scoped(account, { contactId: contact._id, sentAt: { $ne: null } }) },
		{
			$group: {
				_id: null,
				sent: { $sum: 1 },
				opened: { $sum: { $cond: [{ $ifNull: ["$openedAt", false] }, 1, 0] } },
				clicked: { $sum: { $cond: [{ $ifNull: ["$clickedAt", false] }, 1, 0] } },
			},
		},
	]);
	return { sent: counts?.sent ?? 0, opened: counts?.opened ?? 0, clicked: counts?.clicked ?? 0 };
}

// A contact's emails, newest first, with their issue's subject as written, what each came to (lib/email-outcome.js) and
// the links they clicked in it (models/CampaignLink.js). before: the ID of the previous page's last email. nextCursor:
// this page's, when there's another.
export async function listContactEmails(account, contact, { limit, before = null }) {
	const messages = await Message.find(scoped(account, { contactId: contact._id, ...(before && { _id: { $lt: before } }) }))
		.sort({ _id: -1 })
		.limit(limit + 1)
		.select(FIELDS)
		.lean();
	const page = messages.slice(0, limit);
	const issues = page.filter(({ kind, campaignId }) => kind === "campaign" && campaignId);
	const clicked = issues.filter(({ clickedLinks }) => clickedLinks?.length > 0);
	const [campaigns, links] = await Promise.all([
		issues.length > 0
			? Campaign.find(scoped(account, { _id: { $in: issues.map(({ campaignId }) => campaignId) } }))
					.select({ subject: 1 })
					.lean()
			: [],
		clicked.length > 0
			? CampaignLink.find(
					scoped(account, {
						campaignId: { $in: clicked.map(({ campaignId }) => campaignId) },
						key: { $in: clicked.flatMap(({ clickedLinks }) => clickedLinks) },
					})
				)
					.select({ campaignId: 1, key: 1, url: 1 })
					.lean()
			: [],
	]);
	const subjects = new Map(campaigns.map(({ _id, subject }) => [String(_id), subject]));
	const urls = new Map(links.map(({ campaignId, key, url }) => [`${campaignId}:${key}`, url]));

	return {
		emails: page.map((message) => {
			const campaignId = message.kind === "campaign" && message.campaignId ? String(message.campaignId) : null;
			return {
				id: String(message._id),
				kind: message.kind,
				campaign: campaignId && { id: campaignId, subject: subjects.get(campaignId) ?? null },
				status: message.status,
				outcome: getEmailOutcome(message),
				sentAt: message.sentAt ?? null,
				deliveredAt: message.deliveredAt ?? null,
				openedAt: message.openedAt ?? null,
				clickedAt: message.clickedAt ?? null,
				bouncedAt: message.bouncedAt ?? null,
				complainedAt: message.complainedAt ?? null,
				clickedLinks: campaignId ? (message.clickedLinks ?? []).map((key) => urls.get(`${campaignId}:${key}`)).filter(Boolean) : [],
				createdAt: message.createdAt,
			};
		}),
		nextCursor: messages.length > limit ? String(page.at(-1)._id) : null,
	};
}
