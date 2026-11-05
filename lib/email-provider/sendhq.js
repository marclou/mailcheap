import "server-only";
import { randomUUID } from "node:crypto";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { getMessageClass, getSendhqSendError, toDomainStatus } from "@/lib/email-provider/sendhq-rules";
import * as sendhq from "@/lib/sendhq";

// One SendHQ workspace for the whole server, with SENDHQ_API_KEY. Every account sends through it, and MailCheap's own
// block is what holds one (lib/account-blocks.js).
const WORKSPACE = Object.freeze({ id: "workspace" });

function getTenant() {
	return WORKSPACE;
}

async function provisionTenant() {
	return WORKSPACE;
}

async function ensureTenant() {
	return WORKSPACE;
}

async function suspendTenant() {}

async function resumeTenant() {
	return false;
}

function describeTenant() {
	return null;
}

async function removeTenant() {}

// SendHQ keeps the return path on its provider's domain: SPF passes for that domain, and DMARC on the DKIM signature.
const RETURN_PATH_DOMAIN = "amazonses.com";

function getMailFromDomain() {
	return RETURN_PATH_DOMAIN;
}

// A domain is in one SendHQ workspace at a time, so a name SendHQ already has is never taken over: it may be
// EMAIL_FROM's, or another workspace's.
async function addDomain({ domain }) {
	try {
		const created = await sendhq.createDomain(domain);
		return { providerDomainId: created.id, status: toDomainStatus(created) };
	} catch (error) {
		if (error.status === 409) {
			throw Object.assign(new Error(`${domain} is already set up at SendHQ, in this workspace or another one. Remove it there, or add a subdomain instead, like mail.${domain}.`), {
				code: "conflict",
			});
		}
		throw error;
	}
}

// verify asks SendHQ to check DKIM now; otherwise this reads what it found last.
async function readDomain({ domain, verify = false }) {
	if (!domain.providerDomainId) return { missing: true };
	try {
		if (verify) await sendhq.verifyDomain(domain.providerDomainId);
		return toDomainStatus(await sendhq.getDomain(domain.providerDomainId));
	} catch (error) {
		if (error.status === 404) return { missing: true };
		return { error: error.message };
	}
}

async function removeDomain({ domain }) {
	if (!domain.providerDomainId) return;
	try {
		await sendhq.deleteDomain(domain.providerDomainId);
	} catch (error) {
		if (error.status !== 404) throw error;
	}
}

// SEND_RATE_PER_SECOND paces every account and every kind of email (lib/send-rate.js).
function getSendLane() {
	return { name: "sendhq", rate: LIMITS.sendRatePerSecond };
}

function toSend({ email, messageClass, feedbackId }) {
	const headers = { ...email.headers, ...(feedbackId && { "Feedback-ID": feedbackId }) };
	return {
		from: email.from,
		to: [email.to],
		subject: email.subject,
		...(email.html && { html: email.html }),
		...(email.text && { text: email.text }),
		...(email.replyTo && { reply_to: email.replyTo }),
		...(Object.keys(headers).length > 0 && { headers }),
		message_class: messageClass,
	};
}

// Idempotency-Key = the message id: a retry of the same email never sends it twice. SendHQ's email id names the email
// in its events (lib/sendhq-webhook.js).
async function sendEmail({ message, email, feedbackId }) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	let result;
	try {
		result = await sendhq.sendEmail(toSend({ email, messageClass: getMessageClass(message.kind), feedbackId }), { idempotencyKey: String(message._id) });
	} catch (error) {
		throw getSendhqSendError(error);
	}
	return { providerMessageId: result.id };
}

// MailCheap's own emails on a self-hosted server without Resend, from EMAIL_FROM, a domain verified in the workspace.
async function sendPlatformEmail(email) {
	await sendhq.sendEmail(toSend({ email, messageClass: "transactional" }), { idempotencyKey: randomUUID() });
}

function isConfigured() {
	return Boolean(String(process.env.SENDHQ_API_KEY ?? "").trim());
}

export const sendhqProvider = Object.freeze({
	id: "sendhq",
	name: "SendHQ",
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
