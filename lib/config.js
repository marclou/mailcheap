export const APP_NAME = "Mailcheap";
export const MIN_SESSION_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

// The admin password guards the only login, and SESSION_SECRET signs sessions and every email link,
// so short ones keep the server from starting and the dashboard from logging in.
export function getConfigProblems(env = process.env) {
	const problems = [];
	if ((env.SESSION_SECRET ?? "").length < MIN_SESSION_SECRET_LENGTH) {
		problems.push(
			`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters (generate one with: openssl rand -base64 48).`
		);
	}
	if ((env.ADMIN_PASSWORD ?? "").length < MIN_ADMIN_PASSWORD_LENGTH) {
		problems.push(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
	}
	return problems;
}

export function isSendingEnabled() {
	return process.env.SENDING_ENABLED === "true";
}

// Optional SMTP transport (lib/smtp.js): with SMTP_HOST set, every email goes through it instead of SES.
export function isSmtpConfigured(env = process.env) {
	return Boolean(env.SMTP_HOST?.trim());
}

// The domains you send from through SMTP, comma-separated. They stand in for SES's verified identities.
export function getSmtpDomains(env = process.env) {
	return [
		...new Set(
			(env.SMTP_DOMAINS || "")
				.split(",")
				.map((domain) => domain.trim().toLowerCase())
				.filter(Boolean)
		),
	];
}

// Optional S3-compatible storage for editor uploads (lib/s3-images.js), instead of Vercel Blob.
export function isS3Configured(env = process.env) {
	return Boolean(env.S3_ENDPOINT?.trim() && env.S3_BUCKET?.trim());
}

// On Vercel, the project's production domain stands in until APP_URL is set.
export function getAppUrl() {
	const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
	return (process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")).replace(/\/$/, "");
}

// New SES accounts in production start at 14 emails/s, shared with welcome emails. Each email costs
// about 9 database operations: a free Atlas cluster (M0, 100 operations/s) needs about 6, Flex handles 12.
function readSendRate() {
	const rate = Number.parseInt(process.env.SEND_RATE_PER_SECOND, 10);
	return Number.isInteger(rate) && rate >= 1 && rate <= 14 ? rate : 10;
}

// SES reviews an account at 5% bounces or 0.1% complaints; pause well before that.
export const LIMITS = {
	bounceRate: 0.02,
	complaintRate: 0.0008,
	maxEmailBytes: 100_000,
	sendRatePerSecond: readSendRate(),
	welcomeEmailsPer10Minutes: 100,
};
