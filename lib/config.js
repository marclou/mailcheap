export const APP_NAME = "MailCheap";
export const MIN_SECRET_LENGTH = 32;
export const SUPPORT_EMAIL = "hello@mailcheap.ai";
// MailCheap Cloud's own emails go out from a subdomain, so their sending reputation stays apart from mailcheap.ai's.
const CLOUD_SENDER = "hello@r.mailcheap.ai";

// MailCheap Cloud (mailcheap.ai) is this same code with MAILCHEAP_CLOUD=true: billing, the public site and its
// branding. Anything else is a self-hosted server: no billing, and only the allowlist signs in.
export function isCloud(env = process.env) {
	return env.MAILCHEAP_CLOUD === "true";
}

// Without them the cloud couldn't bill, and its own emails (sign-in codes, alerts) would have no way out.
const CLOUD_REQUIRED = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"];

// BETTER_AUTH_SECRET signs sessions and, through keys derived from it, every link in sent emails, and
// SUPPRESSION_HASH_KEY keys the never-email list every account shares, so a short one keeps the server from starting.
export function getConfigProblems(env = process.env) {
	const problems = [];
	for (const name of ["BETTER_AUTH_SECRET", "SUPPRESSION_HASH_KEY"]) {
		if ((env[name] ?? "").length >= MIN_SECRET_LENGTH) continue;
		problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (generate one with: openssl rand -base64 48).`);
	}
	const missing = isCloud(env) ? CLOUD_REQUIRED.filter((name) => !String(env[name] ?? "").trim()) : [];
	if (missing.length > 0) {
		problems.push(
			`MAILCHEAP_CLOUD is true, so ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} to be set: the cloud bills through Stripe and sends its own emails through Resend.`
		);
	}
	return problems;
}

// Rotating it signs everyone out, breaks the unsubscribe, confirmation and tracking links in sent emails, forgets
// which deleted contacts had unsubscribed (lib/contacts.js), and changes the TXT record of website domains still
// being set up (lib/website-domain-rules.js).
export function getAppSecret() {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required to sign sessions and links");
	return secret;
}

// Its own secret, never BETTER_AUTH_SECRET. Changing it forgets the never-email list (lib/global-suppressions.js).
export function getSuppressionHashKey() {
	const key = process.env.SUPPRESSION_HASH_KEY;
	if (!key) throw new Error("SUPPRESSION_HASH_KEY is required to hash the never-email list");
	return key;
}

// From address of MailCheap's own emails (sign-in codes, alerts). A self-hosted server has no default: its
// EMAIL_FROM has to be on a domain its Resend account or email provider verified.
export function getEmailFrom(env = process.env) {
	const from = String(env.EMAIL_FROM ?? "").trim();
	if (from) return from;
	return isCloud(env) ? `${APP_NAME} <${CLOUD_SENDER}>` : null;
}

// Replies to MailCheap Cloud's own emails reach support; a self-hosted server leaves them to EMAIL_FROM.
export function getEmailReplyTo(env = process.env) {
	return isCloud(env) ? SUPPORT_EMAIL : null;
}

// Replies to the emails telling an owner they can't send and only an admin can change it (lib/alerts.js isUrgent) go
// to URGENT_REPLY_TO, an admin's own inbox. One that isn't an address would make those emails fail: the usual one then.
export function getUrgentReplyTo(env = process.env) {
	const address = String(env.URGENT_REPLY_TO ?? "").trim();
	return /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(address) ? address : getEmailReplyTo(env);
}

function readList(value) {
	return String(value ?? "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export function getAdminEmails(env = process.env) {
	return readList(env.ADMIN_EMAILS);
}

// Who signs in to a self-hosted server: ALLOWED_EMAILS (addresses, and @example.com for a whole domain) and
// ADMIN_EMAILS. Nobody else, so with both empty nobody does. MailCheap Cloud takes anyone.
export function isEmailAllowed(email, env = process.env) {
	if (isCloud(env)) return true;
	const address = String(email ?? "").trim().toLowerCase();
	const at = address.lastIndexOf("@");
	if (at < 1 || at === address.length - 1) return false;
	const domain = address.slice(at);
	return [...readList(env.ALLOWED_EMAILS), ...getAdminEmails(env)].some((entry) => entry === address || entry === domain);
}

export function isSendingEnabled() {
	return process.env.SENDING_ENABLED === "true";
}

export const EMAIL_PROVIDER_IDS = ["postshiba", "ses", "sendhq"];

// Customer emails go through PostShiba once its key is set, else Amazon SES. EMAIL_PROVIDER picks one
// explicitly; anything else is null, and sending refuses to guess.
export function getEmailProviderId(env = process.env) {
	const id = String(env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
	if (!id) return env.POSTSHIBA_API_KEY ? "postshiba" : "ses";
	return EMAIL_PROVIDER_IDS.includes(id) ? id : null;
}

// On Vercel, the project's production domain stands in until APP_URL is set.
export function getAppUrl() {
	const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
	return (process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")).replace(/\/$/, "");
}

export function getAppHost() {
	return new URL(getAppUrl()).host.toLowerCase();
}

// Customers without their own domain send from hello@<slug>.<shared domain>, a subdomain in their own tenant,
// and get <slug>.<shared domain> for their archive and links. Unset, newsletters send from a domain of their
// own, and links and archives stay on APP_URL until a website domain goes live.
export function getSharedDomain() {
	return String(process.env.SHARED_DOMAIN ?? "").trim().toLowerCase() || null;
}

// The domain Google Postmaster Tools reads: one that DKIM-signs every customer email. MailCheap Cloud's shared domain,
// mailcheap.ai, is PostShiba's primary domain, which co-signs every one, own domains included.
export function getPostmasterDomain(env = process.env) {
	return String(env.POSTMASTER_DOMAIN || env.SHARED_DOMAIN || "").trim().toLowerCase() || null;
}

// What a newsletter's website domain points at with a CNAME. Unset, the server doesn't put websites on customers'
// domains.
export function getArchiveCnameTarget() {
	return String(process.env.ARCHIVE_CNAME_TARGET ?? "").trim().toLowerCase() || null;
}

// The SES account's rate, shared by every customer and every kind of email: a new production account
// starts at 14 emails/s. Each email costs about 9 database operations.
function readSendRate() {
	const rate = Number.parseInt(process.env.SEND_RATE_PER_SECOND, 10);
	return Number.isInteger(rate) && rate >= 1 && rate <= 1000 ? rate : 14;
}

// Hard bounces and spam complaints out of emails sent (lib/rate-levels.js), each level with a minimum count so one
// complaint or a few bounces never stop anything. pause: a campaign pauses and its owner is warned. block: clear
// abuse, the whole account stops until an admin unblocks it; 0.3% is Gmail's spam rate line, 5% where SES reviews.
export const LIMITS = {
	pause: { bounceRate: 0.025, minBounces: 5, complaintRate: 0.0008, minComplaints: 2 },
	block: { bounceRate: 0.05, minBounces: 10, complaintRate: 0.003, minComplaints: 3 },
	maxEmailBytes: 100_000,
	get sendRatePerSecond() {
		return readSendRate();
	},
	// Each newsletter's, on Starter: bigger plans multiply it (lib/plans.js getSignupScale).
	welcomeEmailsPer10Minutes: 100,
};

// Gmail never reports a single complaint, only spam rates out of the emails it delivered to the inbox, through Google
// Postmaster Tools (lib/postmaster.js). Google asks senders to stay under 0.1% and never reach 0.3%. The domain's rate at
// alertRate alerts the admins; an account Gmail's feedback loop flags pauses and blocks at the complaint levels above.
// Gmail's data for a day comes a day or two later, so the check reads the last week and acts on its newest day once. It
// keeps the domain's rate for each day it read, the last keepDays.
export const POSTMASTER = {
	alertRate: 0.001,
	pauseRate: LIMITS.pause.complaintRate,
	blockRate: LIMITS.block.complaintRate,
	lookbackDays: 7,
	keepDays: 120,
};

// Contacts an account never emailed go out in steps (lib/first-send.js): 2% of them first, then 5% more, then the rest,
// each step 30 minutes after the one before and only if the new contacts so far have few bounces and complaints. Most
// bounces come back within minutes, so a bought or scraped list stops after a few hundred emails, before it costs the
// sending reputation every other customer shares. With no more than the first step's minimum, they all go at once.
export const FIRST_SEND = {
	steps: [
		{ share: 0.02, min: 200, max: 1000 },
		{ share: 0.05, min: 200, max: 5000 },
	],
	waitMinutes: 30,
	recheckMinutes: 10,
};

// Gmail is careful with a domain it hasn't seen send before (lib/send-spread.js getSenderPace): on a new domain's first
// day, its first 2,000 Gmail readers get a send at once and the others the next day. New: a newsletter's own subdomain
// of the shared domain, or a domain of its own unless its registry shows it's older than 30 days (lib/domain-age.js).
// Other inboxes aren't held back.
export const SENDER_WARMUP = { gmailFirstDay: 2000, newDomainDays: 30 };

// Gmail rate limiting a newsletter's domain (lib/send-backoff.js): its sends pause for 6 hours, then Gmail gets half the
// emails the domain sent it in the day before, spread over the day, twice as many the next, for 3 days.
export const BACKOFF = { hours: 6, days: 3, minFirstDay: 200 };
