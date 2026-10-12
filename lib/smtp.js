import "server-only";
import nodemailer from "nodemailer";

// Optional SMTP transport (Stalwart, Postfix, Mailgun SMTP...). When SMTP_HOST is set, every email goes
// through it instead of SES. SES-only features don't apply: no SNS events, so bounces and complaints
// aren't recorded and the send-pause thresholds never trip. Watch the server's own bounce reports.

let transport = null;

export function isSmtpConfigured() {
	return Boolean(process.env.SMTP_HOST);
}

// Domains you send from, comma-separated. Stand in for SES's verified identities in the pre-send checks.
export function getSmtpDomains() {
	return (process.env.SMTP_DOMAINS || "")
		.split(",")
		.map((domain) => domain.trim().toLowerCase())
		.filter(Boolean);
}

function getTransport() {
	transport ??= nodemailer.createTransport({
		host: process.env.SMTP_HOST,
		port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
		// true for implicit TLS (465). On 587 the connection upgrades with STARTTLS, required below.
		secure: process.env.SMTP_SECURE === "true",
		requireTLS: process.env.SMTP_SECURE !== "true",
		auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
		// Only for an internal relay whose certificate can't match its Docker hostname.
		tls: { rejectUnauthorized: process.env.SMTP_TLS_VERIFY !== "false" },
		pool: true,
		maxConnections: 2,
	});
	return transport;
}

export async function sendSmtpEmail({ from, to, replyTo, subject, html, text, headers = {} }) {
	const info = await getTransport().sendMail({ from, to, replyTo, subject, html, text, headers });
	if (info.rejected?.length) throw new Error(`SMTP server rejected ${info.rejected.join(", ")}`);
	return { sesMessageId: info.messageId };
}
