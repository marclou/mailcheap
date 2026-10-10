// Pure helpers for lib/resend.js, kept apart so tests can load them.

// Resend reports a domain and each DNS record as not_started, pending, verified, failed or
// temporary_failure. The domains UI speaks SES's words.
const STATUS = {
	verified: "SUCCESS",
	pending: "PENDING",
	not_started: "NOT_STARTED",
	failed: "FAILED",
	temporary_failure: "TEMPORARY_FAILURE",
};

function fullName(name, domain) {
	if (!name || name === "@") return domain;
	return name === domain || name.endsWith(`.${domain}`) ? name : `${name}.${domain}`;
}

// DKIM and the SPF pair (MX + TXT on the bounce subdomain, Resend's return path).
export function toDomainStatus(domain) {
	const records = Array.isArray(domain.records) ? domain.records : [];
	const dkim = records.filter(({ record }) => record === "DKIM");
	const spf = records.filter(({ record }) => record === "SPF");
	const worst = (list) =>
		list.find(({ status }) => status === "failed")?.status ??
		list.find(({ status }) => status !== "verified")?.status ??
		list[0]?.status;
	return {
		domain: domain.name,
		verified: domain.status === "verified",
		dkimStatus: STATUS[worst(dkim)] ?? "NOT_STARTED",
		mailFromDomain: spf[0] ? fullName(spf[0].name, domain.name) : null,
		mailFromStatus: spf.length > 0 ? (STATUS[worst(spf)] ?? "PENDING") : null,
		records: records.map(({ type, name, value, priority }) => ({
			type,
			name: fullName(name, domain.name),
			value: type === "MX" && priority !== undefined ? `${priority} ${value}` : value,
		})),
	};
}

// SES needs RFC 2047 for a non-ASCII sender name (lib/sending-rules.js formatFromAddress). Resend encodes
// names itself and would show the encoded word as it is.
export function toResendFrom(from) {
	const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?= (<[^<>]+>)$/.exec(String(from));
	if (!match) return from;
	return `"${Buffer.from(match[1], "base64").toString("utf8")}" ${match[2]}`;
}
