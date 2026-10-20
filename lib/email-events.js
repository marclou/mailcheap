import "server-only";
import mongoose from "mongoose";
import { blockAccount } from "@/lib/account-blocks";
import { checkAccountHealth } from "@/lib/account-health";
import { isBlocked } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { withEngagement } from "@/lib/cleanup";
import { connectDb } from "@/lib/db";
import { getEventPlan, getTrackingPlan } from "@/lib/email-event-rules";
import { suppressGlobally } from "@/lib/global-suppressions";
import { getLinkKey, isSystemLink, normalizeLink } from "@/lib/link-stats";
import { CAMPAIGN_MESSAGE_KINDS, getCampaignStatsPath } from "@/lib/sending-rules";
import { isLikelyScanner } from "@/lib/tracking";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";
import CampaignLink from "@/models/CampaignLink";
import Contact from "@/models/Contact";
import Event from "@/models/Event";
import Message from "@/models/Message";
import Suppression from "@/models/Suppression";

const SUBSCRIBED_STATUSES = ["active", "dormant"];
const SPAM_TRAP_REASON = "An email reached a spam trap, an address found only on bought, scraped or old lists";

// Every email carries its account in a tag or unique arg, so an event only ever looks inside that account.
// The message id covers events that arrive before providerMessageId is saved.
async function findMessage({ accountId, providerMessageId, messageId }) {
	if (!accountId) return null;
	if (providerMessageId) {
		const message = await Message.findOne({ accountId, providerMessageId }).lean();
		if (message) return message;
	}
	if (!messageId) return null;

	const message = await Message.findOne({ accountId, _id: messageId }).lean();
	if (!message) return null;
	if (message.providerMessageId && providerMessageId && message.providerMessageId !== providerMessageId) return null;
	if (!message.providerMessageId && providerMessageId) {
		await Message.updateOne({ accountId, _id: message._id, providerMessageId: null }, { $set: { providerMessageId } });
	}
	return message;
}

// Each counter moves only on the first transition, so redelivered events are harmless.
async function applyMessageUpdates(message, plan) {
	const { accountId } = message;
	const campaignInc = {};
	const contactInc = {};
	const statsPath = getCampaignStatsPath(message.kind);

	for (const { field, stat, contactStat } of plan.firsts) {
		const { matchedCount } = await Message.updateOne(
			{ accountId, _id: message._id, [field]: null },
			{ $set: { [field]: plan.occurredAt } }
		);
		if (!matchedCount) continue;
		if (stat) campaignInc[`${statsPath}.${stat}`] = 1;
		if (contactStat) contactInc[`stats.${contactStat}`] = 1;
	}

	if (plan.status) {
		const { matchedCount } = await Message.updateOne(
			{ accountId, _id: message._id, status: { $in: plan.status.from } },
			{ $set: { status: plan.status.to } }
		);
		if (matchedCount && plan.status.stat) campaignInc[`${statsPath}.${plan.status.stat}`] = 1;
	}

	if (plan.error) {
		await Message.updateOne({ accountId, _id: message._id }, { $set: { error: plan.error.slice(0, 500) } });
	}

	const updates = [];
	if (CAMPAIGN_MESSAGE_KINDS.includes(message.kind) && message.campaignId && Object.keys(campaignInc).length > 0) {
		updates.push(Campaign.updateOne({ accountId, _id: message.campaignId }, { $inc: campaignInc }));
	}
	if (message.contactId && (plan.engagement || Object.keys(contactInc).length > 0)) {
		const update = {
			...(plan.engagement && { $max: plan.engagement }),
			...(Object.keys(contactInc).length > 0 && { $inc: contactInc }),
		};
		updates.push(
			Contact.updateOne(
				{ accountId, _id: message.contactId },
				plan.engagement ? withEngagement(update, plan.occurredAt) : update
			)
		);
	}
	await Promise.all(updates);
}

// The address is never emailed again by this account, from any of its newsletters.
async function suppress({ accountId, emails, reason, detail, contactStatus, contactStatusFrom }) {
	if (emails.length === 0) return;
	await Promise.all(
		emails.map((email) =>
			Suppression.updateOne(
				{ accountId, email },
				// A complaint outranks an earlier bounce or manual suppression.
				reason === "complaint"
					? { $set: { reason, detail } }
					: { $setOnInsert: { reason, detail } },
				{ upsert: true }
			)
		)
	);
	if (!contactStatus) return;
	await Contact.updateMany(
		{ accountId, email: { $in: emails }, status: { $in: contactStatusFrom } },
		{ $set: { status: contactStatus } }
	);
}

// The provider suppresses the address for the whole tenant, so every newsletter of the account loses it.
async function unsubscribe({ accountId, email, message }) {
	if (!email) return;
	const { modifiedCount } = await Contact.updateMany(
		{ accountId, email, status: { $in: SUBSCRIBED_STATUSES } },
		{ $set: { status: "unsubscribed", unsubscribedAt: new Date() } }
	);
	if (modifiedCount > 0 && message?.kind === "campaign" && message.campaignId) {
		await Campaign.updateOne({ accountId, _id: message.campaignId }, { $inc: { "stats.unsubscribed": 1 } });
	}
}

// The message a tracking link names, whatever its account, with that account's status: one query, both by _id.
// Null when either is gone.
export async function findTrackedMessage(messageId) {
	await connectDb();
	const [message] = await Message.aggregate([
		{ $match: { _id: new mongoose.Types.ObjectId(String(messageId)) } },
		{ $project: { accountId: 1, kind: 1, campaignId: 1, contactId: 1, sentAt: 1 } },
		{
			$lookup: {
				from: Account.collection.collectionName,
				localField: "accountId",
				foreignField: "_id",
				pipeline: [{ $project: { status: 1 } }],
				as: "account",
			},
		},
		{ $unwind: "$account" },
	]).option({ crossAccount: true });
	return message ?? null;
}

// MailCheap's own open pixel and click links update messages the way provider events do. A blocked account's
// opens and clicks don't count.
export async function recordEngagement({ message, type, userAgent, url }) {
	if (!message || isBlocked(message.account)) return;
	if (type === "Click" && isLikelyScanner({ userAgent, sentAt: message.sentAt })) return;
	await applyMessageUpdates(message, getTrackingPlan(type));
	if (type === "Click" && url) await recordLinkClick(message, url);
}

// The issue's clicks per link: every click, and its reader once per link and once per issue. The message keeps the links
// its reader clicked, and the first time one is added says whether the click is the reader's first on it.
async function recordLinkClick(message, href) {
	if (message.kind !== "campaign" || !message.campaignId) return;
	const url = normalizeLink(href);
	if (!url || isSystemLink(url)) return;
	const { accountId, campaignId } = message;
	const key = getLinkKey(url);
	const before = await Message.findOneAndUpdate(
		{ accountId, _id: message._id, clickedLinks: { $ne: key } },
		{ $push: { clickedLinks: key } },
		{ projection: { clickedLinks: 1 } }
	).lean();
	await Promise.all([
		CampaignLink.updateOne(
			{ accountId, campaignId, key },
			{ $inc: { clicks: 1, clickers: before ? 1 : 0 }, $setOnInsert: { url } },
			{ upsert: true }
		),
		before && !before.clickedLinks?.length
			? Campaign.updateOne({ accountId, _id: campaignId }, { $inc: { "links.clickers": 1 } })
			: null,
	]);
}

async function recordEvent({ accountId, plan, message }) {
	try {
		await Event.create({
			accountId,
			type: plan.type,
			providerMessageId: plan.providerMessageId,
			...(plan.providerEventId && { providerEventId: plan.providerEventId }),
			messageId: message?._id,
			campaignId: message?.campaignId,
			email: plan.email ?? message?.email,
			occurredAt: plan.occurredAt,
			data: plan.data,
		});
	} catch (error) {
		// The same event delivered twice keeps its first record.
		if (error?.code !== 11000) throw error;
	}
}

// One normalized event (lib/email-event-rules.js), only ever inside the account it names. Without a known
// message, it only shows in the logs, unless isAccountTrusted: the provider named the account itself
// (its tenant), so its suppressions and unsubscribes still apply there.
export async function handleEmailEvent(event, { isAccountTrusted = false } = {}) {
	const plan = getEventPlan(event);
	if (!plan) return { handled: false };

	await connectDb();
	const message = await findMessage(plan);
	// An ObjectId either way: the account check aggregates, and aggregation stages don't cast strings.
	const accountId = message?.accountId ?? (isAccountTrusted && plan.accountId ? new mongoose.Types.ObjectId(String(plan.accountId)) : null);
	if (!accountId) {
		if (plan.suppression || plan.unsubscribe) {
			console.warn(`[email-events] ${plan.type} for an unknown message (${plan.providerMessageId ?? "no id"})`);
		}
		return { handled: true, messageId: null };
	}

	if (message) await applyMessageUpdates(message, plan);
	if (plan.suppression) await suppress({ accountId, ...plan.suppression });
	// Every account skips these, so only the address of an email MailCheap sent: an account's events never list another.
	if (message && plan.globalSuppression) {
		const { emails, ...listing } = plan.globalSuppression;
		await suppressGlobally({ ...listing, emails: emails.filter((email) => email === message.email), at: plan.occurredAt });
	}
	if (plan.unsubscribe) await unsubscribe({ accountId, email: plan.email, message });
	// The trap's address and the server's words go to the admins only.
	if (plan.isSpamTrap) {
		const detail = `${plan.email ?? message?.email ?? "An address"} bounced: ${plan.error}`.slice(0, 300);
		await blockAccount(accountId, { reason: SPAM_TRAP_REASON, by: "trap", detail });
	}
	// Complaints are few, so each one is counted at once instead of waiting for the next check.
	if (plan.suppression) await checkAccountHealth(accountId, { isUrgent: plan.suppression.reason === "complaint" });
	if (plan.suppression?.reason === "complaint") {
		await sendAlert({
			accountId,
			key: "complaints",
			title: "Spam complaint",
			detail: `${plan.suppression.emails.join(", ")} marked an email as spam. Contacts are suppressed.`,
			path: message?.campaignId ? `/campaigns/${message.campaignId}` : "",
		});
	}
	if (plan.isRecorded) await recordEvent({ accountId, plan, message });
	return { handled: true, messageId: message ? String(message._id) : null };
}
