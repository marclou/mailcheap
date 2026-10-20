import { SEND_OUTCOMES, providerError } from "./outcomes.js";

// The tenant's external id at Groundmail: letters, digits and dashes fit, and the account id never changes.
export function getTenantExternalId(accountId) {
	return `mc-${accountId}`;
}

// The records Groundmail asks for, grouped the way the Domains page shows them: the ownership TXT and the DKIM key
// prove the emails come from the domain, the return path CNAME and SPF make SPF pass. Its DMARC record is the same
// p=none MailCheap suggests on its own, and MailCheap tracks opens and clicks itself.
const RECORD_PURPOSES = { "Domain ownership": "dkim", DKIM: "dkim", "Return path": "mail-from", SPF: "mail-from" };
// The verify check's names for each record (checks), by the Domains page's groups.
const CHECKS = { dkim: ["ownership", "dkim"], "mail-from": ["return_path", "spf"] };

function groupStatus({ isVerified, isFailed, checks, group }) {
	if (isVerified) return "SUCCESS";
	if (isFailed) return "FAILED";
	return checks && CHECKS[group].every((name) => checks[name] === true) ? "SUCCESS" : "PENDING";
}

// A Groundmail domain ({ domain, records } from GET or POST /domains) in the shape lib/domains.js stores: statuses in
// the SES words the Domains page already knows. checks and lastError: what a verify that found DNS incomplete said.
export function toDomainStatus({ domain, records }, { checks = null, lastError = null } = {}) {
	const isVerified = domain?.status === "verified";
	const isFailed = domain?.status === "failed";
	return {
		verified: isVerified,
		dkimStatus: groupStatus({ isVerified, isFailed, checks, group: "dkim" }),
		mailFromStatus: groupStatus({ isVerified, isFailed, checks, group: "mail-from" }),
		records: (Array.isArray(records) ? records : [])
			.filter((record) => Object.hasOwn(RECORD_PURPOSES, record?.purpose) && record.host && record.value)
			.map(({ purpose, type, host, value }) => ({ purpose: RECORD_PURPOSES[purpose], type, name: host, value })),
		lastError: isVerified ? null : lastError,
	};
}

// What a verify that found DNS incomplete (400) says of each record: whether public DNS has it, and whether the mail
// server took the DKIM key and the return path.
export function readVerifyChecks(body) {
	const checks = body?.checks && typeof body.checks === "object" ? body.checks : null;
	const signing = body?.mail_server_signing;
	if (!checks || !signing || typeof signing !== "object") return checks;
	return { ...checks, dkim: checks.dkim === true && signing.dkim_ok === true, return_path: checks.return_path === true && signing.return_path_ok === true };
}

// Groundmail takes the sender's name apart from the address, unencoded: MailCheap's from has it quoted, or in RFC
// 2047 for non-ASCII names (lib/sending-rules.js formatFromAddress).
export function toAddress(from) {
	const match = /^(.*?)\s*<([^<>]+)>\s*$/.exec(String(from ?? ""));
	if (!match) return from;
	const encoded = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/i.exec(match[1].trim());
	const name = encoded ? Buffer.from(encoded[1], "base64").toString("utf8") : match[1].trim().replace(/^"(.*)"$/, "$1");
	return name ? { email: match[2], name } : match[2];
}

// Tags are kept with each email at Groundmail (10 at most), so an email in its dashboard or API says whose it is.
export function getTags(message) {
	return [
		{ name: "account_id", value: String(message.accountId) },
		{ name: "message_id", value: String(message._id) },
		{ name: "kind", value: message.kind },
		...(message.campaignId ? [{ name: "campaign_id", value: String(message.campaignId) }] : []),
	];
}

// POST /emails. Every newsletter email (issues, last-chance, welcome, confirmation and test emails) is category
// newsletter, which Groundmail sends from its own IPs, apart from its customers' transactional mail. Groundmail puts its
// own List-Unsubscribe and one-click unsubscribe on newsletter email in place of MailCheap's, and a reader who uses them
// comes back as a contact.unsubscribed event (lib/email-provider/groundmail-events.js). The unsubscribe links in the
// email stay MailCheap's.
export function buildEmail({ email, category, tags, tenant }) {
	const headers = email.headers && Object.keys(email.headers).length > 0 ? email.headers : null;
	return {
		from: toAddress(email.from),
		to: email.to,
		...(email.replyTo && { reply_to: email.replyTo }),
		subject: email.subject,
		...(email.html && { html: email.html }),
		...(email.text && { text: email.text }),
		...(headers && { headers }),
		...(tags && { tags }),
		category,
		...(tenant && { tenant }),
	};
}

// A daily limit frees up at details.resets_at, the next 00:00 UTC.
export function getRetryAfter(error, now = new Date()) {
	if (error.retryAfter) return error.retryAfter;
	const resetsAt = Date.parse(error.details?.resets_at ?? "");
	if (Number.isFinite(resetsAt) && resetsAt > now.getTime()) return Math.ceil((resetsAt - now.getTime()) / 1000) + 60;
	return 60;
}

const CODE_OUTCOMES = {
	rate_limited: SEND_OUTCOMES.throttled,
	daily_ramp_limit: SEND_OUTCOMES.throttled,
	newsletter_not_enabled: SEND_OUTCOMES.approvalPending,
	plan_limit: SEND_OUTCOMES.misconfigured,
	unauthorized: SEND_OUTCOMES.misconfigured,
	insufficient_scope: SEND_OUTCOMES.misconfigured,
	tenants_not_enabled: SEND_OUTCOMES.misconfigured,
	not_found: SEND_OUTCOMES.misconfigured,
	domain_not_allowed: SEND_OUTCOMES.domainUnverified,
	internal_error: SEND_OUTCOMES.unavailable,
	not_configured: SEND_OUTCOMES.unavailable,
};

const MESSAGES = {
	newsletter_not_enabled: "Groundmail hasn't enabled newsletter sending for this account yet (newsletter_not_enabled)",
	tenant_paused: "Groundmail paused this account's tenant",
	suppressed: "Groundmail suppresses this address for the account",
	unknown: "Groundmail couldn't say whether the email went out (504); it isn't sent again",
};

// Groundmail's 403 forbidden covers a paused tenant, a from domain it hasn't verified, sending its own plan doesn't
// allow yet (with an upgrade_url) and a Groundmail account it stopped.
function getForbiddenOutcome(error) {
	if (error.details?.tenant_status === "paused") return SEND_OUTCOMES.tenantPaused;
	if (error.body?.error?.upgrade_url || error.body?.upgrade_url) return SEND_OUTCOMES.approvalPending;
	if (/not verified/i.test(error.detail ?? "")) return SEND_OUTCOMES.domainUnverified;
	return SEND_OUTCOMES.misconfigured;
}

function getStatusOutcome(status) {
	if (status === 401 || status === 403 || status === 404) return SEND_OUTCOMES.misconfigured;
	if (status === 429) return SEND_OUTCOMES.throttled;
	if (status >= 500) return SEND_OUTCOMES.unavailable;
	return SEND_OUTCOMES.failed;
}

// POST /emails carries an Idempotency-Key, so whatever didn't certainly fail can go again: a retry replays the first
// answer, and one still in progress answers idempotency_conflict. A 504 may have sent it, and its retry answers the
// same 504, so it isn't tried again.
export function getSendError(error, now = new Date()) {
	const code = error.providerCode ?? "";
	const fields = { providerCode: error.providerCode ?? null };
	if (!error.status) return providerError(SEND_OUTCOMES.unavailable, error.message, fields);
	if (code === "idempotency_conflict") {
		return /in progress/i.test(error.detail ?? "")
			? providerError(SEND_OUTCOMES.throttled, error.message, { ...fields, retryAfter: 15 })
			: providerError(SEND_OUTCOMES.failed, error.message, fields);
	}
	if (error.status === 504) return providerError(SEND_OUTCOMES.failed, MESSAGES.unknown, fields);
	// Every recipient suppressed, opted out of the category or held back as unable to receive email.
	if (error.status === 422) return providerError(SEND_OUTCOMES.suppressed, MESSAGES.suppressed, fields);

	const outcome = code === "forbidden" ? getForbiddenOutcome(error) : (CODE_OUTCOMES[code] ?? getStatusOutcome(error.status));
	if (outcome === SEND_OUTCOMES.tenantPaused) return providerError(outcome, MESSAGES.tenant_paused, { ...fields, hold: "held" });
	return providerError(outcome, MESSAGES[code] ?? error.message, {
		...fields,
		...(outcome === SEND_OUTCOMES.throttled && { retryAfter: getRetryAfter(error, now) }),
	});
}
