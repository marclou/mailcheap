import "server-only";
import { Resend } from "resend";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { getResendSendError, toDomainStatus } from "@/lib/email-provider/resend-rules";

// One Resend team for the whole server, with RESEND_API_KEY: customers' emails and MailCheap's own (lib/platform-email.js).
function getClient() {
	return new Resend(process.env.RESEND_API_KEY);
}

// Every account sends through the one team, and MailCheap's own block is what holds one (lib/account-blocks.js).
const TEAM = Object.freeze({ id: "team" });

function getTenant() {
	return TEAM;
}

async function provisionTenant() {
	return TEAM;
}

async function ensureTenant() {
	return TEAM;
}

async function suspendTenant() {}

async function resumeTenant() {
	return false;
}

function describeTenant() {
	return null;
}

async function removeTenant() {}

// Resend's default MAIL FROM subdomain, named so it never changes under a domain.
const RETURN_PATH_PREFIX = "send";

function getMailFromDomain(domain) {
	return `${RETURN_PATH_PREFIX}.${domain}`;
}

// MailCheap tracks opens and clicks itself (lib/tracking.js), so Resend's tracking stays off. A name the team already
// has is never taken over: it may be EMAIL_FROM's or another sender's, verified with their DNS.
async function addDomain({ domain }) {
	const { data, error } = await getClient().domains.create({ name: domain, customReturnPath: RETURN_PATH_PREFIX, openTracking: false, clickTracking: false });
	if (data) return { providerDomainId: data.id, status: toDomainStatus(data) };
	if (/already/i.test(error?.message ?? "")) throw Object.assign(new Error(`${domain} is set up at Resend for another sender`), { code: "conflict" });
	throw new Error(`Resend didn't add ${domain}: ${error?.message}`);
}

// verify asks Resend to look at DNS again; it answers later, so this reads the status it has now.
async function readDomain({ domain, verify = false }) {
	if (!domain.providerDomainId) return { missing: true };
	const resend = getClient();
	if (verify) await resend.domains.verify(domain.providerDomainId);
	const { data, error } = await resend.domains.get(domain.providerDomainId);
	if (error) return error.name === "not_found" ? { missing: true } : { error: error.message };
	return toDomainStatus(data);
}

async function removeDomain({ domain }) {
	if (!domain.providerDomainId) return;
	const { error } = await getClient().domains.remove(domain.providerDomainId);
	if (error && error.name !== "not_found") throw new Error(`Resend didn't remove ${domain.domain}: ${error.message}`);
}

// Resend's rate is the team's requests a second, for every account and every kind of email (lib/send-rate.js).
function getSendLane() {
	return { name: "resend", rate: LIMITS.sendRatePerSecond };
}

// Tags come back on every event, so a bounce or complaint always says which account and email it belongs to.
function getMessageTags(message) {
	const tags = [
		{ name: "message_id", value: String(message._id) },
		{ name: "account_id", value: String(message.accountId) },
		{ name: "kind", value: message.kind },
	];
	if (message.campaignId) tags.push({ name: "campaign_id", value: String(message.campaignId) });
	return tags;
}

// Idempotency-Key = the message id: a retry of the same email never sends it twice.
async function sendEmail({ message, email, feedbackId }) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	const { data, error, headers } = await getClient().emails.send(
		{
			from: email.from,
			to: [email.to],
			...(email.replyTo && { replyTo: email.replyTo }),
			subject: email.subject,
			html: email.html,
			text: email.text,
			headers: { ...email.headers, ...(feedbackId && { "Feedback-ID": feedbackId }) },
			tags: getMessageTags(message),
		},
		{ idempotencyKey: String(message._id) }
	);
	if (error) throw getResendSendError(error, headers);
	return { providerMessageId: data.id };
}

// lib/platform-email.js sends through Resend itself whenever RESEND_API_KEY is set, which this provider needs too.
async function sendPlatformEmail({ from, to, subject, text, html, headers, replyTo }) {
	const { error } = await getClient().emails.send({ from, to: [to], subject, text, ...(html && { html }), ...(headers && { headers }), ...(replyTo && { replyTo }) });
	if (error) throw new Error(`Resend answered ${error.statusCode ?? "nothing"}: ${error.message}`);
}

function isConfigured() {
	return Boolean(process.env.RESEND_API_KEY);
}

export const resendProvider = Object.freeze({
	id: "resend",
	name: "Resend",
	returnPathPrefix: RETURN_PATH_PREFIX,
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
