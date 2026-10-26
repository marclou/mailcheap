import "server-only";
import { scoped } from "@/lib/account-scope";
import { actionError } from "@/lib/actions/errors";
import { getAppUrl, isSmsConfigured, isSendingEnabled } from "@/lib/config";
import { publishJob } from "@/lib/sending";
import { sendSms } from "@/lib/sms";
import { replaceUrlsWithShortLinks } from "@/lib/sms-links";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

export const SMS_BATCH_SIZE = 50;
const MESSAGES_PER_SECOND = 10;
const DELAY_MS = Math.floor(1000 / MESSAGES_PER_SECOND);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(array, size) {
	const chunks = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

// Counts eligible active contacts with a verified phone who haven't opted out.
export async function countSmsRecipients({ account, newsletterId, segmentId = null }) {
	const filter = {
		newsletterId,
		smsStatus: "active",
		phone: { $exists: true, $ne: null },
	};
	if (segmentId) filter.segmentId = segmentId;

	const contacts = await Contact.find(scoped(account, filter)).select({ phone: 1 }).lean();
	if (contacts.length === 0) return 0;

	const phones = contacts.map((c) => c.phone).filter(Boolean);
	const suppressed = new Set(
		(
			await Suppression.find(scoped(account, { targetType: "phone", phone: { $in: phones } }))
				.select({ phone: 1 })
				.lean()
		).map((s) => s.phone)
	);

	return phones.filter((p) => !suppressed.has(p)).length;
}

// Queues an SMS campaign for dispatch.
export async function queueSmsCampaign({ account, campaign, newsletter }) {
	if (!isSmsConfigured()) {
		throw actionError("send_check_failed", "AWS SNS credentials are not configured on this server");
	}

	const filter = {
		newsletterId: campaign.newsletterId,
		smsStatus: "active",
		phone: { $exists: true, $ne: null },
	};
	if (campaign.segmentId) filter.segmentId = campaign.segmentId;

	const contacts = await Contact.find(scoped(account, filter))
		.select({ _id: 1, phone: 1 })
		.lean();

	const phones = contacts.map((c) => c.phone).filter(Boolean);
	const suppressed = new Set(
		(
			await Suppression.find(scoped(account, { targetType: "phone", phone: { $in: phones } }))
				.select({ phone: 1 })
				.lean()
		).map((s) => s.phone)
	);

	const eligible = contacts.filter((c) => c.phone && !suppressed.has(c.phone));
	const recipientCount = eligible.length;
	if (recipientCount === 0) {
		throw actionError("validation_failed", "There are no active phone subscribers to send to");
	}

	const now = new Date();
	await Campaign.updateOne(
		scoped(account, { _id: campaign._id }),
		{
			$set: {
				status: "sending",
				startedAt: now,
				"stats.recipients": recipientCount,
			},
			$unset: { pauseReason: 1, pauseCode: 1, scheduledAt: 1 },
		}
	);

	const batches = chunk(eligible.map((c) => String(c._id)), SMS_BATCH_SIZE);
	const accountId = String(account._id);
	const campaignId = String(campaign._id);

	let enqueuedViaQStash = false;
	try {
		for (const contactIds of batches) {
			await publishJob({
				url: `${getAppUrl()}/api/jobs/sms-batch`,
				body: { accountId, campaignId, contactIds },
			});
		}
		enqueuedViaQStash = true;
	} catch {
		// If QStash is not configured (e.g. self-hosted local or test mode), process immediately
		for (const contactIds of batches) {
			await processSmsBatch({ accountId, campaignId, contactIds });
		}
	}

	return {
		recipients: recipientCount,
		batches: batches.length,
		enqueuedViaQStash,
	};
}

// Processes a single batch of SMS recipients.
export async function processSmsBatch({ accountId, campaignId, contactIds }) {
	const account = await Account.findById(accountId).lean();
	if (!account) throw new Error("Account not found");

	const campaign = await Campaign.findOne(scoped(account, { _id: campaignId }));
	if (!campaign || campaign.status !== "sending") {
		return { skipped: true, reason: "Campaign is not in sending status" };
	}

	const contacts = await Contact.find(
		scoped(account, {
			_id: { $in: contactIds },
			smsStatus: "active",
			phone: { $exists: true, $ne: null },
		})
	);

	const suppressed = new Set(
		(
			await Suppression.find(scoped(account, { targetType: "phone", phone: { $in: contacts.map((c) => c.phone) } }))
				.select({ phone: 1 })
				.lean()
		).map((s) => s.phone)
	);

	let sentCount = 0;
	let failedCount = 0;

	for (const contact of contacts) {
		if (suppressed.has(contact.phone)) continue;

		const body = preparedText.replace(/\{\{\s*first_name\s*\}\}/gi, contact.firstName || "");

		try {
			await sendSms({
				phoneNumber: contact.phone,
				message: body,
				messageType: "Promotional",
			});

			await Contact.updateOne(
				{ _id: contact._id },
				{ $set: { lastSmsSentAt: new Date() }, $inc: { "stats.sent": 1 } }
			);
			sentCount++;
		} catch (error) {
			console.error(`[sms-send] Failed to send to ${contact.phone}:`, error.message);
			failedCount++;
		}

		await sleep(DELAY_MS);
	}

	await Campaign.updateOne(
		{ _id: campaign._id },
		{ $inc: { "stats.sent": sentCount, "stats.delivered": sentCount, "stats.failed": failedCount } }
	);

	// Check if this finished the campaign
	const updated = await Campaign.findById(campaignId).select({ stats: 1 }).lean();
	if (updated && updated.stats.sent + updated.stats.failed >= updated.stats.recipients) {
		const now = new Date();
		await Campaign.updateOne(
			{ _id: campaign._id },
			{ $set: { status: "sent", sentAt: now, finishedAt: now } }
		);
	}

	return { sent: sentCount, failed: failedCount };
}
