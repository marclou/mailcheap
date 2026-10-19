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

// Rotating it signs everyone out, breaks the unsubscribe, confirmation and tracking links in sent emails, and forgets
// which deleted contacts had unsubscribed (lib/contacts.js).
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

export const EMAIL_PROVIDER_IDS = ["postshiba", "ses", "groundmail"];

// Customer emails go through PostShiba once its key is set, else Amazon SES. EMAIL_PROVIDER picks one
// explicitly, Groundmail included; anything else is null, and sending refuses to guess.
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
// own, and links and archives stay on APP_URL until that domain's archive subdomain points here.
export function getSharedDomain() {
	return String(process.env.SHARED_DOMAIN ?? "").trim().toLowerCase() || null;
}

// The domain Google Postmaster Tools reads: one that DKIM-signs every customer email. MailCheap Cloud's shared domain,
// mailcheap.ai, is PostShiba's primary domain, which co-signs every one, own domains included.
export function getPostmasterDomain(env = process.env) {
	return String(env.POSTMASTER_DOMAIN || env.SHARED_DOMAIN || "").trim().toLowerCase() || null;
}

// What a customer's archive subdomain points at with a CNAME.
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
	pause: { bounceRate: 0.02, minBounces: 5, complaintRate: 0.0008, minComplaints: 2 },
	block: { bounceRate: 0.05, minBounces: 10, complaintRate: 0.003, minComplaints: 3 },
	maxEmailBytes: 100_000,
	get sendRatePerSecond() {
		return readSendRate();
	},
	welcomeEmailsPer10Minutes: 100,
};

// Gmail never reports a single complaint, only spam rates out of the emails it delivered to the inbox, through Google
// Postmaster Tools (lib/postmaster.js). Google asks senders to stay under 0.1% and never reach 0.3%. The domain's rate at
// alertRate alerts the admins; an account Gmail's feedback loop flags pauses and blocks at the complaint levels above.
// Gmail's data for a day comes a day or two later, so the check reads the last week and acts on its newest day once.
export const POSTMASTER = {
	alertRate: 0.001,
	pauseRate: LIMITS.pause.complaintRate,
	blockRate: LIMITS.block.complaintRate,
	lookbackDays: 7,
};

// Contacts an account never emailed go out in steps: a slice of them first, then a check of its bounces and complaints
// 3 hours after it, then the rest (lib/first-send.js). A bought or scraped list shows itself in the slice, before it
// costs the sending reputation every other customer shares.
export const FIRST_SEND = { share: 0.05, minSlice: 200, maxSlice: 2000, waitMinutes: 180, recheckMinutes: 10 };

// How fast MailCheap Cloud sends, earned by clean volume (lib/send-spread.js). Proven volume: the account's largest
// campaign of the last 60 days whose bounces and complaints stayed under LIMITS.pause, a day after it went out, once
// they've had time to come in. A send, with what the account's other sends still have to send or sent in the last day,
// goes at full speed up to 200 emails, or its proven volume times 2 on the first day of its 30-day warm-up, rising to 5
// on its last day and after it. A bigger one goes out over 4 hours plus 4 for each time it doubles that, 72 at most.
export const WARMUP = {
	days: 30,
	quickEmails: 200,
	provenDays: 60,
	recentHours: 24,
	growth: { first: 2, last: 5 },
	minHours: 4,
	hoursPerDoubling: 4,
	maxHours: 72,
};
