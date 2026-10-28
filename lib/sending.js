import "server-only";
import { Client } from "@upstash/qstash";
import { BLOCKED_CAMPAIGN_REASON, blockAccount } from "@/lib/account-blocks";
import {
	ACCESS_FIELDS,
	ERROR_CODES,
	codedError,
	getAccountSendProblem,
	getPlanLimitProblem,
	getWelcomePauseNotice,
	hasActiveSubscription,
	isBlocked,
} from "@/lib/account-state";
import { countRecentAlerts, sendAlert } from "@/lib/alerts";
import { getLinkBaseUrl } from "@/lib/archive-hosts";
import { assignArchiveSlug } from "@/lib/archive-slugs";
import { buildAudienceQuery } from "@/lib/audience";
import {
	CLEANUP_FIELDS,
	addToPreview,
	emptyPreview,
	getCleanupSettings,
	splitAudience,
	summarizePreview,
} from "@/lib/cleanup";
import { FIRST_SEND, LIMITS, getAppUrl, isCloud, isSendingEnabled } from "@/lib/config";
import { getConfirmUrl } from "@/lib/confirmation";
import { getConfirmationContent } from "@/lib/confirmation-content";
import { reviewBeforeSend } from "@/lib/content-review";
import { REJECTED_PAUSE_REASON, REVIEW_CODES, REVIEW_PAUSE_CODE, REVIEW_PAUSE_REASON } from "@/lib/content-review-codes";
import { connectDb } from "@/lib/db";
import { getEmailProvider } from "@/lib/email-provider";
import { SEND_OUTCOMES } from "@/lib/email-provider/outcomes";
import { getFirstSendProblem, getFirstSendSteps } from "@/lib/first-send";
import { formatNumber } from "@/lib/format";
import { UNDELIVERABLE_MESSAGE, findGloballySuppressed, markUndeliverable } from "@/lib/global-suppressions";
import { getKeepUrl } from "@/lib/last-chance";
import { getLastChanceContent } from "@/lib/last-chance-content";
import { SAMPLE_FIRST_NAME } from "@/lib/merge-tags";
import { getNewsletterPagePath } from "@/lib/newsletters";
import { PLANS, getAccountLimits, getSignupScale } from "@/lib/plans";
import { mailboxProvider } from "@/lib/providers";
import { isRateLimited } from "@/lib/rate-limit";
import { findCampaignSegmentFilter } from "@/lib/segment-queries";
import { waitForSendSlot } from "@/lib/send-rate";
import { SEND_BATCH_SIZE, getGmailBatchStarts, getSenderMs, getSenderPace } from "@/lib/send-spread";
import { createSenderCache, loadSender } from "@/lib/sender";
import { getCampaignSenderVolumes, startSenderWarmup } from "@/lib/sender-warmup";
import { reviewSignupEmail } from "@/lib/signup-email-review";
import {
	CAMPAIGN_MESSAGE_KINDS,
	MAX_BATCH_MESSAGES,
	MAX_CONSECUTIVE_FAILURES,
	TEST_CONTACT_ID,
	buildRecipientEmail,
	chunk,
	getCampaignRateProblem,
	getCampaignStatsPath,
	getFeedbackId,
	getNextStepLimit,
	getPublishProblem,
	getSendErrorAction,
	getSendProblem,
	getWelcomeContent,
} from "@/lib/sending-rules";
import { sendsEmail } from "@/lib/publish-to";
import { moveContacts } from "@/lib/status-changes";
import { blockAccountForHold } from "@/lib/tenant-events";
import { ensureTenant } from "@/lib/tenants";
import {
	addEmailsSent,
	claimPlanEmails,
	claimWelcomePausedNotice,
	countActiveContacts,
	countEmailsInFlight,
	rollUsagePeriod,
} from "@/lib/usage";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

export { buildRecipientEmail } from "@/lib/sending-rules";

const QUEUEABLE_STATUSES = ["draft", "scheduled", "paused"];
const WAITING_STATUSES = ["queued", "held"];
const FIRST_SEND_PAUSE_CODE = "first_send_slice";
const RATES_PAUSE_CODE = "high_rates";
const RATE_LIMIT_PAUSE_CODE = "rate_limited";
// Resuming from one of these pauses is the owner accepting the rates: only the block level stops the send then.
const RATE_PAUSE_CODES = new Set([FIRST_SEND_PAUSE_CODE, RATES_PAUSE_CODE]);
const INSERT_CHUNK_SIZE = 1000;
const PUBLISH_CHUNK_SIZE = 100;
const MINUTE_MS = 60_000;
// QStash may deliver a batch a little before its notBefore.
const SEND_AFTER_SKEW_MS = MINUTE_MS;
const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_KINDS = ["welcome", "confirmation"];
// They take room in the plan's month before they go out. Confirmation emails always go out, so signups never break.
const PLAN_KINDS = new Set([...CAMPAIGN_MESSAGE_KINDS, "welcome"]);
const WELCOME_PAUSED_REASON = "This month's emails are used up";
const WELCOME_HELD_REASON = "The welcome email is in review";
// Their links have to work, so they go out clean: no tracking pixel or redirect.
const UNTRACKED_KINDS = new Set(["confirmation", "last-chance"]);
// Signing up again resends the confirmation, but a script can't make us mail an address over and over.
const MAX_CONFIRMATIONS_PER_CONTACT = 3;
// When the provider is full and says nothing more precise.
const DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 3600;
// Why a send stopped halfway; it resumes from the campaign's page once the reason is gone.
const PAUSE_REASONS = {
	[ERROR_CODES.subscriptionRequired]: "the account has no active plan",
	[ERROR_CODES.accountBlocked]: BLOCKED_CAMPAIGN_REASON,
	[ERROR_CODES.planLimitEmails]: "this month's emails are used up",
};
// The provider refusing MailCheap's own setup, not the account's: a key, a cluster, a credential or its approval.
const SETUP_OUTCOMES = new Set([SEND_OUTCOMES.misconfigured, SEND_OUTCOMES.approvalPending]);
// An account's own login refused may be the provider's blip: its batch goes again later, twice within the hour, and
// the third refusal pauses the campaign.
const CREDENTIAL_RETRIES = { name: "credential-refused", limit: 2, window: "1 h" };
// Accounts whose logins the provider refused within the hour: from this many, it's the provider, not one account.
const REFUSED_ACCOUNTS = 2;

let qstash;

// Codes from lib/actions/errors.js, so the API and MCP can tell these apart.
function fail(code, message) {
	return codedError({ code, message });
}

function assertSendingEnabled() {
	if (!isSendingEnabled()) throw fail("sending_disabled", "Sending is off");
}

export function getQStash() {
	if (!process.env.QSTASH_TOKEN) throw fail("unavailable", "QStash is not configured (QSTASH_TOKEN)");
	qstash ??= new Client({ token: process.env.QSTASH_TOKEN });
	return qstash;
}

function formatError(error) {
	return String(error?.message || error).slice(0, 500);
}

// QStash refusing a job (its token, its quota) stops every send, schedule and purge until it's fixed.
async function publishWith(publish) {
	const client = getQStash();
	try {
		return await publish(client);
	} catch (error) {
		await sendAlert({
			accountId: null,
			key: "qstash-refused",
			title: "QStash refused a job",
			detail: `${formatError(error)}.`,
			action: "Sends, schedules and purges can't start until it's fixed: check QSTASH_TOKEN and the plan's quota.",
			link: "https://console.upstash.com/qstash",
		});
		throw error;
	}
}

export function publishJob(request) {
	return publishWith((client) => client.publishJSON(request));
}

// One account's own login refused only shows on the admin page, unless another account's was refused within the
// hour: then the provider is refusing MailCheap, and the admins hear of it.
async function alertCredentialRefused(accountId, error, action) {
	const provider = getEmailProvider();
	await sendAlert({
		accountId: null,
		key: `credential-refused:${accountId}`,
		title: `${provider.name} refused an account's login`,
		detail: `Account ${accountId}: ${formatError(error)}.`,
		action:
			action === "pause"
				? "Its campaign paused on a third refusal within the hour: its owner can resume it."
				: "Its campaign tries again in a few minutes, and pauses on a third refusal within the hour.",
	});
	const accounts = await countRecentAlerts("credential-refused", 60);
	if (accounts < REFUSED_ACCOUNTS) return;
	await sendAlert({
		accountId: null,
		key: `send-refused:${error.outcome}`,
		title: `${provider.name} refuses MailCheap's sends`,
		detail: `It refused the logins of ${accounts} accounts within the hour, account ${accountId} last: ${formatError(error)}.`,
		action: `Their campaigns try again, then pause on a third refusal within the hour: check ${provider.name}'s status, or ask its support.`,
		...(provider.id === "postshiba" && { link: "https://app.postshiba.com" }),
	});
}

// What a failed send does (lib/sending-rules.js), except that an account's login refused twice within the hour already
// pauses its campaign instead of going again.
async function getSendAction(accountId, error) {
	const action = getSendErrorAction(error);
	if (error?.outcome !== SEND_OUTCOMES.credentialRefused) return action;
	return (await isRateLimited({ ...CREDENTIAL_RETRIES, key: String(accountId) })) ? "pause" : action;
}

// No account can fix these, nor SES suspending the whole AWS account, so the admins hear of them.
async function alertSendRefused(accountId, error, action) {
	if (error?.outcome === SEND_OUTCOMES.credentialRefused) return alertCredentialRefused(accountId, error, action);
	if (!SETUP_OUTCOMES.has(error?.outcome) && error?.name !== "AccountSuspendedException") return;
	const provider = getEmailProvider();
	await sendAlert({
		accountId: null,
		key: `send-refused:${error.outcome ?? error.name}`,
		title: `${provider.name} refuses MailCheap's sends`,
		detail: `Account ${accountId}: ${formatError(error)}.`,
		action:
			error.outcome === SEND_OUTCOMES.approvalPending
				? `Readers' emails are refused until ${provider.name} approves the team.`
				: `Campaigns pause and signup emails fail until it's fixed at ${provider.name}: its key, clusters or credentials.`,
		...(provider.id === "postshiba" && { link: "https://app.postshiba.com" }),
		...(provider.id === "groundmail" && { link: "https://app.groundmail.dev" }),
	});
}

// A from address the account can't use, or a check the email itself fails (lib/sending-rules.js).
function sendProblemError(problem, sender) {
	return fail(problem === sender?.problem ? "sender_not_allowed" : "send_check_failed", problem);
}

function senderNotAllowed(problem) {
	return Object.assign(new Error(problem), { name: "SenderNotAllowed" });
}

// Each batch or test reads the account's tenant once, creating it if the plan started without one.
function createTenantLoader(account) {
	let tenant;
	return () => (tenant ??= ensureTenant(account));
}

// sender: the from address checked against the account's domains (lib/sender.js), for every kind of email.
// The email goes through the account's tenant at the email provider (lib/email-provider). contactFields: the sending
// account's own, the only fields its emails print.
async function deliver({ message, content, newsletter, contact, contactFields, sender, getTenant }) {
	if (sender.problem) throw senderNotAllowed(sender.problem);
	const provider = getEmailProvider();
	const tenant = await getTenant();
	const reference = { contactId: contact._id, newsletterId: newsletter._id };
	const baseUrl = getLinkBaseUrl(newsletter);
	const createdAt = new Date(message.createdAt ?? Date.now()).getTime();
	const email = buildRecipientEmail({
		campaign: content,
		newsletter,
		contact,
		contactFields,
		sender,
		messageId: UNTRACKED_KINDS.has(message.kind) ? null : message._id,
		confirmUrl: message.kind === "confirmation" ? getConfirmUrl(reference, baseUrl, createdAt) : "",
		keepUrl: message.kind === "last-chance" ? getKeepUrl(reference, baseUrl, createdAt) : "",
	});
	const feedbackId = getFeedbackId({
		campaignId: message.campaignId,
		newsletterId: newsletter._id,
		accountId: message.accountId,
		kind: message.kind,
	});
	await waitForSendSlot(provider.getSendLane(message.kind));
	const { providerMessageId } = await provider.sendEmail({ tenant, message, email, feedbackId });
	return { providerMessageId, sentAt: new Date() };
}

// isHeld: the content check holds the newsletter's own confirmation email, so the built-in one goes out.
function getMessageContent({ kind, newsletter, campaign, isHeld = false }) {
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "confirmation") return newsletter ? getConfirmationContent(newsletter, { builtIn: isHeld }) : null;
	if (kind === "last-chance") return newsletter ? getLastChanceContent(newsletter) : null;
	return campaign;
}

// Welcome and confirmation emails share one cap per newsletter, so a signup flood can't burn its sending
// domain's reputation, and a flood on one newsletter doesn't hold up the others' signup emails. Welcome emails
// skipped for want of room never went out, so they don't hold up confirmation emails either.
function countRecentSignupEmails(newsletter) {
	return Message.countDocuments({
		accountId: newsletter.accountId,
		kind: { $in: SIGNUP_KINDS },
		newsletterId: newsletter._id,
		status: { $ne: "skipped" },
		createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
	});
}

async function alertSignupCap(newsletter, { cap, canGrow }) {
	await sendAlert({
		accountId: newsletter.accountId,
		key: `welcome-cap:${newsletter.slug}`,
		title: "Signup emails capped",
		detail: `Over ${formatNumber(cap)} welcome and confirmation emails for ${newsletter.name} in 10 minutes. New signups get none until it slows down.${canGrow ? " Bigger plans send more." : ""}`,
		path: getNewsletterPagePath(newsletter._id, "/contacts"),
	});
}

async function findByIds(Model, accountId, ids, select = null) {
	const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
	if (uniqueIds.length === 0) return new Map();
	const query = Model.find({ accountId, _id: { $in: uniqueIds } });
	const documents = await (select ? query.select(select) : query).lean();
	return new Map(documents.map((document) => [String(document._id), document]));
}

// The newsletters' own welcome and confirmation emails among these messages that the content check holds
// (lib/signup-email-review.js), checked now if their content never was: "<newsletter id>:<kind>".
async function findHeldSignupEmails(account, messages, newsletters) {
	const pairs = new Set(messages.filter(({ kind }) => SIGNUP_KINDS.includes(kind)).map(({ newsletterId, kind }) => `${newsletterId}:${kind}`));
	const held = new Set();
	for (const pair of pairs) {
		const [newsletterId, kind] = pair.split(":");
		const newsletter = newsletters.get(newsletterId);
		if (newsletter && (await reviewSignupEmail({ account, newsletter, kind })).held) held.add(pair);
	}
	return held;
}

async function findAccount(accountId) {
	const account = isObjectIdString(String(accountId)) ? await Account.findById(accountId).lean() : null;
	if (!account) throw fail("not_found", "Account not found");
	return account;
}

// isQuiet: the account's block that comes with it already tells the owner.
async function pauseCampaign({ accountId, campaignId, reason, code, isQuiet = false }) {
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId, _id: campaignId, status: "sending" },
		{ $set: { status: "paused", pauseReason: reason, ...(code && { pauseCode: code }) }, ...(!code && { $unset: { pauseCode: 1 } }) }
	);
	if (!modifiedCount || isQuiet) return;
	await sendAlert({
		accountId,
		key: `campaign-paused-${campaignId}`,
		title: "Campaign paused",
		detail: reason,
		path: `/campaigns/${campaignId}`,
		cooldownMinutes: 1,
	});
}

// Gmail's spam rate for the account between the pause and block levels (lib/postmaster.js): its sends pause as a send
// over the pause level does, and one its owner resumed from such a pause goes on until the block level.
export async function pauseSendingCampaigns(accountId, reason) {
	await connectDb();
	const campaigns = await Campaign.find({ accountId, status: "sending", ratesAcceptedAt: null }).select({ _id: 1 }).lean();
	for (const { _id } of campaigns) await pauseCampaign({ accountId, campaignId: _id, reason, code: RATES_PAUSE_CODE });
	return campaigns.map(({ _id }) => String(_id));
}

// Gmail rate limiting a domain (lib/send-backoff.js): the sends still going out from it, of all the newsletters sending
// from it, pause, and each goes on by itself at resumeAt (resumeRateLimited), at the pace Gmail's readers get from then.
export async function pauseRateLimitedSends({ accountId, newsletterIds, reason, resumeAt }) {
	await connectDb();
	const campaigns = await Campaign.find({ accountId, newsletterId: { $in: newsletterIds }, status: "sending" }).select({ _id: 1 }).lean();
	for (const { _id } of campaigns) {
		await pauseCampaign({ accountId, campaignId: _id, reason, code: RATE_LIMIT_PAUSE_CODE });
		await publishJob({
			url: `${getAppUrl()}/api/jobs/resume-send`,
			body: { accountId: String(accountId), campaignId: String(_id) },
			notBefore: Math.floor(resumeAt.getTime() / 1000),
		});
	}
	return campaigns.map(({ _id }) => String(_id));
}

// Runs when QStash delivers it: a send a rate limit paused goes on, unless its owner resumed or canceled it since. One
// that can't (the account blocked, the month's emails used up) stays paused and says why, for its owner to resume.
export async function resumeRateLimited({ accountId, campaignId }) {
	if (!isObjectIdString(String(accountId)) || !isObjectIdString(String(campaignId))) return { skipped: "invalid job" };
	await connectDb();
	const campaign = await Campaign.findOne({ accountId, _id: campaignId }).select({ status: 1, pauseCode: 1 }).lean();
	if (!campaign) return { skipped: "campaign not found" };
	if (campaign.status !== "paused" || campaign.pauseCode !== RATE_LIMIT_PAUSE_CODE) return { skipped: `campaign is ${campaign.status}` };
	try {
		return { resumed: true, ...(await queueCampaign({ accountId, campaignId })) };
	} catch (error) {
		if (typeof error?.code !== "string") throw error;
		await Campaign.updateOne(
			{ accountId, _id: campaignId, status: "paused", pauseCode: RATE_LIMIT_PAUSE_CODE },
			{ $set: { pauseReason: `it couldn't go on by itself: ${formatError(error)}` }, $unset: { pauseCode: 1 } }
		);
		return { skipped: formatError(error) };
	}
}

// Over the block level a send blocks its whole account, which pauses it with the others: "block". Over the pause
// level it pauses alone and its owner is emailed: "pause", unless its owner resumed it from such a pause already
// (ratesAcceptedAt), and then only the block level stops it.
async function stopIfUnhealthy(accountId, campaignId) {
	const campaign = await Campaign.findOne({ accountId, _id: campaignId, status: "sending" })
		.select("stats lastChance ratesAcceptedAt")
		.lean();
	const problem = campaign ? getCampaignRateProblem(campaign.stats, campaign.lastChance) : null;
	if (!problem || (problem.level === "pause" && campaign.ratesAcceptedAt)) return null;
	if (problem.level === "block") {
		await blockAccount(accountId, { reason: problem.reason, by: "campaign" });
		await pauseCampaign({ accountId, campaignId, reason: BLOCKED_CAMPAIGN_REASON, code: ERROR_CODES.accountBlocked, isQuiet: true });
	} else {
		await pauseCampaign({ accountId, campaignId, reason: problem.reason, code: RATES_PAUSE_CODE });
	}
	return problem.level;
}

async function settleCampaign(accountId, campaignId) {
	if (await stopIfUnhealthy(accountId, campaignId)) return;
	if (await Message.exists({ accountId, campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: { $in: WAITING_STATUSES } })) return;
	// A campaign sent in steps keeps the date of its first step.
	await Campaign.updateOne(
		{ accountId, _id: campaignId, status: "sending" },
		{ $set: { status: "sent", finishedAt: new Date() }, $min: { sentAt: new Date() }, $unset: { sendingUntil: 1 } }
	);
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
		accountId: campaign.accountId,
		campaignId: campaign._id,
		newsletterId: campaign.newsletterId,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
		...(kind === "campaign" && !contact.lastSentAt && { firstSend: true }),
	}));
}

// Contacts this campaign already reached: an earlier step, or an attempt that stopped halfway.
async function findPreviousMessages(campaign) {
	const messages = await Message.find({
		accountId: campaign.accountId,
		campaignId: campaign._id,
		kind: { $in: CAMPAIGN_MESSAGE_KINDS },
	})
		.select({ _id: 0, contactId: 1, kind: 1 })
		.lean();
	return new Map(messages.map(({ contactId, kind }) => [String(contactId), kind]));
}

function findSuppressedEmails(accountId) {
	return Suppression.distinct("email", { accountId });
}

// Active, unsuppressed contacts of the campaign's segment, or of the whole list, most engaged first. With the list
// cleanup on, the limit counts issue recipients only, so it's applied while walking (lib/cleanup.js splitAudience).
async function findAudience({ campaign, settings, audienceLimit }) {
	const { filter, sort, limit } = buildAudienceQuery({
		accountId: campaign.accountId,
		newsletterId: campaign.newsletterId,
		suppressedEmails: await findSuppressedEmails(campaign.accountId),
		audienceLimit,
		segmentFilter: await findCampaignSegmentFilter(campaign),
	});
	const query = Contact.find(filter)
		.sort(sort)
		.select(settings.enabled ? { ...CLEANUP_FIELDS, lastSentAt: 1 } : { email: 1, lastSentAt: 1 })
		.lean();
	if (limit && !settings.enabled) query.limit(limit);
	const previous = settings.enabled ? await findPreviousMessages(campaign) : new Map();
	return { contacts: query.cursor(), limit, previous };
}

async function makeDormant(campaign, contacts) {
	if (contacts.length === 0) return;
	// A sign of life since the walk read them sets ignoredIssues back to 0: those contacts stay.
	const moved = await moveContacts(
		{ accountId: campaign.accountId, _id: { $in: contacts.map(({ _id }) => _id) }, ignoredIssues: { $gt: 0 } },
		{ from: ["active"], to: "dormant", via: "cleanup" }
	);
	if (moved > 0) {
		await Campaign.updateOne(
			{ accountId: campaign.accountId, _id: campaign._id },
			{ $inc: { "lastChance.dormant": moved } }
		);
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
		await makeDormant(campaign, split.dormant);
		remaining -= split.issue.length + split.received;
		if (remaining <= 0) break;
	}
}

// What the list cleanup would do at this send: one read-only walk over the whole list.
async function walkCleanupPreview(campaign, settings) {
	const { contacts, previous } = await findAudience({ campaign, settings });
	const preview = emptyPreview();
	const now = Date.now();
	for await (const group of inChunks(contacts, INSERT_CHUNK_SIZE)) addToPreview(preview, group, { settings, previous, now });
	return preview;
}

export async function getCleanupPreview({ accountId, campaignId }) {
	if (!isObjectIdString(String(campaignId))) throw fail("not_found", "Campaign not found");
	await connectDb();
	const campaign = await Campaign.findOne({ accountId, _id: campaignId }).select({ accountId: 1, newsletterId: 1, segmentId: 1 }).lean();
	if (!campaign) throw fail("not_found", "Campaign not found");
	const newsletter = await Newsletter.findOne({ accountId, _id: campaign.newsletterId }).select({ slug: 1, cleanup: 1 }).lean();
	const settings = getCleanupSettings(newsletter);
	if (!settings.enabled) return { enabled: false };
	return { enabled: true, ...(await walkCleanupPreview(campaign, settings)) };
}

// The emails a send would add, counted before anything is written: the list cleanup makes contacts
// dormant as the send walks the list, so the plan check can't wait for that walk.
async function countNewEmails({ campaign, newsletter, audienceLimit, issuesSoFar = 0 }) {
	const settings = getCleanupSettings(newsletter);
	if (settings.enabled) {
		const { issue, lastChance } = summarizePreview(await walkCleanupPreview(campaign, settings), audienceLimit);
		return Math.max(0, issue - issuesSoFar) + lastChance;
	}
	const { filter, limit } = buildAudienceQuery({
		accountId: campaign.accountId,
		newsletterId: campaign.newsletterId,
		suppressedEmails: await findSuppressedEmails(campaign.accountId),
		audienceLimit,
		segmentFilter: await findCampaignSegmentFilter(campaign),
	});
	const audience = await Contact.countDocuments(filter);
	return Math.max(0, Math.min(limit ?? Infinity, audience) - issuesSoFar);
}

function countQueuedEmails(campaign) {
	return Message.countDocuments({
		accountId: campaign.accountId,
		campaignId: campaign._id,
		kind: { $in: CAMPAIGN_MESSAGE_KINDS },
		status: { $in: WAITING_STATUSES },
	});
}

function publishFirstSendCheck(campaign, at) {
	return publishJob({
		url: `${getAppUrl()}/api/jobs/check-first-send`,
		body: { accountId: String(campaign.accountId), campaignId: String(campaign._id) },
		notBefore: Math.floor(at.getTime() / 1000),
	});
}

// A random sample of the held never-mailed contacts back in the queue, or all of them (size null): a list sorted by where
// its addresses came from can't hide its worst part behind its best. The ones it released.
async function releaseHeld(campaign, size = null) {
	const held = { accountId: campaign.accountId, campaignId: campaign._id, status: "held" };
	const released =
		size === null
			? await Message.find(held).sort({ _id: 1 }).select({ _id: 1, provider: 1 }).lean()
			: await Message.aggregate([{ $match: held }, { $sample: { size } }, { $project: { _id: 1, provider: 1 } }]);
	for (const group of chunk(released, INSERT_CHUNK_SIZE)) {
		await Message.updateMany(
			{ accountId: campaign.accountId, _id: { $in: group.map(({ _id }) => _id) }, status: "held" },
			{ $set: { status: "queued" } }
		);
	}
	return released;
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

// Never-mailed contacts go in steps (lib/first-send.js): they all wait as "held", a random first step goes now, and
// checkFirstSend lets each next step go FIRST_SEND.waitMinutes after the one before it is out.
async function holdFirstSendRest(campaign) {
	const filter = { accountId: campaign.accountId, campaignId: campaign._id, kind: "campaign", status: "queued", firstSend: true };
	const steps = getFirstSendSteps(await Message.countDocuments(filter));
	if (!steps) return null;
	await Message.updateMany(filter, { $set: { status: "held" } });
	await releaseHeld(campaign, steps[0]);
	const checkAt = new Date(Date.now() + FIRST_SEND.waitMinutes * MINUTE_MS);
	const firstSend = { steps, step: 1, slice: steps[0], held: sum(steps.slice(1)), checkAt };
	await Campaign.updateOne({ accountId: campaign.accountId, _id: campaign._id }, { $set: { firstSend } });
	await publishFirstSendCheck(campaign, checkAt);
	return firstSend;
}

// Resuming a send that held contacts back: a customer resuming after a bad step sends the rest; any other pause checks
// the steps so far again first.
async function resumeHeldMessages(campaign) {
	const held = { accountId: campaign.accountId, campaignId: campaign._id, status: "held" };
	if (campaign.pauseCode === FIRST_SEND_PAUSE_CODE) await Message.updateMany(held, { $set: { status: "queued" } });
	else if (await Message.exists(held)) await publishFirstSendCheck(campaign, new Date());
}

// The never-mailed contacts the steps let go so far: the ones due and not out yet, which the check waits for, and the
// sent ones' bounces and complaints. Gmail readers a new domain sends a later day aren't due (markSendAfter).
async function countFirstSendSent(campaign, now = new Date()) {
	const [counts] = await Message.aggregate([
		{ $match: { accountId: campaign.accountId, campaignId: campaign._id, kind: "campaign", firstSend: true, status: { $ne: "held" } } },
		{
			$group: {
				_id: null,
				due: {
					$sum: { $cond: [{ $and: [{ $eq: ["$status", "queued"] }, { $lte: [{ $ifNull: ["$sendAfter", now] }, now] }] }, 1, 0] },
				},
				sent: { $sum: { $cond: [{ $ifNull: ["$sentAt", false] }, 1, 0] } },
				bounced: { $sum: { $cond: [{ $ifNull: ["$bouncedAt", false] }, 1, 0] } },
				complained: { $sum: { $cond: [{ $ifNull: ["$complainedAt", false] }, 1, 0] } },
			},
		},
	]);
	return { due: counts?.due ?? 0, sent: counts?.sent ?? 0, bounced: counts?.bounced ?? 0, complained: counts?.complained ?? 0 };
}

// Runs when QStash delivers the check: a step still going out waits a little more; new contacts over the block level
// block the account, over the pause level hold the rest until its owner resumes; good ones let the next step go, and the
// last one everyone held. A send in steps from before there were several has one step left.
export async function checkFirstSend({ accountId, campaignId }) {
	if (!isObjectIdString(String(accountId)) || !isObjectIdString(String(campaignId))) return { skipped: "invalid job" };
	await connectDb();
	const campaign = await Campaign.findOne({ accountId, _id: campaignId }).select("accountId newsletterId status firstSend").lean();
	if (!campaign) return { skipped: "campaign not found" };
	const held = { accountId: campaign.accountId, campaignId: campaign._id, status: "held" };
	if (!(await Message.exists(held))) return { skipped: "nothing held" };
	if (campaign.status !== "sending") return { skipped: `campaign is ${campaign.status}` };

	const sent = await countFirstSendSent(campaign);
	if (sent.due > 0) {
		await publishFirstSendCheck(campaign, new Date(Date.now() + FIRST_SEND.recheckMinutes * MINUTE_MS));
		return { waiting: true, ...sent };
	}
	const problem = getFirstSendProblem(sent);
	if (problem?.level === "block") {
		const reason = `${problem.reason}. The rest of the new contacts weren't sent.`;
		await pauseCampaign({ accountId: campaign.accountId, campaignId: campaign._id, reason, code: FIRST_SEND_PAUSE_CODE, isQuiet: true });
		await blockAccount(campaign.accountId, { reason: problem.reason, by: "slice" });
		return { paused: true, blocked: true, ...sent };
	}
	if (problem) {
		const reason = `${problem.reason}. The rest of the new contacts wait: clean the list of addresses you can't vouch for, then resume to send to them.`;
		await pauseCampaign({ accountId: campaign.accountId, campaignId: campaign._id, reason, code: FIRST_SEND_PAUSE_CODE });
		return { paused: true, ...sent };
	}
	const steps = Array.isArray(campaign.firstSend?.steps) ? campaign.firstSend.steps : null;
	const step = campaign.firstSend?.step ?? 1;
	const isLast = !steps || step + 1 >= steps.length;
	// Its own Gmail readers already scheduled go before the ones it releases.
	const sender = await loadSenderPace(campaign, { isReleasing: true });
	const released = await releaseHeld(campaign, isLast ? null : steps[step]);
	const checkAt = isLast ? null : new Date(Date.now() + FIRST_SEND.waitMinutes * MINUTE_MS);
	await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id },
		{
			$set: isLast
				? { "firstSend.checkedAt": new Date(), "firstSend.step": steps?.length ?? 2, "firstSend.held": 0 }
				: { "firstSend.step": step + 1, "firstSend.checkAt": checkAt, "firstSend.held": sum(steps.slice(step + 1)) },
		}
	);
	const batches = await publishBatches(campaign, released, sender);
	if (checkAt) await publishFirstSendCheck(campaign, checkAt);
	else {
		const gmail = sender ? released.filter(({ provider }) => provider === "gmail").length : 0;
		await setSendingUntil(campaign, gmail > 0 ? getSenderMs(sender, gmail - 1) : 0);
	}
	return { released: released.length, step: step + 1, batches, ...sent };
}

// Campaign sends stop when the account can't send or the plan has no room for them. Signups don't.
async function assertCanSendCampaign(account, recipients) {
	const accountProblem = getAccountSendProblem(account);
	if (accountProblem) throw codedError(accountProblem);
	const current = await rollUsagePeriod(account);
	const [activeContacts, queued] = await Promise.all([
		countActiveContacts(account._id),
		countEmailsInFlight(account._id),
	]);
	const problem = getPlanLimitProblem({
		account: current,
		emailsSent: current.usage?.emailsSent ?? 0,
		queued,
		recipients,
		activeContacts,
	});
	if (problem) throw codedError(problem);
}

// Before scheduling. A send that goes out after the month resets only needs the account able to send and
// under its subscriber limit; it's checked in full when it goes out. segmentId: the one the schedule is about to set
// (null for none), undefined to keep the campaign's.
export async function checkCampaignSend({ accountId, campaignId, audienceLimit, at, segmentId }) {
	await connectDb();
	const account = await findAccount(accountId);
	const stored = await Campaign.findOne({ accountId: account._id, _id: campaignId }).lean();
	if (!stored) throw fail("not_found", "Campaign not found");
	const campaign = segmentId === undefined ? stored : { ...stored, segmentId };
	const newsletter = await Newsletter.findOne({ accountId: account._id, _id: campaign.newsletterId }).lean();
	const periodEnd = account.usage?.periodEnd;
	const isAfterReset = Boolean(at && periodEnd && at >= new Date(periodEnd));
	const newEmails = isAfterReset ? 0 : await countNewEmails({ campaign, newsletter, audienceLimit });
	await assertCanSendCampaign(account, newEmails);
}

function countCampaignMessages(campaign) {
	return Promise.all(
		CAMPAIGN_MESSAGE_KINDS.map((kind) =>
			Message.countDocuments({ accountId: campaign.accountId, campaignId: campaign._id, kind })
		)
	);
}

// Gmail readers a new domain sends on a later day say when they're due, so a first send's check doesn't wait for them
// (countFirstSendSent).
async function markSendAfter(campaign, batches) {
	const byStart = new Map();
	for (const { group, start } of batches) {
		if (start) byStart.set(start, [...(byStart.get(start) ?? []), ...group.map(({ _id }) => _id)]);
	}
	for (const [start, ids] of byStart) {
		for (const part of chunk(ids, INSERT_CHUNK_SIZE)) {
			await Message.updateMany({ accountId: campaign.accountId, _id: { $in: part } }, { $set: { sendAfter: new Date(start * 1000) } });
		}
	}
}

// Each batch goes at once, except a new domain's Gmail readers past its day's share, which wait for their day at its
// pace (lib/send-spread.js); like every batch, it checks the campaign's rates first. messages: { _id, provider }.
async function publishBatches(campaign, messages, sender) {
	const url = `${getAppUrl()}/api/jobs/send-batch`;
	// One batch at a time per account, whatever its number of campaigns, so a large send can't take every
	// slot: other accounts' batches run beside it, and all of them share the SES rate (lib/send-rate.js).
	const flowControl = { key: `account-${campaign.accountId}`, parallelism: 1 };
	const accountId = String(campaign.accountId);
	const isPaced = ({ provider }) => Boolean(sender) && provider === "gmail";
	const paced = chunk(messages.filter(isPaced), SEND_BATCH_SIZE);
	const starts = getGmailBatchStarts(paced.length, sender);
	const batches = [
		...chunk(messages.filter((message) => !isPaced(message)), SEND_BATCH_SIZE).map((group) => ({ group, start: null })),
		...paced.map((group, index) => ({ group, start: starts[index] })),
	];
	await markSendAfter(campaign, batches);
	const requests = batches.map(({ group, start }) => ({
		url,
		body: { accountId, messageIds: group.map(({ _id }) => String(_id)) },
		flowControl,
		...(start && { notBefore: start }),
	}));

	for (const group of chunk(requests, PUBLISH_CHUNK_SIZE)) await publishWith((client) => client.batchJSON(group));
	return requests.length;
}

// Issues first; last-chance emails go to the least engaged addresses, after everyone else.
async function publishQueuedMessages(campaign, sender) {
	const queued = await Message.find({
		accountId: campaign.accountId,
		campaignId: campaign._id,
		kind: { $in: CAMPAIGN_MESSAGE_KINDS },
		status: "queued",
	})
		.sort({ kind: 1, _id: 1 })
		.select({ _id: 1, provider: 1 })
		.lean();
	return publishBatches(campaign, queued, sender);
}

// The pace of the domain its newsletter sends from while Gmail's readers are held back on it (lib/send-spread.js
// getSenderPace), after what it sent today and the account's other sends from it still have to send. isReleasing: a
// step of the send's own, whose Gmail readers already scheduled go first. null when nothing holds them back.
async function loadSenderPace(campaign, { isReleasing = false } = {}) {
	if (!isCloud()) return null;
	const volumes = await getCampaignSenderVolumes(campaign, { isReleasing });
	return volumes && getSenderPace(volumes);
}

// About when a send's last email goes, for the dashboard; none for a send that goes at once.
function setSendingUntil(campaign, endsInMs) {
	return Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id },
		endsInMs > 0 ? { $set: { sendingUntil: new Date(Date.now() + endsInMs) } } : { $unset: { sendingUntil: 1 } }
	);
}

function countWaitingGmail(campaign) {
	return Message.countDocuments({
		accountId: campaign.accountId,
		campaignId: campaign._id,
		kind: { $in: CAMPAIGN_MESSAGE_KINDS },
		provider: "gmail",
		status: { $in: WAITING_STATUSES },
	});
}

// What a send queued goes out now; contacts held back for the first-send steps follow as each check passes. Its end: the
// steps' checks, or its last Gmail reader a new domain sends a later day.
async function publishSend(campaign, { isResuming = false } = {}) {
	const sender = await loadSenderPace(campaign);
	if (isResuming) {
		await resumeHeldMessages(campaign);
		// Published again from now: a day the pace gave them before no longer holds.
		await Message.updateMany(
			{ accountId: campaign.accountId, campaignId: campaign._id, status: "queued", sendAfter: { $exists: true } },
			{ $unset: { sendAfter: 1 } }
		);
	}
	const firstSend = isResuming ? null : await holdFirstSendRest(campaign);
	const batches = await publishQueuedMessages(campaign, sender);
	const gmail = sender ? await countWaitingGmail(campaign) : 0;
	const stepsMs = firstSend ? (firstSend.steps.length - 1) * FIRST_SEND.waitMinutes * MINUTE_MS : 0;
	await setSendingUntil(campaign, Math.max(stepsMs, gmail > 0 ? getSenderMs(sender, gmail - 1) : 0));
	return batches;
}

// A send starts the days its newsletter's domain holds Gmail's readers back (lib/sender-warmup.js), or goes on with them.
async function startSenderPace(account, newsletter, sender) {
	if (isCloud()) await startSenderWarmup(account, newsletter, sender.identity);
}

async function loadCampaign({ accountId, campaignId }) {
	if (!isObjectIdString(String(campaignId))) throw fail("not_found", "Campaign not found");
	await connectDb();
	const account = await findAccount(accountId);
	const campaign = await Campaign.findOne({ accountId: account._id, _id: campaignId }).lean();
	if (!campaign) throw fail("not_found", "Campaign not found");
	const newsletter = await Newsletter.findOne({ accountId: account._id, _id: campaign.newsletterId }).lean();
	return { account, campaign, newsletter };
}

function assertCanQueue() {
	assertSendingEnabled();
	if (!process.env.QSTASH_TOKEN) throw fail("unavailable", "QStash is not configured (QSTASH_TOKEN)");
}

async function loadCampaignSend({ accountId, campaignId }) {
	assertCanQueue();
	return loadCampaign({ accountId, campaignId });
}

function assertQueueable(campaign) {
	if (!QUEUEABLE_STATUSES.includes(campaign.status)) {
		throw fail("conflict", `Campaign is already ${campaign.status}`);
	}
	if (campaign.status === "paused" && REVIEW_CODES.has(campaign.pauseCode)) {
		throw fail("conflict", campaign.pauseCode === REVIEW_PAUSE_CODE ? REVIEW_PAUSE_REASON : REJECTED_PAUSE_REASON);
	}
}

// Web only: the issue goes on the newsletter's website and no email goes out, so nothing counts against the plan, the
// steps or the list, and sending can be off. The content check runs first, as before a send, and holds it the same way.
async function publishOnWeb({ account, campaign, newsletter }) {
	const accountProblem = getAccountSendProblem(account);
	if (accountProblem) throw codedError(accountProblem);
	const problem = getPublishProblem({ campaign, newsletter });
	if (problem) throw fail("send_check_failed", problem);

	const { held } = await reviewBeforeSend({ account, campaign, newsletter, heldStatuses: ["draft", "scheduled"] });
	if (held) return { held: true, recipients: 0, batches: 0 };
	const now = new Date();
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: { $in: ["draft", "scheduled"] }, publishTo: "web" },
		{
			$set: { status: "sent" },
			$unset: { pauseReason: 1, pauseCode: 1, scheduledAt: 1 },
			$min: { startedAt: now, sentAt: now },
		}
	);
	if (!modifiedCount) throw fail("conflict", "The campaign changed, refresh and try again");
	await assignArchiveSlug({ campaign, newsletter });
	return { recipients: 0, batches: 0, published: true };
}

// Draft or scheduled: selects the audience. Paused: resumes with the audience it already has. A send the content check
// holds (lib/content-review.js) waits, paused, for an admin: { held: true }, and only an admin's approval starts it. A
// web-only issue publishes instead (publishOnWeb). stopForTips: when the check has tips, nothing happens yet: { tips }.
export async function queueCampaign({ accountId, campaignId, stopForTips = false }) {
	const loaded = await loadCampaign({ accountId, campaignId });
	assertQueueable(loaded.campaign);
	if (!sendsEmail(loaded.campaign)) return publishOnWeb(loaded);
	assertCanQueue();
	const { account, campaign, newsletter } = loaded;
	const sender = newsletter && (await loadSender(account, newsletter, { checkDns: true }));
	const problem = getSendProblem({ campaign, newsletter, sender });
	if (problem) throw sendProblemError(problem, sender);

	const isResuming = campaign.status === "paused";
	const newEmails = isResuming
		? await countQueuedEmails(campaign)
		: await countNewEmails({ campaign, newsletter, audienceLimit: campaign.audienceLimit });
	await assertCanSendCampaign(account, newEmails);

	if (!isResuming) {
		const { held, tips } = await reviewBeforeSend({ account, campaign, newsletter, heldStatuses: ["draft", "scheduled"], stopForTips });
		if (tips) return { tips, recipients: 0, batches: 0 };
		if (held) return { held: true, recipients: 0, batches: 0 };
		await insertCampaignMessages(campaign, newsletter);
	}
	const [recipients, lastChances] = await countCampaignMessages(campaign);
	if (recipients + lastChances === 0) throw fail("no_recipients", "No active contacts to send to");

	await startSenderPace(account, newsletter, sender);
	const now = new Date();
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: campaign.status },
		{
			$set: {
				status: "sending",
				"stats.recipients": recipients,
				"lastChance.recipients": lastChances,
				...(isResuming && RATE_PAUSE_CODES.has(campaign.pauseCode) && { ratesAcceptedAt: now }),
			},
			$unset: { pauseReason: 1, pauseCode: 1, spreadHours: 1 },
			$min: { startedAt: now, "links.countedAt": now },
		}
	);
	if (!modifiedCount) throw fail("conflict", "The campaign changed, refresh and try again");

	try {
		await assignArchiveSlug({ campaign, newsletter });
		const batches = await publishSend(campaign, { isResuming });
		if (batches === 0) await settleCampaign(campaign.accountId, campaign._id);
		return { recipients, batches };
	} catch (error) {
		await pauseCampaign({
			accountId: campaign.accountId,
			campaignId: campaign._id,
			reason: `queueing failed: ${formatError(error)}`,
		});
		throw fail("unavailable", `Could not queue the campaign, it is paused: ${formatError(error)}`);
	}
}

// Sending in steps: a sent campaign goes to the next most engaged contacts. It takes the top of the
// audience again and the one-email-per-contact index skips everyone who already received it.
export async function sendToMoreContacts({ accountId, campaignId, additional }) {
	const { account, campaign, newsletter } = await loadCampaignSend({ accountId, campaignId });
	if (!sendsEmail(campaign)) throw fail("conflict", "A web-only issue doesn't go out by email");
	if (campaign.status !== "sent") throw fail("conflict", "Wait until the current step has gone out");
	const sender = newsletter && (await loadSender(account, newsletter, { checkDns: true }));
	const problem = getSendProblem({ campaign, newsletter, sender });
	if (problem) throw sendProblemError(problem, sender);

	const [sentSoFar, lastChancesSoFar] = await countCampaignMessages(campaign);
	const audienceLimit = getNextStepLimit({ sentSoFar, additional });
	// At least this many: contacts who got it and left since make room for new ones.
	const newEmails = await countNewEmails({ campaign, newsletter, audienceLimit, issuesSoFar: sentSoFar });
	await assertCanSendCampaign(account, newEmails);
	// Issues sent before the check get it at their next step; one it would hold refuses until an admin approves it.
	await reviewBeforeSend({ account, campaign, newsletter });

	await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign);
	if (recipients === sentSoFar && lastChances === lastChancesSoFar) throw fail("no_recipients", "Everyone has received it already");

	await startSenderPace(account, newsletter, sender);
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: "sent" },
		{
			$set: {
				status: "sending",
				"stats.recipients": recipients,
				"lastChance.recipients": lastChances,
				...(audienceLimit && { audienceLimit }),
			},
			$unset: { pauseReason: 1, pauseCode: 1, spreadHours: 1, ...(!audienceLimit && { audienceLimit: 1 }) },
		}
	);
	if (!modifiedCount) throw fail("conflict", "The campaign changed, refresh and try again");

	try {
		const batches = await publishSend(campaign);
		if (batches === 0) await settleCampaign(campaign.accountId, campaign._id);
		return { added: recipients - sentSoFar, recipients, batches };
	} catch (error) {
		await pauseCampaign({
			accountId: campaign.accountId,
			campaignId: campaign._id,
			reason: `queueing failed: ${formatError(error)}`,
		});
		throw fail("unavailable", `Could not queue the next step, the campaign is paused: ${formatError(error)}`);
	}
}

// Every issue counts toward the list cleanup until a sign of life sets the count back (lib/cleanup.js).
async function recordSent({ message, campaign, contact, providerMessageId, sentAt }) {
	const { accountId } = message;
	await Message.updateOne(
		{ accountId, _id: message._id },
		{ $set: { ...(providerMessageId && { providerMessageId }), sentAt }, $unset: { error: 1 } }
	);
	const statsPath = getCampaignStatsPath(message.kind);
	await Promise.all([
		campaign && Campaign.updateOne({ accountId, _id: campaign._id }, { $inc: { [`${statsPath}.sent`]: 1 } }),
		Contact.updateOne(
			{ accountId, _id: contact._id },
			{
				$set: { lastSentAt: sentAt, ...(message.kind === "last-chance" && { lastChanceAt: sentAt }) },
				$inc: { "stats.sent": 1, ...(message.kind === "campaign" && { ignoredIssues: 1 }) },
			}
		),
	]);
}

// The provider refuses the address for this account: it's kept out of the account's next sends too.
async function recordSuppressed({ message, error }) {
	const { accountId } = message;
	await Message.updateOne({ accountId, _id: message._id }, { $set: { status: "suppressed", error: formatError(error) } });
	await Suppression.updateOne(
		{ accountId, email: message.email },
		{ $setOnInsert: { reason: "provider", detail: formatError(error).slice(0, 200) } },
		{ upsert: true }
	);
}

async function recordFailed({ message, campaign, error }) {
	const { accountId } = message;
	await Message.updateOne(
		{ accountId, _id: message._id },
		{ $set: { status: "failed", error: formatError(error) } }
	);
	if (campaign) {
		await Campaign.updateOne(
			{ accountId, _id: campaign._id },
			{ $inc: { [`${getCampaignStatsPath(message.kind)}.failed`]: 1 } }
		);
	}
}

// Skipped for good: a month reset or an upgrade lets the next ones go, not this one. The owner hears once a month.
async function skipWelcomeEmail(account, message) {
	await Message.updateOne(
		{ accountId: account._id, _id: message._id, status: "queued" },
		{ $set: { status: "skipped", error: WELCOME_PAUSED_REASON } }
	);
	if (!(await claimWelcomePausedNotice(account._id))) return;
	const notice = getWelcomePauseNotice({ emailsLimit: getAccountLimits(account).emails, periodEnd: account.usage?.periodEnd });
	// The account's usage.welcomePausedAt already holds it to once a month, however close two months' ends are.
	await sendAlert({
		accountId: account._id,
		key: "welcome-paused",
		title: notice.title,
		detail: `${notice.detail} Confirmation emails still go out.`,
		path: "/billing",
		cooldownMinutes: 0,
	});
}

// At most once per message: the queued -> sent claim happens before SES is called. Campaign and welcome emails
// take room in the plan first (claimPlanEmails); what a batch doesn't send goes back at the end.
export async function sendMessageBatch({ accountId, messageIds }) {
	assertSendingEnabled();
	const ids = [
		...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id).toLowerCase())),
	]
		.filter(isObjectIdString)
		.slice(0, MAX_BATCH_MESSAGES);
	const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, retry: false };
	if (ids.length === 0 || !isObjectIdString(String(accountId))) return result;

	await connectDb();
	const stored = await Account.findById(accountId).lean();
	if (!stored) {
		result.skipped = ids.length;
		return result;
	}
	const account = await rollUsagePeriod(stored);
	const order = new Map(ids.map((id, index) => [id, index]));
	const messages = (
		await Message.find({
			accountId: account._id,
			_id: { $in: ids },
			status: "queued",
			kind: { $in: [...CAMPAIGN_MESSAGE_KINDS, ...SIGNUP_KINDS] },
		}).lean()
	).sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
	result.skipped = ids.length - messages.length;
	if (messages.length === 0) return result;

	const [campaigns, newsletters, contacts, suppressedEmails, undeliverable] = await Promise.all([
		findByIds(Campaign, account._id, messages.map(({ campaignId }) => campaignId)),
		findByIds(Newsletter, account._id, messages.map(({ newsletterId }) => newsletterId), "+reviews"),
		findByIds(Contact, account._id, messages.map(({ contactId }) => contactId)),
		Suppression.distinct("email", { accountId: account._id, email: { $in: messages.map(({ email }) => email) } }),
		// Checked as each batch goes, so an address listed after its send was queued is skipped too.
		findGloballySuppressed(messages.map(({ email }) => email)),
	]);
	const suppressed = new Set(suppressedEmails);
	let hasBlocked = false;
	for (const campaignId of campaigns.keys()) hasBlocked = (await stopIfUnhealthy(account._id, campaignId)) === "block" || hasBlocked;

	const accountProblem = getAccountSendProblem(hasBlocked ? await findAccount(account._id) : account);
	const planMessageCount = messages.filter(({ kind }) => PLAN_KINDS.has(kind)).length;
	const allowance = accountProblem ? 0 : await claimPlanEmails(account, planMessageCount);
	const heldSignupEmails = accountProblem ? new Set() : await findHeldSignupEmails(account, messages, newsletters);
	const sentByKind = { plan: 0, confirmation: 0 };
	const senderFor = createSenderCache(account);
	const getTenant = createTenantLoader(account);

	try {
		let consecutiveFailures = 0;
		for (const message of messages) {
			if (!isSendingEnabled()) {
				result.retry = true;
				break;
			}
			const campaign = campaigns.get(String(message.campaignId)) ?? null;
			const isCampaignMessage = CAMPAIGN_MESSAGE_KINDS.includes(message.kind);
			if (isCampaignMessage) {
				const isCampaignSending = await Campaign.exists({
					accountId: account._id,
					_id: message.campaignId,
					status: "sending",
				});
				if (!isCampaignSending) {
					result.skipped++;
					continue;
				}
				// A Gmail reader a new domain's pace moved to a later day waits for the batch published for then, whatever an
				// older batch of it says.
				if (message.sendAfter && new Date(message.sendAfter).getTime() > Date.now() + SEND_AFTER_SKEW_MS) {
					result.skipped++;
					continue;
				}
				// Left queued, so the send picks them up again when it resumes.
				const stopCode = accountProblem?.code ?? (sentByKind.plan >= allowance ? ERROR_CODES.planLimitEmails : null);
				if (stopCode) {
					await pauseCampaign({
						accountId: account._id,
						campaignId: message.campaignId,
						code: stopCode,
						reason: PAUSE_REASONS[stopCode],
					});
					result.skipped++;
					continue;
				}
			} else if (accountProblem) {
				await Message.updateOne(
					{ accountId: account._id, _id: message._id, status: "queued" },
					{ $set: { status: "failed", error: accountProblem.message } }
				);
				result.failed++;
				continue;
			}

			const contact = contacts.get(String(message.contactId));
			const requiredStatus = message.kind === "confirmation" ? "pending" : "active";
			const isUndeliverable = undeliverable.has(message.email);
			if (contact?.status !== requiredStatus || suppressed.has(message.email) || isUndeliverable) {
				await Message.updateOne(
					{ accountId: account._id, _id: message._id, status: "queued" },
					{ $set: { status: "suppressed", ...(isUndeliverable && { error: UNDELIVERABLE_MESSAGE }) } }
				);
				if (isUndeliverable && contact) await markUndeliverable(account._id, contact._id);
				result.suppressed++;
				continue;
			}
			const isHeld = heldSignupEmails.has(`${message.newsletterId}:${message.kind}`);
			if (message.kind === "welcome" && isHeld) {
				await Message.updateOne(
					{ accountId: account._id, _id: message._id, status: "queued" },
					{ $set: { status: "skipped", error: WELCOME_HELD_REASON } }
				);
				result.skipped++;
				continue;
			}
			if (message.kind === "welcome" && sentByKind.plan >= allowance) {
				await skipWelcomeEmail(account, message);
				result.skipped++;
				continue;
			}

			const claim = await Message.updateOne(
				{ accountId: account._id, _id: message._id, status: "queued" },
				{ $set: { status: "sent", provider: mailboxProvider(message.email) } }
			);
			if (!claim.modifiedCount) {
				result.skipped++;
				continue;
			}

			const newsletter = newsletters.get(String(message.newsletterId));
			const content = getMessageContent({ kind: message.kind, newsletter, campaign, isHeld });
			let delivery;
			try {
				if (!newsletter || !content) throw new Error("Newsletter or email content not found");
				delivery = await deliver({
					message,
					content,
					newsletter,
					contact,
					contactFields: account.contactFields,
					sender: await senderFor(newsletter),
					getTenant,
				});
			} catch (error) {
				// Signup emails have no campaign to pause: they fail, unless the provider says to retry or skip them.
				const outcomeAction = campaign || error?.outcome ? await getSendAction(account._id, error) : "fail";
				const action = !campaign && outcomeAction === "pause" ? "fail" : outcomeAction;
				if (error?.hold) await blockAccountForHold(account._id, error);
				await alertSendRefused(account._id, error, action);
				if (action === "suppress") {
					await recordSuppressed({ message, error });
					result.suppressed++;
					continue;
				}
				if (action === "fail") {
					await recordFailed({ message, campaign, error });
					result.failed++;
					consecutiveFailures++;
					if (!campaign || consecutiveFailures < MAX_CONSECUTIVE_FAILURES) continue;
					await pauseCampaign({
						accountId: account._id,
						campaignId: campaign._id,
						reason: `${consecutiveFailures} sends failed in a row`,
					});
					break;
				}
				await Message.updateOne(
					{ accountId: account._id, _id: message._id, status: "sent" },
					{ $set: { status: "queued" } }
				);
				if (action === "pause") {
					await pauseCampaign({ accountId: account._id, campaignId: campaign._id, reason: formatError(error) });
				} else {
					result.retry = true;
					if (error?.retryAfter) result.retryAfter = error.retryAfter;
				}
				break;
			}

			await recordSent({ message, campaign, contact, ...delivery });
			result.sent++;
			sentByKind[PLAN_KINDS.has(message.kind) ? "plan" : "confirmation"]++;
			consecutiveFailures = 0;
		}
	} finally {
		await addEmailsSent(account._id, sentByKind.confirmation + sentByKind.plan - allowance);
	}

	for (const campaignId of campaigns.keys()) await settleCampaign(account._id, campaignId);
	return result;
}

async function sendTest({ account, content, newsletter, campaignId, to }) {
	const email = normalizeEmail(to);
	if (!email) throw fail("validation_failed", "The test email address is invalid");
	const sender = newsletter && (await loadSender(account, newsletter, { checkDns: true }));
	const problem = getSendProblem({ campaign: content, newsletter, sender });
	if (problem) throw sendProblemError(problem, sender);

	const message = await Message.create({
		kind: "test",
		accountId: account._id,
		campaignId,
		newsletterId: newsletter._id,
		email,
		provider: mailboxProvider(email),
	});
	// The test address's own first name when it's a contact with one, else a sample, so {{first_name}} shows a name; its
	// field values when it has some, else each field's fallback.
	const testContact = await Contact.findOne({ accountId: account._id, newsletterId: newsletter._id, email })
		.select({ firstName: 1, fields: 1 })
		.lean();
	let delivery;
	try {
		delivery = await deliver({
			message,
			content: { ...content, subject: `[Test] ${content.subject}` },
			newsletter,
			contact: { _id: TEST_CONTACT_ID, email, firstName: testContact?.firstName || SAMPLE_FIRST_NAME, fields: testContact?.fields },
			contactFields: account.contactFields,
			sender,
			getTenant: createTenantLoader(account),
		});
	} catch (error) {
		if (error?.hold) await blockAccountForHold(account._id, error);
		await alertSendRefused(account._id, error);
		await recordFailed({ message, campaign: null, error });
		throw fail(error.name === "SenderNotAllowed" ? "sender_not_allowed" : "unavailable", formatError(error));
	}

	const { providerMessageId, sentAt } = delivery;
	await Message.updateOne(
		{ accountId: account._id, _id: message._id },
		{ $set: { status: "sent", ...(providerMessageId && { providerMessageId }), sentAt } }
	);
	await addEmailsSent(account._id, 1);
	return { messageId: String(message._id), providerMessageId, sentAt };
}

async function loadTestAccount(accountId) {
	const account = await findAccount(accountId);
	const problem = getAccountSendProblem(account);
	if (problem) throw codedError(problem);
	return account;
}

export async function sendTestEmail({ accountId, campaignId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw fail("not_found", "Campaign not found");

	await connectDb();
	const account = await loadTestAccount(accountId);
	const campaign = await Campaign.findOne({ accountId: account._id, _id: campaignId }).lean();
	if (!campaign) throw fail("not_found", "Campaign not found");
	const newsletter = await Newsletter.findOne({ accountId: account._id, _id: campaign.newsletterId }).lean();
	const result = await sendTest({ account, content: campaign, newsletter, campaignId: campaign._id, to });
	await Campaign.updateOne({ accountId: account._id, _id: campaign._id }, { $set: { testSentAt: result.sentAt } });
	return result;
}

// Sends the saved welcome email, whether or not it's switched on yet.
export async function sendWelcomeTestEmail({ accountId, newsletterId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(newsletterId))) throw fail("not_found", "Newsletter not found");

	await connectDb();
	const account = await loadTestAccount(accountId);
	const newsletter = await Newsletter.findOne({ accountId: account._id, _id: newsletterId }).lean();
	if (!newsletter) throw fail("not_found", "Newsletter not found");
	const content = getWelcomeContent({ welcome: { ...newsletter.welcome, enabled: true } });
	if (!content) throw fail("send_check_failed", "Save a subject and content first");
	return sendTest({ account, content, newsletter, to });
}

// A canceled account takes no signups, so it sends no signup emails either; a blocked one sends nothing. cap: the welcome
// and confirmation emails each of its newsletters sends in 10 minutes, as its plan has it (lib/plans.js getSignupScale);
// canGrow: a bigger plan has more.
async function readSignupAccount(newsletter) {
	const account = await Account.findById(newsletter.accountId).select({ ...ACCESS_FIELDS, status: 1, plan: 1 }).lean();
	const problem = isBlocked(account) ? "account is blocked" : hasActiveSubscription(account) ? null : "no active plan";
	const scale = getSignupScale(account);
	return { problem, cap: LIMITS.welcomeEmailsPer10Minutes * scale, canGrow: scale < PLANS.at(-1).signupScale };
}

export async function queueWelcomeEmail({ newsletter, contact }) {
	assertSendingEnabled();
	const content = getWelcomeContent(newsletter);
	if (!content) return { skipped: "welcome email is off" };
	if (contact?.status !== "active") return { skipped: "contact is not active" };

	await connectDb();
	const { accountId } = newsletter;
	const [isSuppressed, hasWelcome, recentWelcomes, signup] = await Promise.all([
		Suppression.exists({ accountId, email: contact.email }),
		Message.exists({ accountId, kind: "welcome", contactId: contact._id }),
		countRecentSignupEmails(newsletter),
		readSignupAccount(newsletter),
	]);
	if (signup.problem) return { skipped: signup.problem };
	if (isSuppressed) return { skipped: "suppressed" };
	if (hasWelcome) return { skipped: "already sent" };
	if (recentWelcomes >= signup.cap) {
		await alertSignupCap(newsletter, signup);
		return { skipped: "rate limited" };
	}
	const problem = getSendProblem({ campaign: content, newsletter, sender: await loadSender({ _id: accountId }, newsletter) });
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
	const { accountId } = newsletter;
	const [isSuppressed, sentToContact, sentRecently, recentSignupEmails, signup] = await Promise.all([
		Suppression.exists({ accountId, email: contact.email }),
		Message.countDocuments({ accountId, kind: "confirmation", contactId: contact._id }),
		Message.exists({
			accountId,
			kind: "confirmation",
			contactId: contact._id,
			createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
		}),
		countRecentSignupEmails(newsletter),
		readSignupAccount(newsletter),
	]);
	if (signup.problem) return { skipped: signup.problem };
	if (isSuppressed) return { skipped: "suppressed" };
	if (sentRecently || sentToContact >= MAX_CONFIRMATIONS_PER_CONTACT) return { skipped: "already sent" };
	if (recentSignupEmails >= signup.cap) {
		await alertSignupCap(newsletter, signup);
		return { skipped: "rate limited" };
	}
	return sendSignupEmail({ kind: "confirmation", newsletter, contact });
}

async function sendSignupEmail({ kind, newsletter, contact }) {
	const message = await Message.create({
		kind,
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	});
	const job = { accountId: String(newsletter.accountId), messageIds: [String(message._id)] };
	const result = await sendMessageBatch(job);
	// Sent from the signup request itself: when the provider is full, QStash brings it back later.
	if (result.retry) {
		await publishBatchRetry(job, result.retryAfter).catch((error) => {
			console.error(`[sending] The ${kind} email for ${message._id} stays queued: ${error.message}`);
		});
	}
	return { messageId: String(message._id), ...result };
}

// A batch the provider couldn't take yet goes again once it says there's room, as one more QStash job.
export async function publishBatchRetry({ accountId, messageIds }, retryAfterSeconds) {
	const delay = Math.min(Math.max(Math.ceil(retryAfterSeconds || DEFAULT_RETRY_SECONDS), 10), MAX_RETRY_SECONDS);
	return publishJob({
		url: `${getAppUrl()}/api/jobs/send-batch`,
		body: { accountId: String(accountId), messageIds },
		notBefore: Math.floor(Date.now() / 1000) + delay,
		flowControl: { key: `account-${accountId}`, parallelism: 1 },
	});
}
