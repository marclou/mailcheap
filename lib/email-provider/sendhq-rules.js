import { CAMPAIGN_MESSAGE_KINDS } from "../sending-rules.js";
import { SEND_OUTCOMES, providerError } from "./outcomes.js";

// Issues and last-chance emails are newsletters: SendHQ sends them as marketing, which a workspace needs its marketing
// plan for. Welcome, confirmation and test emails answer something the reader or owner just did.
export function getMessageClass(kind) {
	return CAMPAIGN_MESSAGE_KINDS.includes(kind) ? "marketing" : "transactional";
}

// SendHQ's three DKIM CNAMEs, already named in full, are the only records it asks for: it keeps the return path on its
// own domain, so there's nothing to publish for it and it's ready once the domain is. Statuses in the SES words the
// Domains page already knows.
export function toDomainStatus(domain) {
	const isVerified = domain?.status === "verified";
	const status = isVerified ? "SUCCESS" : "PENDING";
	const records = (Array.isArray(domain?.records) ? domain.records : []).filter(({ purpose, type }) => purpose === "dkim" && type === "CNAME");
	return {
		verified: isVerified,
		dkimStatus: status,
		mailFromStatus: status,
		records: records.map(({ type, name, value }) => ({ purpose: "dkim", type, name: String(name).toLowerCase().replace(/\.$/, ""), value })),
	};
}

// SendHQ's own words, as its API answers them: most refusals carry no code, so the message says which one it is.
const SENDER_UNVERIFIED = /sender domain is not (verified|owned)/i;
// A new workspace's daily volume ramps up with its sending history; a plan's daily or monthly cap. An hour later, more
// may go.
const DAILY_LIMIT = /too new to send this volume|plan usage limit/i;
const TRIAL = /trial/i;
// The workspace's suppression and unsubscribe lists are every account's on this server: another account's bounce
// fails this email without becoming this account's suppression.
const WORKSPACE_LIST = /suppression list|unsubscribed from this workspace/i;
const MARKETING_OFF = /marketing sends are not enabled/i;

function getOutcome({ status, detail }) {
	if (!status || status >= 500) return SEND_OUTCOMES.unavailable;
	if (status === 401 || status === 402) return SEND_OUTCOMES.misconfigured;
	if (status === 403) return SENDER_UNVERIFIED.test(detail) ? SEND_OUTCOMES.domainUnverified : SEND_OUTCOMES.misconfigured;
	// The exact from address paused by SendHQ's reputation policy, until its rates recover.
	if (status === 423) return SEND_OUTCOMES.domainUnverified;
	if (status === 429) return TRIAL.test(detail) ? SEND_OUTCOMES.misconfigured : SEND_OUTCOMES.throttled;
	if (status === 422 && MARKETING_OFF.test(detail)) return SEND_OUTCOMES.misconfigured;
	// 409: the same Idempotency-Key with another body. The first one may have gone, so this one never goes again.
	return SEND_OUTCOMES.failed;
}

// lib/sendhq.js's error as a provider error. Every send carries an Idempotency-Key, so whatever didn't certainly fail
// can go again: a retry with the same body replays the first answer.
export function getSendhqSendError(error) {
	const detail = String(error?.detail ?? "");
	const outcome = getOutcome({ status: error?.status ?? null, detail });
	const retryAfter = error?.retryAfter ?? (outcome === SEND_OUTCOMES.throttled && DAILY_LIMIT.test(detail) ? 3600 : null);
	const isWorkspaceList = outcome === SEND_OUTCOMES.failed && WORKSPACE_LIST.test(detail);
	const message = isWorkspaceList ? "SendHQ: the address is on the workspace's suppression or unsubscribe list" : String(error?.message ?? "SendHQ refused the email");
	return providerError(outcome, message, {
		...(outcome === SEND_OUTCOMES.throttled && retryAfter && { retryAfter }),
		providerCode: error?.providerCode ?? null,
		detail,
	});
}
