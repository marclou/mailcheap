import { rootDomain } from "../root-domain.js";
import { SEND_OUTCOMES, providerError } from "./outcomes.js";

const RECORD_PURPOSES = { DKIM: "dkim", SPF: "mail-from" };
const RECORD_STATUSES = {
	verified: "SUCCESS",
	pending: "PENDING",
	temporary_failure: "TEMPORARY_FAILURE",
	failed: "FAILED",
	not_started: "NOT_STARTED",
};

// Resend names a record inside the domain's zone (send.news for news.example.com); MailCheap keeps full names.
function getFullName(name, domain) {
	const zone = rootDomain(domain);
	const host = String(name ?? "")
		.toLowerCase()
		.replace(/\.$/, "");
	if (!host || host === "@") return zone;
	return host === zone || host.endsWith(`.${zone}`) ? host : `${host}.${zone}`;
}

// The first of a purpose's records that isn't verified says how far it is.
function getPurposeStatus(records, purpose) {
	const statuses = records.filter(({ record }) => RECORD_PURPOSES[record] === purpose).map(({ status }) => status);
	if (statuses.length === 0) return "NOT_STARTED";
	return RECORD_STATUSES[statuses.find((status) => status !== "verified") ?? "verified"] ?? "PENDING";
}

// A Resend domain in the shape lib/domains.js stores: statuses in the SES words the Domains page already knows, an MX's
// priority in its value as SES writes it, and only the records sending needs.
export function toDomainStatus(domain) {
	const records = (domain.records ?? []).filter(({ record }) => Object.hasOwn(RECORD_PURPOSES, record));
	return {
		verified: domain.status === "verified",
		dkimStatus: getPurposeStatus(records, "dkim"),
		mailFromStatus: getPurposeStatus(records, "mail-from"),
		records: records.map(({ record, type, name, value, priority }) => ({
			purpose: RECORD_PURPOSES[record],
			type,
			name: getFullName(name, domain.name),
			value: type === "MX" && priority != null ? `${priority} ${value}` : value,
		})),
	};
}

const SEND_OUTCOMES_BY_NAME = {
	rate_limit_exceeded: SEND_OUTCOMES.throttled,
	daily_quota_exceeded: SEND_OUTCOMES.throttled,
	concurrent_idempotent_requests: SEND_OUTCOMES.throttled,
	// Waiting doesn't free it up: the admins hear of it (lib/sending.js alertSendRefused).
	monthly_quota_exceeded: SEND_OUTCOMES.misconfigured,
	missing_api_key: SEND_OUTCOMES.misconfigured,
	invalid_api_key: SEND_OUTCOMES.misconfigured,
	restricted_api_key: SEND_OUTCOMES.misconfigured,
	application_error: SEND_OUTCOMES.unavailable,
	internal_server_error: SEND_OUTCOMES.unavailable,
	// The same Idempotency-Key with other content: the first one may have gone, so this one never goes again.
	invalid_idempotent_request: SEND_OUTCOMES.failed,
};

const RETRY_AFTER = { daily_quota_exceeded: 3600, concurrent_idempotent_requests: 15 };

function getStatusOutcome(statusCode) {
	if (statusCode === 429) return SEND_OUTCOMES.throttled;
	if (!statusCode || statusCode >= 500) return SEND_OUTCOMES.unavailable;
	return SEND_OUTCOMES.failed;
}

// The SDK's { name, message, statusCode } as a provider error. Every send carries an Idempotency-Key, so whatever
// didn't certainly fail can go again: a retry replays the first answer. headers: the response's, for retry-after.
export function getResendSendError(error, headers = null) {
	const message = String(error?.message ?? "Resend refused the email");
	let outcome = Object.hasOwn(SEND_OUTCOMES_BY_NAME, error?.name) ? SEND_OUTCOMES_BY_NAME[error.name] : null;
	if (!outcome && /domain is not verified|verify your domain/i.test(message)) outcome = SEND_OUTCOMES.domainUnverified;
	outcome ??= getStatusOutcome(error?.statusCode);
	const retryAfter = Number.parseInt(headers?.["retry-after"], 10) || RETRY_AFTER[error?.name];
	return providerError(outcome, `Resend: ${message}`, {
		...(outcome === SEND_OUTCOMES.throttled && retryAfter && { retryAfter }),
		providerCode: error?.name ?? null,
	});
}
