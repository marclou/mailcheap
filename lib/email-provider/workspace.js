import "server-only";
import { getWorkspaceDailyLimit, getWorkspaceMailbox } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { readTxt } from "@/lib/dns-check";
import { SEND_OUTCOMES, providerError } from "@/lib/email-provider/outcomes";
import { REF_HEADER, createMessageRef, getDkimHost, getRetryAfter, hasDkimKey, toSendError } from "@/lib/email-provider/workspace-rules";
import { sendWorkspaceEmail, sendWorkspacePlatformEmail } from "@/lib/google-workspace";
import MailboxSend from "@/models/MailboxSend";

// A Google Workspace mailbox, for a self-hosted server that sends a few hundred emails a day: every account's emails go
// out from it over Gmail's SMTP server, and bounces come back to its inbox (lib/workspace-bounces.js). There's nothing
// to create at Google: no tenants, and a domain is ready once Google signs its emails.
const TENANT = Object.freeze({ id: "workspace" });
// Gmail slows a mailbox that sends faster.
const SENDS_PER_SECOND = 1;

function getTenant() {
	return TENANT;
}

async function provisionTenant() {
	return TENANT;
}

async function ensureTenant() {
	return TENANT;
}

async function suspendTenant() {}

async function resumeTenant() {
	return false;
}

function describeTenant() {
	return null;
}

async function removeTenant() {}

// Gmail sends from the mailbox itself: bounces come back to it, and SPF is the domain's own.
function getMailFromDomain(domain) {
	return domain;
}

async function addDomain() {
	return { providerDomainId: null };
}

// Ready once the DKIM key Google generates for the domain (Admin console, Authenticate email) is in DNS. A lookup
// that failed says nothing.
async function readDomain({ domain }) {
	const records = await readTxt(getDkimHost(domain.domain));
	if (!records) return { unchanged: true };
	const isSigned = hasDkimKey(records);
	return { verified: isSigned, dkimStatus: isSigned ? "SUCCESS" : "PENDING", mailFromStatus: "SUCCESS", records: [] };
}

async function removeDomain() {}

function getSendLane() {
	return { name: "workspace", rate: SENDS_PER_SECOND };
}

// A place in the mailbox's last 24 hours, taken before the email goes so two instances never share the last one.
async function claimDailySend() {
	await connectDb();
	const limit = getWorkspaceDailyLimit();
	const claim = await MailboxSend.create({ at: new Date() });
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const sent = await MailboxSend.countDocuments({ at: { $gt: since } });
	if (sent <= limit) return claim;
	await MailboxSend.deleteOne({ _id: claim._id });
	const oldest = await MailboxSend.findOne({ at: { $gt: since } }).sort({ at: 1 }).lean();
	throw providerError(SEND_OUTCOMES.throttled, `Google Workspace: the mailbox sent its ${limit} emails for 24 hours`, {
		retryAfter: getRetryAfter(oldest?.at),
	});
}

async function sendCounted(send) {
	const claim = await claimDailySend();
	try {
		return await send();
	} catch (error) {
		await MailboxSend.deleteOne({ _id: claim._id }).catch(() => {});
		throw toSendError(error);
	}
}

async function sendEmail({ message, email, feedbackId }) {
	const { from, to, replyTo, subject, html, text, headers } = email;
	const { messageId } = await sendCounted(() =>
		sendWorkspaceEmail({ from, to, replyTo, subject, html, text, headers: { ...headers, "Feedback-ID": feedbackId, [REF_HEADER]: createMessageRef({ accountId: message.accountId, messageId: message._id }) } })
	);
	return { providerMessageId: messageId };
}

// MailCheap's own emails count in the mailbox's day and are never held back: a sign-in code can't wait for tomorrow.
async function sendPlatformEmail(email) {
	const result = await sendWorkspacePlatformEmail(email);
	await connectDb();
	await MailboxSend.create({ at: new Date() });
	return result;
}

function isConfigured() {
	return Boolean(getWorkspaceMailbox());
}

// The mailbox's last 24 hours against its limit, for the admin page.
export async function getMailboxUsage() {
	await connectDb();
	const used = await MailboxSend.countDocuments({ at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
	return { used, cap: getWorkspaceDailyLimit(), perSecond: SENDS_PER_SECOND };
}

export const workspaceProvider = Object.freeze({
	id: "workspace",
	name: "Google Workspace",
	returnPathPrefix: null,
	isConfigured,
	sendPlatformEmail,
	getTenant,
	provisionTenant,
	ensureTenant,
	suspendTenant,
	resumeTenant,
	describeTenant,
	removeTenant,
	getMailFromDomain,
	addDomain,
	readDomain,
	removeDomain,
	getSendLane,
	sendEmail,
});
