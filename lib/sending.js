import "server-only";
import { and, asc, count, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { sendAlert } from "./alerts.js";
import { assignArchiveSlug } from "./archive-slugs.js";
import { buildAudienceQuery } from "./audience-query.js";
import { CLEANUP_FIELDS, addToPreview, emptyPreview, getCleanupSettings, splitAudience } from "./cleanup.js";
import { LIMITS, isSendingEnabled } from "./config.js";
import { getConfirmUrl } from "./confirmation.js";
import { getConfirmationContent } from "./confirmation-content.js";
import { getDb } from "./db.js";
import { sendEmail } from "./email.js";
import { getKeepUrl } from "./last-chance.js";
import { getLastChanceContent } from "./last-chance-content.js";
import { mailboxProvider } from "./providers.js";
import { campaignIncrements, contactIncrements, toCampaign, toContact, toRecord } from "./rows.js";
import { campaigns, contacts, messages, newsletters, suppressions } from "./schema.js";
import {
	CAMPAIGN_MESSAGE_KINDS,
	MAX_BATCH_MESSAGES,
	MAX_CONSECUTIVE_FAILURES,
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
} from "./sending-rules.js";
import { isIdString, normalizeEmail } from "./validation.js";

export { buildRecipientEmail } from "./sending-rules.js";

const QUEUEABLE_STATUSES = ["draft", "scheduled", "paused"];
const INSERT_CHUNK_SIZE = 1000;
const SEND_INTERVAL_MS = Math.ceil(1000 / LIMITS.sendRatePerSecond);
const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_KINDS = ["welcome", "confirmation"];
// Their links have to work, so they go out clean: no tracking pixel or redirect.
const UNTRACKED_KINDS = new Set(["confirmation", "last-chance"]);
// Signing up again resends the confirmation, but a script can't make us mail an address over and over.
const MAX_CONFIRMATIONS_PER_CONTACT = 3;

let nextSendAt = 0;

function db() {
	return getDb();
}

function assertSendingEnabled() {
	if (!isSendingEnabled()) throw new Error("Sending is off");
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
	const { providerMessageId } = await sendEmail({
		...email,
		headers: { ...email.headers, "Feedback-ID": feedbackId },
		tags: getMessageTags(message),
		idempotencyKey: String(message._id),
	});
	return { providerMessageId, sentAt: new Date() };
}

function getMessageContent({ kind, newsletter, campaign }) {
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "confirmation") return newsletter ? getConfirmationContent(newsletter) : null;
	if (kind === "last-chance") return newsletter ? getLastChanceContent(newsletter) : null;
	return campaign;
}

async function findCampaign(campaignId) {
	const [row] = await db().select().from(campaigns).where(eq(campaigns._id, campaignId));
	return toCampaign(row);
}

async function findNewsletter(newsletterId) {
	const [row] = await db().select().from(newsletters).where(eq(newsletters._id, newsletterId));
	return toRecord(row);
}

async function isSuppressed(email) {
	const rows = await db().select({ _id: suppressions._id }).from(suppressions).where(eq(suppressions.email, email)).limit(1);
	return rows.length > 0;
}

async function countMessages(where) {
	const [{ value }] = await db().select({ value: count() }).from(messages).where(where);
	return value;
}

// Welcome and confirmation emails share one cap per newsletter, so a signup flood can't burn its sending
// domain's reputation, and a flood on one newsletter doesn't hold up the others' signup emails.
function countRecentSignupEmails(newsletter) {
	return countMessages(
		and(
			inArray(messages.kind, SIGNUP_KINDS),
			eq(messages.newsletterId, newsletter._id),
			gte(messages.createdAt, new Date(Date.now() - WELCOME_WINDOW_MS))
		)
	);
}

async function alertSignupCap(newsletter) {
	await sendAlert({
		key: `welcome-cap:${newsletter.slug}`,
		title: "Signup emails capped",
		detail: `Over ${LIMITS.welcomeEmailsPer10Minutes} welcome and confirmation emails for ${newsletter.name} in 10 minutes. New signups get none until it slows down.`,
		path: "/contacts",
	});
}

async function findByIds(table, ids, toObject) {
	const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
	if (uniqueIds.length === 0) return new Map();
	const rows = await db().select().from(table).where(inArray(table._id, uniqueIds));
	return new Map(rows.map((row) => [String(row._id), toObject(row)]));
}

async function pauseCampaign(campaignId, reason) {
	const paused = await db()
		.update(campaigns)
		.set({ status: "paused" })
		.where(and(eq(campaigns._id, campaignId), eq(campaigns.status, "sending")))
		.returning({ _id: campaigns._id });
	if (paused.length === 0) return;
	await sendAlert({
		key: `campaign-paused-${campaignId}`,
		title: "Campaign paused",
		detail: reason,
		path: `/campaigns/${campaignId}`,
		cooldownMinutes: 1,
	});
}

async function pauseIfUnhealthy(campaignId) {
	const [row] = await db()
		.select()
		.from(campaigns)
		.where(and(eq(campaigns._id, campaignId), eq(campaigns.status, "sending")));
	const campaign = toCampaign(row);
	const reason = campaign ? getCampaignPauseReason(campaign.stats, campaign.lastChance) : null;
	if (reason) await pauseCampaign(campaignId, `${reason} is over the limit`);
	return Boolean(reason);
}

function hasQueuedMessages(campaignId) {
	return db()
		.select({ _id: messages._id })
		.from(messages)
		.where(
			and(eq(messages.campaignId, campaignId), inArray(messages.kind, CAMPAIGN_MESSAGE_KINDS), eq(messages.status, "queued"))
		)
		.limit(1)
		.then((rows) => rows.length > 0);
}

export async function settleCampaign(campaignId) {
	if (await pauseIfUnhealthy(campaignId)) return;
	if (await hasQueuedMessages(campaignId)) return;
	// A campaign sent in steps keeps the date of its first step. LEAST skips NULL, like MongoDB's $min.
	await db()
		.update(campaigns)
		.set({ status: "sent", sentAt: sql`least(${campaigns.sentAt}, now())` })
		.where(and(eq(campaigns._id, campaignId), eq(campaigns.status, "sending")));
}

// The partial unique indexes keep one email per contact per campaign: a retried insert skips them.
async function insertIgnoringDuplicates(rows) {
	if (rows.length === 0) return;
	await db().insert(messages).values(rows).onConflictDoNothing();
}

function toMessages(campaign, kind, contactList) {
	return contactList.map((contact) => ({
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
	const rows = await db()
		.select({ contactId: messages.contactId, kind: messages.kind })
		.from(messages)
		.where(and(eq(messages.campaignId, campaignId), inArray(messages.kind, CAMPAIGN_MESSAGE_KINDS)));
	return new Map(rows.map(({ contactId, kind }) => [String(contactId), kind]));
}

// The ids are read in one ordered pass, then the details a chunk at a time: making contacts dormant
// on the way can't shift the walk the way an OFFSET would.
async function* walkAudience(ids, fields) {
	const columns = Object.fromEntries(["_id", ...fields].map((field) => [field, contacts[field]]));
	for (const group of chunk(ids, INSERT_CHUNK_SIZE)) {
		const rows = await db().select(columns).from(contacts).where(inArray(contacts._id, group));
		const byId = new Map(rows.map((row) => [row._id, toContact(row)]));
		yield group.map((id) => byId.get(id)).filter(Boolean);
	}
}

// Active, unsuppressed contacts, most engaged first. With the list cleanup on, the limit counts issue
// recipients only, so it's applied while walking (lib/cleanup.js splitAudience).
async function findAudience({ campaign, settings, audienceLimit }) {
	const { where, orderBy, limit } = buildAudienceQuery({ newsletterId: campaign.newsletterId, audienceLimit });
	let query = db().select({ _id: contacts._id }).from(contacts).where(where).orderBy(...orderBy);
	if (limit && !settings.enabled) query = query.limit(limit);
	const ids = (await query).map(({ _id }) => _id);
	const previous = settings.enabled ? await findPreviousMessages(campaign._id) : new Map();
	return { groups: walkAudience(ids, settings.enabled ? CLEANUP_FIELDS : ["email"]), limit, previous };
}

async function makeDormant(campaignId, contactList) {
	if (contactList.length === 0) return;
	// A sign of life since the walk read them sets ignoredIssues back to 0: those contacts stay.
	const dormant = await db()
		.update(contacts)
		.set({ status: "dormant" })
		.where(
			and(
				inArray(
					contacts._id,
					contactList.map(({ _id }) => _id)
				),
				eq(contacts.status, "active"),
				gt(contacts.ignoredIssues, 0)
			)
		)
		.returning({ _id: contacts._id });
	if (dormant.length > 0) {
		await db()
			.update(campaigns)
			.set(campaignIncrements({ "lastChance.dormant": dormant.length }))
			.where(eq(campaigns._id, campaignId));
	}
}

async function insertCampaignMessages(campaign, newsletter) {
	const settings = getCleanupSettings(newsletter);
	const { groups, limit, previous } = await findAudience({ campaign, settings, audienceLimit: campaign.audienceLimit });
	const now = Date.now();
	let remaining = limit ?? Infinity;
	for await (const group of groups) {
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
	if (!isIdString(String(campaignId))) throw new Error("Campaign not found");
	const campaign = await findCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await findNewsletter(campaign.newsletterId);
	const settings = getCleanupSettings(newsletter);
	if (!settings.enabled) return { enabled: false };

	const { groups, previous } = await findAudience({ campaign, settings });
	const preview = emptyPreview();
	const now = Date.now();
	for await (const group of groups) addToPreview(preview, group, { settings, previous, now });
	return { enabled: true, ...preview };
}

async function countCampaignMessages(campaignId) {
	const rows = await db()
		.select({ kind: messages.kind, value: count() })
		.from(messages)
		.where(and(eq(messages.campaignId, campaignId), inArray(messages.kind, CAMPAIGN_MESSAGE_KINDS)))
		.groupBy(messages.kind);
	const counts = new Map(rows.map(({ kind, value }) => [kind, value]));
	return CAMPAIGN_MESSAGE_KINDS.map((kind) => counts.get(kind) ?? 0);
}

// Draft or scheduled: selects the audience. Paused: resumes with the audience it already has. The
// queued messages go out through the sender function (lib/sender.js), which a caller wakes up.
export async function queueCampaign(campaignId) {
	assertSendingEnabled();
	if (!isIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await findCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	if (!QUEUEABLE_STATUSES.includes(campaign.status)) {
		throw new Error(`Campaign is already ${campaign.status}`);
	}
	const newsletter = await findNewsletter(campaign.newsletterId);
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	if (campaign.status !== "paused") await insertCampaignMessages(campaign, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients + lastChances === 0) throw new Error("No active contacts to send to");

	const started = await db()
		.update(campaigns)
		.set({
			status: "sending",
			statsRecipients: recipients,
			lastChanceRecipients: lastChances,
			startedAt: sql`least(${campaigns.startedAt}, now())`,
		})
		.where(and(eq(campaigns._id, campaign._id), eq(campaigns.status, campaign.status)))
		.returning({ _id: campaigns._id });
	if (started.length === 0) throw new Error("The campaign changed, refresh and try again");

	try {
		await assignArchiveSlug({ campaign, newsletter });
		const queued = await hasQueuedMessages(campaign._id);
		if (!queued) await settleCampaign(campaign._id);
		return { recipients, queued };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the campaign, it is paused: ${formatError(error)}`);
	}
}

// Sending in steps: a sent campaign goes to the next most engaged contacts. It takes the top of the
// audience again and the one-email-per-contact index skips everyone who already received it.
export async function sendToMoreContacts(campaignId, additional) {
	assertSendingEnabled();
	if (!isIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await findCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	if (campaign.status !== "sent") throw new Error("Wait until the current step has gone out");
	const newsletter = await findNewsletter(campaign.newsletterId);
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	const [sentSoFar, lastChancesSoFar] = await countCampaignMessages(campaign._id);
	const audienceLimit = getNextStepLimit({ sentSoFar, additional });
	await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients === sentSoFar && lastChances === lastChancesSoFar) throw new Error("Everyone has received it already");

	const started = await db()
		.update(campaigns)
		.set({
			status: "sending",
			statsRecipients: recipients,
			lastChanceRecipients: lastChances,
			audienceLimit: audienceLimit ?? null,
		})
		.where(and(eq(campaigns._id, campaign._id), eq(campaigns.status, "sent")))
		.returning({ _id: campaigns._id });
	if (started.length === 0) throw new Error("The campaign changed, refresh and try again");

	try {
		const queued = await hasQueuedMessages(campaign._id);
		if (!queued) await settleCampaign(campaign._id);
		return { added: recipients - sentSoFar, recipients, queued };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the next step, the campaign is paused: ${formatError(error)}`);
	}
}

// Every issue counts toward the list cleanup until a sign of life sets the count back (lib/cleanup.js).
async function recordSent({ message, campaign, contact, providerMessageId, sentAt }) {
	await db().update(messages).set({ providerMessageId, sentAt, error: null }).where(eq(messages._id, message._id));
	const statsPath = getCampaignStatsPath(message.kind);
	await Promise.all([
		campaign &&
			db()
				.update(campaigns)
				.set(campaignIncrements({ [`${statsPath}.sent`]: 1 }))
				.where(eq(campaigns._id, campaign._id)),
		db()
			.update(contacts)
			.set({
				lastSentAt: sentAt,
				...(message.kind === "last-chance" && { lastChanceAt: sentAt }),
				...contactIncrements({ "stats.sent": 1 }),
				...(message.kind === "campaign" && { ignoredIssues: sql`coalesce(${contacts.ignoredIssues}, 0) + 1` }),
			})
			.where(eq(contacts._id, contact._id)),
	]);
}

async function recordFailed({ message, campaign, error }) {
	await db().update(messages).set({ status: "failed", error: formatError(error) }).where(eq(messages._id, message._id));
	if (campaign) {
		await db()
			.update(campaigns)
			.set(campaignIncrements({ [`${getCampaignStatsPath(message.kind)}.failed`]: 1 }))
			.where(eq(campaigns._id, campaign._id));
	}
}

function setQueuedStatus(messageId, status, set = {}) {
	return db()
		.update(messages)
		.set({ status, ...set })
		.where(and(eq(messages._id, messageId), eq(messages.status, "queued")))
		.returning({ _id: messages._id });
}

function isCampaignSending(campaignId) {
	return db()
		.select({ _id: campaigns._id })
		.from(campaigns)
		.where(and(eq(campaigns._id, campaignId), eq(campaigns.status, "sending")))
		.limit(1)
		.then((rows) => rows.length > 0);
}

// At most once per message: the queued -> sent claim happens before SES is called.
export async function sendMessageBatch(messageIds) {
	assertSendingEnabled();
	const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id).toLowerCase()))]
		.filter(isIdString)
		.slice(0, MAX_BATCH_MESSAGES);
	const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, retry: false };
	if (ids.length === 0) return result;

	const order = new Map(ids.map((id, index) => [id, index]));
	const queued = (
		await db()
			.select()
			.from(messages)
			.where(
				and(
					inArray(messages._id, ids),
					eq(messages.status, "queued"),
					inArray(messages.kind, [...CAMPAIGN_MESSAGE_KINDS, ...SIGNUP_KINDS])
				)
			)
	)
		.map(toRecord)
		.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
	result.skipped = ids.length - queued.length;
	if (queued.length === 0) return result;

	const [campaignMap, newsletterMap, contactMap, suppressedRows] = await Promise.all([
		findByIds(campaigns, queued.map(({ campaignId }) => campaignId), toCampaign),
		findByIds(newsletters, queued.map(({ newsletterId }) => newsletterId), toRecord),
		findByIds(contacts, queued.map(({ contactId }) => contactId), toContact),
		db()
			.select({ email: suppressions.email })
			.from(suppressions)
			.where(inArray(suppressions.email, queued.map(({ email }) => email))),
	]);
	const suppressed = new Set(suppressedRows.map(({ email }) => email));
	for (const campaignId of campaignMap.keys()) await pauseIfUnhealthy(campaignId);

	let consecutiveFailures = 0;
	for (const message of queued) {
		if (!isSendingEnabled()) {
			result.retry = true;
			break;
		}
		const campaign = campaignMap.get(String(message.campaignId)) ?? null;
		const isSending = !CAMPAIGN_MESSAGE_KINDS.includes(message.kind) || (await isCampaignSending(message.campaignId));
		if (!isSending) {
			result.skipped++;
			continue;
		}

		const contact = contactMap.get(String(message.contactId));
		const requiredStatus = message.kind === "confirmation" ? "pending" : "active";
		if (contact?.status !== requiredStatus || suppressed.has(message.email)) {
			await setQueuedStatus(message._id, "suppressed");
			result.suppressed++;
			continue;
		}

		const claim = await setQueuedStatus(message._id, "sent", { provider: mailboxProvider(message.email) });
		if (claim.length === 0) {
			result.skipped++;
			continue;
		}

		const newsletter = newsletterMap.get(String(message.newsletterId));
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
			await db()
				.update(messages)
				.set({ status: "queued" })
				.where(and(eq(messages._id, message._id), eq(messages.status, "sent")));
			if (action === "pause") await pauseCampaign(campaign._id, formatError(error));
			else result.retry = true;
			break;
		}

		await recordSent({ message, campaign, contact, ...delivery });
		result.sent++;
		consecutiveFailures = 0;
	}

	for (const campaignId of campaignMap.keys()) await settleCampaign(campaignId);
	return result;
}

// The next batch the sender function sends: issues first, last-chance emails after everyone else, and
// the campaign that started first before the others.
export async function findNextQueuedBatch(size) {
	const rows = await db()
		.select({ _id: messages._id })
		.from(messages)
		.innerJoin(campaigns, eq(campaigns._id, messages.campaignId))
		.where(
			and(eq(messages.status, "queued"), inArray(messages.kind, CAMPAIGN_MESSAGE_KINDS), eq(campaigns.status, "sending"))
		)
		.orderBy(asc(campaigns.startedAt), asc(messages.campaignId), asc(messages.kind), asc(messages._id))
		.limit(size);
	return rows.map(({ _id }) => _id);
}

async function createMessage(values) {
	const [row] = await db().insert(messages).values(values).returning();
	return toRecord(row);
}

async function sendTest({ content, newsletter, campaignId, to }) {
	const email = normalizeEmail(to);
	if (!email) throw new Error("The test email address is invalid");
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) throw new Error(problem);

	const message = await createMessage({
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

	const { providerMessageId, sentAt } = delivery;
	await db().update(messages).set({ status: "sent", providerMessageId, sentAt }).where(eq(messages._id, message._id));
	return { messageId: String(message._id), providerMessageId, sentAt };
}

export async function sendTestEmail({ campaignId, to }) {
	assertSendingEnabled();
	if (!isIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await findCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await findNewsletter(campaign.newsletterId);
	const result = await sendTest({ content: campaign, newsletter, campaignId: campaign._id, to });
	await db().update(campaigns).set({ testSentAt: result.sentAt }).where(eq(campaigns._id, campaign._id));
	return result;
}

// Sends the saved welcome email, whether or not it's switched on yet.
export async function sendWelcomeTestEmail({ newsletterId, to }) {
	assertSendingEnabled();
	if (!isIdString(String(newsletterId))) throw new Error("Newsletter not found");

	const newsletter = await findNewsletter(newsletterId);
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

	const [suppressedAddress, welcomes, recentWelcomes] = await Promise.all([
		isSuppressed(contact.email),
		countMessages(and(eq(messages.kind, "welcome"), eq(messages.contactId, contact._id))),
		countRecentSignupEmails(newsletter),
	]);
	if (suppressedAddress) return { skipped: "suppressed" };
	if (welcomes > 0) return { skipped: "already sent" };
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

	const sentToThem = and(eq(messages.kind, "confirmation"), eq(messages.contactId, contact._id));
	const [suppressedAddress, sentToContact, sentRecently, recentSignupEmails] = await Promise.all([
		isSuppressed(contact.email),
		countMessages(sentToThem),
		countMessages(and(sentToThem, gte(messages.createdAt, new Date(Date.now() - WELCOME_WINDOW_MS)))),
		countRecentSignupEmails(newsletter),
	]);
	if (suppressedAddress) return { skipped: "suppressed" };
	if (sentRecently > 0 || sentToContact >= MAX_CONFIRMATIONS_PER_CONTACT) return { skipped: "already sent" };
	if (recentSignupEmails >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	return sendSignupEmail({ kind: "confirmation", newsletter, contact });
}

async function sendSignupEmail({ kind, newsletter, contact }) {
	const message = await createMessage({
		kind,
		newsletterId: newsletter._id,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	});
	return { messageId: String(message._id), ...(await sendMessageBatch([String(message._id)])) };
}
