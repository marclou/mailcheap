import crypto from "node:crypto";
import { getAppSecret } from "../config.js";
import { isObjectIdString } from "../validation.js";
import { SEND_OUTCOMES, providerError } from "./outcomes.js";

// A Google Workspace mailbox has no events: a bounce comes back to its inbox as an email (a delivery status
// notification, RFC 3464) that quotes the headers of the one that bounced. Each email carries this header, its account
// and message signed with a key of its own, so only an email MailCheap sent names what bounced: anyone can write to the
// inbox and call it a bounce.
export const REF_HEADER = "X-MailCheap-Ref";
const REF_PATTERN = /^x-mailcheap-ref:[ \t]*(?:\r?\n[ \t]+)?([a-f0-9]{24})\.([a-f0-9]{24})\.([A-Za-z0-9_-]{43})[ \t]*$/im;
const SECONDS_PER_HOUR = 3600;

function sign(payload) {
	const key = Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", "mailcheap-workspace-bounce-v1", 32));
	return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createMessageRef({ accountId, messageId }) {
	const payload = `${String(accountId).toLowerCase()}.${String(messageId).toLowerCase()}`;
	if (!payload.split(".").every(isObjectIdString)) throw new Error("Invalid message reference");
	return `${payload}.${sign(payload)}`;
}

function readMessageRef(source) {
	const [, accountId, messageId, signature] = REF_PATTERN.exec(source) ?? [];
	if (!signature) return null;
	const expected = Buffer.from(sign(`${accountId}.${messageId}`));
	const given = Buffer.from(signature);
	return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? { accountId, messageId } : null;
}

// A status field of the notification, with the lines it continues on.
function readField(source, name) {
	const match = new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, "im").exec(source);
	return match ? match[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
}

// The address or its domain doesn't exist (RFC 3463): the contact is never emailed again, by any account for the first.
const UNDELIVERABLE_STATUSES = new Set(["5.1.1", "5.1.2", "5.1.10"]);
const HARD_STATUSES = new Set([...UNDELIVERABLE_STATUSES, "5.1.3", "5.1.6", "5.2.1"]);
// Mail servers that answer 5.0.0 or 5.5.0 and say it in words.
const HARD_WORDS = /user unknown|unknown user|no such (?:user|mailbox|recipient|address)|(?:address|account|mailbox|user|recipient)[^.]{0,60}does(?: not|n't) exist|nosuchuser|nxdomain|domain name not found/i;

// One email from the mailbox, as lib/email-events.js takes it, or null when it isn't the bounce of an email MailCheap
// sent. Every other refusal is a soft bounce: a full mailbox, or a server that reads the email as spam, says nothing
// about the address. Gmail still trying says nothing yet. id: the notification's own, so one read twice counts once.
// recipient: the address it says bounced, which lib/workspace-bounces.js holds against the email's own.
export function parseBounce(source) {
	const text = String(source ?? "");
	const ref = readMessageRef(text);
	if (!ref) return null;
	const action = readField(text, "Action").toLowerCase();
	const isFailure = action === "failed" || (!action && /^x-failed-recipients:/im.test(text));
	if (!isFailure) return null;
	const recipient = /^(?:rfc822;\s*)?<?([^\s<>;]+@[^\s<>;]+?)>?$/i.exec(readField(text, "Final-Recipient") || readField(text, "X-Failed-Recipients"))?.[1]?.toLowerCase() ?? null;

	const diagnostic = readField(text, "Diagnostic-Code").replace(/^[a-z0-9-]+;\s*/i, "");
	const status = /^[245]\.\d{1,3}\.\d{1,3}/.exec(readField(text, "Status"))?.[0] ?? /\b[45]\.\d{1,3}\.\d{1,3}\b/.exec(diagnostic)?.[0] ?? "";
	const reason = [status, diagnostic.startsWith(status) ? diagnostic.slice(status.length).trim() : diagnostic].filter(Boolean).join(" ").slice(0, 300);
	const id = /^message-id:[ \t]*(?:\r?\n[ \t]+)?<([^<>\s]{1,200})>/im.exec(text)?.[1] ?? null;

	const isHard = HARD_STATUSES.has(status) || HARD_WORDS.test(diagnostic);
	return {
		...ref,
		id,
		recipient,
		type: "bounce",
		bounce: isHard ? "hard" : "soft",
		undeliverable: UNDELIVERABLE_STATUSES.has(status),
		reason,
		detail: `bounce/${status || "unknown"}`,
	};
}

const CONNECTION_ERRORS = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "EPIPE", "ETLS", "EPROTOCOL"]);
// Google's words for the mailbox being over what it may send in a day.
const DAILY_LIMIT = /5\.4\.5|daily (?:user )?sending (?:quota|limit) exceeded|sending limit/i;

export function isConnectionError(error) {
	return CONNECTION_ERRORS.has(error?.code) && !error?.responseCode;
}

// What Gmail's SMTP server answered, as an outcome (./outcomes.js). Only its code and its own words: never the password.
export function toSendError(error) {
	if (error?.name === "ProviderError") return error;
	const code = Number(error?.responseCode) || null;
	const answer = String(error?.response ?? error?.message ?? "").replace(/\s+/g, " ").slice(0, 200);
	const fail = (outcome, message, fields) => providerError(outcome, `Google Workspace: ${message}`, { detail: answer, ...fields });

	if (error?.code === "EAUTH" || code === 534 || code === 535) {
		return fail(SEND_OUTCOMES.misconfigured, "Google refused the mailbox's login (WORKSPACE_EMAIL, WORKSPACE_APP_PASSWORD)");
	}
	if (code === 550 && DAILY_LIMIT.test(answer)) {
		return fail(SEND_OUTCOMES.throttled, "the mailbox reached Google's limit for the day", { retryAfter: SECONDS_PER_HOUR });
	}
	if (code >= 400 && code < 500) return fail(SEND_OUTCOMES.throttled, `Google asks to try again later (${code})`, { retryAfter: 300 });
	if (isConnectionError(error)) return fail(SEND_OUTCOMES.unavailable, "Gmail's server didn't answer");
	return fail(SEND_OUTCOMES.failed, code ? `Gmail refused the email (${answer})` : answer || "the email didn't go");
}

// How long until the mailbox has room again: when the oldest email of its last 24 hours leaves them, an hour at most,
// as long as any provider's batch waits (lib/sending.js): one waiting longer is looked at again every hour.
export function getRetryAfter(oldestAt, now = Date.now()) {
	const opensAt = oldestAt ? new Date(oldestAt).getTime() + 24 * SECONDS_PER_HOUR * 1000 : now;
	return Math.min(SECONDS_PER_HOUR, Math.max(60, Math.ceil((opensAt - now) / 1000) + 60));
}

// Google publishes the key the Admin console generates at <selector>._domainkey.<domain>, google unless another was typed.
export function getDkimHost(domain, env = process.env) {
	const selector = String(env.WORKSPACE_DKIM_SELECTOR ?? "").trim().toLowerCase();
	return `${/^[a-z0-9-]{1,63}$/.test(selector) ? selector : "google"}._domainkey.${domain}`;
}

// records: a TXT lookup's answers, each as the strings DNS splits it into.
export function hasDkimKey(records) {
	return (records ?? []).some((record) => {
		const value = [].concat(record).join("");
		return /v=DKIM1/i.test(value) && /p=[A-Za-z0-9+/]{20,}/.test(value);
	});
}
