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

// On Vercel, the project's production domain stands in until APP_URL is set.
export function getAppUrl() {
	const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
	return (process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")).replace(/\/$/, "");
}

// Amazon SES or Resend. Without EMAIL_PROVIDER, a Resend API key picks Resend.
export const EMAIL_PROVIDERS = {
	ses: { label: "SES", name: "Amazon SES" },
	resend: { label: "Resend", name: "Resend" },
};

export function getEmailProvider(env = process.env) {
	const name = String(env.EMAIL_PROVIDER || (env.RESEND_API_KEY ? "resend" : "ses")).trim().toLowerCase();
	return Object.hasOwn(EMAIL_PROVIDERS, name) ? name : "ses";
}

// New SES accounts in production start at 14 emails/s. Resend allows 10 API requests/s per team by default,
// shared with welcome emails and alerts, so it starts a little under that. Both can be raised on request.
const SEND_RATES = { ses: { fallback: 10, max: 14 }, resend: { fallback: 8, max: 100 } };

export function readSendRate(env = process.env) {
	const { fallback, max } = SEND_RATES[getEmailProvider(env)];
	const rate = Number.parseInt(env.SEND_RATE_PER_SECOND, 10);
	return Number.isInteger(rate) && rate >= 1 && rate <= max ? rate : fallback;
}

// SES reviews an account at 5% bounces or 0.1% complaints; pause well before that.
export const LIMITS = {
	bounceRate: 0.02,
	complaintRate: 0.0008,
	maxEmailBytes: 100_000,
	sendRatePerSecond: readSendRate(),
	welcomeEmailsPer10Minutes: 100,
};
