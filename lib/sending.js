import "server-only";
import { Client } from "@upstash/qstash";
import { isLocalQueue } from "@/lib/job-rules";
import { enqueueJobs } from "@/lib/jobs";
import { sendAlert } from "@/lib/alerts";
import { assignArchiveSlug } from "@/lib/archive-slugs";
import { buildAudienceQuery } from "@/lib/audience";
import { CLEANUP_FIELDS, addToPreview, emptyPreview, getCleanupSettings, splitAudience } from "@/lib/cleanup";
import { LIMITS, getAppUrl, isSendingEnabled } from "@/lib/config";
import { getConfirmUrl } from "@/lib/confirmation";
import { getConfirmationContent } from "@/lib/confirmation-content";
import { connectDb } from "@/lib/db";
import { getKeepUrl } from "@/lib/last-chance";
import { getLastChanceContent } from "@/lib/last-chance-content";
import { mailboxProvider } from "@/lib/providers";
import { sendSesEmail } from "@/lib/ses";
import {
	CAMPAIGN_MESSAGE_KINDS,
	MAX_BATCH_MESSAGES,
	MAX_CONSECUTIVE_FAILURES,
	SEND_BATCH_SIZE,
	TEST_CONTACT_ID,
	buildRecipientEmail,
	chunk,
	getCampaignPauseReason,
	getCampaignStatsPath,
	getFeedbackId,
	getNextStepLimit,
	getSendErrorAction,
	getSendProblem,
	getWelcomeContent,
} from "@/lib/sending-rules";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

export { buildRecipientEmail } from "@/lib/sending-rules";

const QUEUEABLE_STATUSES = ["draft", "scheduled", "paused"];
const INSERT_CHUNK_SIZE = 1000;
const PUBLISH_CHUNK_SIZE = 100;
const SEND_INTERVAL_MS = Math.ceil(1000 / LIMITS.sendRatePerSecond);
const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_KINDS = ["welcome", "confirmation"];
// Their links have to work, so they go out clean: no tracking pixel or redirect.
const UNTRACKED_KINDS = new Set(["confirmation", "last-chance"]);
// Signing up again resends the confirmation, but a script can't make us mail an address over and over.
const MAX_CONFIRMATIONS_PER_CONTACT = 3;

let qstash;
let nextSendAt = 0;

function assertSendingEnabled() {
	if (!isSendingEnabled()) throw new Error("Sending is off");
}

export function getQStash() {
	if (!process.env.QSTASH_TOKEN) throw new Error("QStash is not configured (QSTASH_TOKEN)");
	qstash ??= new Client({ token: process.env.QSTASH_TOKEN });
	return qstash;
}

// QStash on Vercel; the local job queue (JOB_QUEUE=local) on servers that run all the time.
function assertQueueConfigured() {
	if (!isLocalQueue() && !process.env.QSTASH_TOKEN) {
		throw new Error("No job queue: set JOB_QUEUE=local, or configure QStash (QSTASH_TOKEN)");
	}
}

function formatError(error) {
	return String(error?.message || error).slice(0, 500);
}

// Slots are reserved synchronously, so concurrent sends in one instance share the rate.
async function waitForSendSlot() {
	const now = Date.now();
	const sendAt = Math.max(now, nextSendAt);
	nextSendAt = sendAt + SEND_INTERVAL_MS;
	if (sendAt > now) await new Promise((resolve) => setTimeout(resolve, sendAt - now));
}

function getMessageTags(message) {
	const tags = [
		{ name: "message_id", value: String(message._id) },
		{ name: "kind", value: message.kind },
	];
	if (message.campaignId) tags.push({ name: "campaign_id", value: String(message.campaignId) });
	return tags;
}

async function deliver({ message, content, newsletter, contact }) {
	const reference = { contactId: contact._id, newsletterId: newsletter._id };
	const email = buildRecipientEmail({
		campaign: content,
		newsletter,
		contact,
		messageId: UNTRACKED_KINDS.has(message.kind) ? null : message._id,
		confirmUrl: message.kind === "confirmation" ? getConfirmUrl(reference) : "",
		keepUrl: message.kind === "last-chance" ? getKeepUrl(reference) : "",
	});
	const feedbackId = getFeedbackId({
		campaignId: message.campaignId,
		kind: message.kind,
		newsletterSlug: newsletter.slug,
	});
	await waitForSendSlot();
	const { sesMessageId } = await sendSesEmail({
		...email,
		headers: { ...email.headers, "Feedback-ID": feedbackId },
		tags: getMessageTags(message),
	});
	return { sesMessageId, sentAt: new Date() };
}

function getMessageContent({ kind, newsletter, campaign }) {
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "confirmation") return newsletter ? getConfirmationContent(newsletter) : null;
	if (kind === "last-chance") return newsletter ? getLastChanceContent(newsletter) : null;
	return campaign;
}

// Welcome and confirmation emails share one cap per newsletter, so a signup flood can't burn its sending
// domain's reputation, and a flood on one newsletter doesn't hold up the others' signup emails.
function countRecentSignupEmails(newsletter) {
	return Message.countDocuments({
		kind: { $in: SIGNUP_KINDS },
		newsletterId: newsletter._id,
		createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
	});
}

async function alertSignupCap(newsletter) {
	await sendAlert({
		key: `welcome-cap:${newsletter.slug}`,
		title: "Signup emails capped",
		detail: `Over ${LIMITS.welcomeEmailsPer10Minutes} welcome and confirmation emails for ${newsletter.name} in 10 minutes. New signups get none until it slows down.`,
		path: "/contacts",
	});
}

async function findByIds(Model, ids) {
	const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
	if (uniqueIds.length === 0) return new Map();
	const documents = await Model.find({ _id: { $in: uniqueIds } }).lean();
	return new Map(documents.map((document) => [String(document._id), document]));
}

async function pauseCampaign(campaignId, reason) {
	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaignId, status: "sending" },
		{ $set: { status: "paused" } }
	);
	if (!modifiedCount) return;
	await sendAlert({
		key: `campaign-paused-${campaignId}`,
		title: "Campaign paused",
		detail: reason,
		path: `/campaigns/${campaignId}`,
		cooldownMinutes: 1,
	});
}

async function pauseIfUnhealthy(campaignId) {
	const campaign = await Campaign.findOne({ _id: campaignId, status: "sending" })
		.select("stats lastChance")
		.lean();
	const reason = campaign ? getCampaignPauseReason(campaign.stats, campaign.lastChance) : null;
	if (reason) await pauseCampaign(campaignId, `${reason} is over the limit`);
	return Boolean(reason);
}

async function settleCampaign(campaignId) {
	if (await pauseIfUnhealthy(campaignId)) return;
	if (await Message.exists({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: "queued" })) return;
	// A campaign sent in steps keeps the date of its first step.
	await Campaign.updateOne({ _id: campaignId, status: "sending" }, { $set: { status: "sent" }, $min: { sentAt: new Date() } });
}

async function insertIgnoringDuplicates(messages) {
	if (messages.length === 0) return;
	try {
		await Message.insertMany(messages, { ordered: false });
	} catch (error) {
		// Mongoose copies the driver's WriteErrors, which keeps the code on `err`.
		const codes = (error?.writeErrors ?? []).map(({ err, code }) => err?.code ?? code);
		const isOnlyDuplicates =
			codes.length > 0 ? codes.every((code) => code === 11000) : error?.code === 11000;
		if (!isOnlyDuplicates) throw error;
	}
}

async function* inChunks(items, size) {
	let pending = [];
	for await (const item of items) {
		pending.push(item);
		if (pending.length === size) {
			yield pending;
			pending = [];
		}
	}
	if (pending.length > 0) yield pending;
}

function toMessages(campaign, kind, contacts) {
	return contacts.map((contact) => ({
		kind,
		campaignId: campaign._id,
		newsletterId: campaign.newsletterId,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	}));
}

// Contacts this campaign already reached: an earlier step, or an attempt that stopped halfway.
async function findPreviousMessages(campaignId) {
	const messages = await Message.find({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS } })
		.select({ _id: 0, contactId: 1, kind: 1 })
		.lean();
	return new Map(messages.map(({ contactId, kind }) => [String(contactId), kind]));
}

// Active, unsuppressed contacts, most engaged first. With the list cleanup on, the limit counts issue
// recipients only, so it's applied while walking (lib/cleanup.js splitAudience).
async function findAudience({ campaign, settings, audienceLimit }) {
	const suppressedEmails = await Suppression.distinct("email");
	const { filter, sort, limit } = buildAudienceQuery({ newsletterId: campaign.newsletterId, suppressedEmails, audienceLimit });
	const query = Contact.find(filter).sort(sort).select(settings.enabled ? CLEANUP_FIELDS : { email: 1 }).lean();
	if (limit && !settings.enabled) query.limit(limit);
	const previous = settings.enabled ? await findPreviousMessages(campaign._id) : new Map();
	return { contacts: query.cursor(), limit, previous };
}

async function makeDormant(campaignId, contacts) {
	if (contacts.length === 0) return;
	// A sign of life since the walk read them sets ignoredIssues back to 0: those contacts stay.
	const { modifiedCount } = await Contact.updateMany(
		{ _id: { $in: contacts.map(({ _id }) => _id) }, status: "active", ignoredIssues: { $gt: 0 } },
		{ $set: { status: "dormant" } }
	);
	if (modifiedCount > 0) {
		await Campaign.updateOne({ _id: campaignId }, { $inc: { "lastChance.dormant": modifiedCount } });
	}
}

async function insertCampaignMessages(campaign, newsletter) {
	const settings = getCleanupSettings(newsletter);
	const { contacts, limit, previous } = await findAudience({ campaign, settings, audienceLimit: campaign.audienceLimit });
	const now = Date.now();
	let remaining = limit ?? Infinity;
	for await (const group of inChunks(contacts, INSERT_CHUNK_SIZE)) {
		const split = splitAudience(group, { settings, limit: remaining, previous, now });
		await insertIgnoringDuplicates(toMessages(campaign, "campaign", split.issue));
		await insertIgnoringDuplicates(toMessages(campaign, "last-chance", split.lastChance));
		await makeDormant(campaign._id, split.dormant);
		remaining -= split.issue.length + split.received;
		if (remaining <= 0) break;
	}
}

// What the list cleanup would do at this send, for the send dialogs: one walk over the whole list.
export async function getCleanupPreview(campaignId) {
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");
	await connectDb();
	const campaign = await Campaign.findById(campaignId).select({ newsletterId: 1 }).lean();
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await Newsletter.findById(campaign.newsletterId).select({ slug: 1, cleanup: 1 }).lean();
	const settings = getCleanupSettings(newsletter);
	if (!settings.enabled) return { enabled: false };

	const { contacts, previous } = await findAudience({ campaign, settings });
	const preview = emptyPreview();
	const now = Date.now();
	for await (const group of inChunks(contacts, INSERT_CHUNK_SIZE)) addToPreview(preview, group, { settings, previous, now });
	return { enabled: true, ...preview };
}

function countCampaignMessages(campaignId) {
	return Promise.all(CAMPAIGN_MESSAGE_KINDS.map((kind) => Message.countDocuments({ campaignId, kind })));
}

// Issues first; last-chance emails go to the least engaged addresses, after everyone else.
async function publishQueuedMessages(campaignId) {
	const queued = await Message.find({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: "queued" })
		.sort({ kind: 1, _id: 1 })
		.select({ _id: 1 })
		.lean();
	const url = `${getAppUrl()}/api/jobs/send-batch`;
	// One batch at a time per campaign; each batch spaces its own sends at sendRatePerSecond.
	const flowControl = {
		key: `campaign-${campaignId}`,
		parallelism: 1,
		rate: 1,
		period: `${Math.ceil(SEND_BATCH_SIZE / LIMITS.sendRatePerSecond)}s`,
	};
	const requests = chunk(
		queued.map(({ _id }) => String(_id)),
		SEND_BATCH_SIZE
	).map((messageIds) => ({ url, body: { messageIds }, flowControl }));

	if (isLocalQueue()) {
		return enqueueJobs(requests.map(({ body }) => ({ kind: "send-batch", payload: body })));
	}

	for (const group of chunk(requests, PUBLISH_CHUNK_SIZE)) await getQStash().batchJSON(group);
	return requests.length;
}

// Draft or scheduled: selects the audience. Paused: resumes with the audience it already has.
export async function queueCampaign(campaignId) {
	assertSendingEnabled();
	assertQueueConfigured();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	if (!QUEUEABLE_STATUSES.includes(campaign.status)) {
		throw new Error(`Campaign is already ${campaign.status}`);
	}
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	if (campaign.status !== "paused") await insertCampaignMessages(campaign, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients + lastChances === 0) throw new Error("No active contacts to send to");

	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaign._id, status: campaign.status },
		{
			$set: { status: "sending", "stats.recipients": recipients, "lastChance.recipients": lastChances },
			$min: { startedAt: new Date() },
		}
	);
	if (!modifiedCount) throw new Error("The campaign changed, refresh and try again");

	try {
		await assignArchiveSlug({ campaign, newsletter });
		const batches = await publishQueuedMessages(campaign._id);
		if (batches === 0) await settleCampaign(campaign._id);
		return { recipients, batches };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the campaign, it is paused: ${formatError(error)}`);
	}
}

// Sending in steps: a sent campaign goes to the next most engaged contacts. It takes the top of the
// audience again and the one-email-per-contact index skips everyone who already received it.
export async function sendToMoreContacts(campaignId, additional) {
	assertSendingEnabled();
	assertQueueConfigured();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	if (campaign.status !== "sent") throw new Error("Wait until the current step has gone out");
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	const [sentSoFar, lastChancesSoFar] = await countCampaignMessages(campaign._id);
	const audienceLimit = getNextStepLimit({ sentSoFar, additional });
	await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients === sentSoFar && lastChances === lastChancesSoFar) throw new Error("Everyone has received it already");

	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaign._id, status: "sent" },
		{
			$set: {
				status: "sending",
				"stats.recipients": recipients,
				"lastChance.recipients": lastChances,
				...(audienceLimit && { audienceLimit }),
			},
			...(!audienceLimit && { $unset: { audienceLimit: 1 } }),
		}
	);
	if (!modifiedCount) throw new Error("The campaign changed, refresh and try again");

	try {
		const batches = await publishQueuedMessages(campaign._id);
		if (batches === 0) await settleCampaign(campaign._id);
		return { added: recipients - sentSoFar, recipients, batches };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the next step, the campaign is paused: ${formatError(error)}`);
	}
}

// Every issue counts toward the list cleanup until a sign of life sets the count back (lib/cleanup.js).
async function recordSent({ message, campaign, contact, sesMessageId, sentAt }) {
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { sesMessageId, sentAt }, $unset: { error: 1 } }
	);
	const statsPath = getCampaignStatsPath(message.kind);
	await Promise.all([
		campaign && Campaign.updateOne({ _id: campaign._id }, { $inc: { [`${statsPath}.sent`]: 1 } }),
		Contact.updateOne(
			{ _id: contact._id },
			{
				$set: { lastSentAt: sentAt, ...(message.kind === "last-chance" && { lastChanceAt: sentAt }) },
				$inc: { "stats.sent": 1, ...(message.kind === "campaign" && { ignoredIssues: 1 }) },
			}
		),
	]);
}

async function recordFailed({ message, campaign, error }) {
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { status: "failed", error: formatError(error) } }
	);
	if (campaign) {
		await Campaign.updateOne({ _id: campaign._id }, { $inc: { [`${getCampaignStatsPath(message.kind)}.failed`]: 1 } });
	}
}

// At most once per message: the queued -> sent claim happens before SES is called.
export async function sendMessageBatch(messageIds) {
	assertSendingEnabled();
	const ids = [
		...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id).toLowerCase())),
	]
		.filter(isObjectIdString)
		.slice(0, MAX_BATCH_MESSAGES);
	const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, retry: false };
	if (ids.length === 0) return result;

	await connectDb();
	const order = new Map(ids.map((id, index) => [id, index]));
	const messages = (
		await Message.find({
			_id: { $in: ids },
			status: "queued",
			kind: { $in: [...CAMPAIGN_MESSAGE_KINDS, ...SIGNUP_KINDS] },
		}).lean()
	).sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
	result.skipped = ids.length - messages.length;
	if (messages.length === 0) return result;

	const [campaigns, newsletters, contacts, suppressedEmails] = await Promise.all([
		findByIds(Campaign, messages.map(({ campaignId }) => campaignId)),
		findByIds(Newsletter, messages.map(({ newsletterId }) => newsletterId)),
		findByIds(Contact, messages.map(({ contactId }) => contactId)),
		Suppression.distinct("email", { email: { $in: messages.map(({ email }) => email) } }),
	]);
	const suppressed = new Set(suppressedEmails);
	for (const campaignId of campaigns.keys()) await pauseIfUnhealthy(campaignId);

	let consecutiveFailures = 0;
	for (const message of messages) {
		if (!isSendingEnabled()) {
			result.retry = true;
			break;
		}
		const campaign = campaigns.get(String(message.campaignId)) ?? null;
		const isCampaignSending =
			!CAMPAIGN_MESSAGE_KINDS.includes(message.kind) ||
			(await Campaign.exists({ _id: message.campaignId, status: "sending" }));
		if (!isCampaignSending) {
			result.skipped++;
			continue;
		}

		const contact = contacts.get(String(message.contactId));
		const requiredStatus = message.kind === "confirmation" ? "pending" : "active";
		if (contact?.status !== requiredStatus || suppressed.has(message.email)) {
			await Message.updateOne(
				{ _id: message._id, status: "queued" },
				{ $set: { status: "suppressed" } }
			);
			result.suppressed++;
			continue;
		}

		const claim = await Message.updateOne(
			{ _id: message._id, status: "queued" },
			{ $set: { status: "sent", provider: mailboxProvider(message.email) } }
		);
		if (!claim.modifiedCount) {
			result.skipped++;
			continue;
		}

		const newsletter = newsletters.get(String(message.newsletterId));
		const content = getMessageContent({ kind: message.kind, newsletter, campaign });
		let delivery;
		try {
			if (!newsletter || !content) throw new Error("Newsletter or email content not found");
			delivery = await deliver({ message, content, newsletter, contact });
		} catch (error) {
			const action = campaign ? getSendErrorAction(error) : "fail";
			if (action === "fail") {
				await recordFailed({ message, campaign, error });
				result.failed++;
				consecutiveFailures++;
				if (!campaign || consecutiveFailures < MAX_CONSECUTIVE_FAILURES) continue;
				await pauseCampaign(campaign._id, `${consecutiveFailures} sends failed in a row`);
				break;
			}
			await Message.updateOne({ _id: message._id, status: "sent" }, { $set: { status: "queued" } });
			if (action === "pause") await pauseCampaign(campaign._id, formatError(error));
			else result.retry = true;
			break;
		}

		await recordSent({ message, campaign, contact, ...delivery });
		result.sent++;
		consecutiveFailures = 0;
	}

	for (const campaignId of campaigns.keys()) await settleCampaign(campaignId);
	return result;
}

async function sendTest({ content, newsletter, campaignId, to }) {
	const email = normalizeEmail(to);
	if (!email) throw new Error("The test email address is invalid");
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) throw new Error(problem);

	const message = await Message.create({
		kind: "test",
		campaignId,
		newsletterId: newsletter._id,
		email,
		provider: mailboxProvider(email),
	});
	let delivery;
	try {
		delivery = await deliver({
			message,
			content: { ...content, subject: `[Test] ${content.subject}` },
			newsletter,
			contact: { _id: TEST_CONTACT_ID, email },
		});
	} catch (error) {
		await recordFailed({ message, campaign: null, error });
		throw error;
	}

	const { sesMessageId, sentAt } = delivery;
	await Message.updateOne({ _id: message._id }, { $set: { status: "sent", sesMessageId, sentAt } });
	return { messageId: String(message._id), sesMessageId, sentAt };
}

export async function sendTestEmail({ campaignId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const result = await sendTest({ content: campaign, newsletter, campaignId: campaign._id, to });
	await Campaign.updateOne({ _id: campaign._id }, { $set: { testSentAt: result.sentAt } });
	return result;
}

// Sends the saved welcome email, whether or not it's switched on yet.
export async function sendWelcomeTestEmail({ newsletterId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(newsletterId))) throw new Error("Newsletter not found");

	await connectDb();
	const newsletter = await Newsletter.findById(newsletterId).lean();
	if (!newsletter) throw new Error("Newsletter not found");
	const content = getWelcomeContent({ welcome: { ...newsletter.welcome, enabled: true } });
	if (!content) throw new Error("Save a subject and content first");
	return sendTest({ content, newsletter, to });
}

export async function queueWelcomeEmail({ newsletter, contact }) {
	assertSendingEnabled();
	const content = getWelcomeContent(newsletter);
	if (!content) return { skipped: "welcome email is off" };
	if (contact?.status !== "active") return { skipped: "contact is not active" };

	await connectDb();
	const [isSuppressed, hasWelcome, recentWelcomes] = await Promise.all([
		Suppression.exists({ email: contact.email }),
		Message.exists({ kind: "welcome", contactId: contact._id }),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (hasWelcome) return { skipped: "already sent" };
	if (recentWelcomes >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) {
		console.warn(`[sending] Welcome email for ${newsletter.slug} not sent: ${problem}`);
		return { skipped: problem };
	}
	return sendSignupEmail({ kind: "welcome", newsletter, contact });
}

export async function queueConfirmationEmail({ newsletter, contact }) {
	assertSendingEnabled();
	if (contact?.status !== "pending") return { skipped: "contact is not pending" };

	await connectDb();
	const [isSuppressed, sentToContact, sentRecently, recentSignupEmails] = await Promise.all([
		Suppression.exists({ email: contact.email }),
		Message.countDocuments({ kind: "confirmation", contactId: contact._id }),
		Message.exists({
			kind: "confirmation",
			contactId: contact._id,
			createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
		}),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (sentRecently || sentToContact >= MAX_CONFIRMATIONS_PER_CONTACT) return { skipped: "already sent" };
	if (recentSignupEmails >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	return sendSignupEmail({ kind: "confirmation", newsletter, contact });
}

async function sendSignupEmail({ kind, newsletter, contact }) {
	const message = await Message.create({
		kind,
		newsletterId: newsletter._id,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	});
	return { messageId: String(message._id), ...(await sendMessageBatch([String(message._id)])) };
}
