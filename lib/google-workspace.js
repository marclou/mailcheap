import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { getWorkspaceMailbox, isSendingEnabled } from "@/lib/config";
import { isConnectionError } from "@/lib/email-provider/workspace-rules";

// Every connection to the Google Workspace mailbox lives in this file: Gmail's SMTP server for sending, and its IMAP
// server for the bounces that come back to the inbox. Tests replace it (tests/stubs/google-workspace.mjs).
const TIMEOUT_MS = 20_000;
// A notification's status and the headers of the email it's about come first: the rest of a quoted email isn't read.
const MAX_BOUNCE_BYTES = 128_000;
const BOUNCE_SENDERS = ["mailer-daemon", "postmaster"];

let transport = null;

function getMailbox() {
	const mailbox = getWorkspaceMailbox();
	if (!mailbox) throw new Error("The Google Workspace mailbox is not configured (WORKSPACE_EMAIL, WORKSPACE_APP_PASSWORD)");
	return mailbox;
}

// One connection, kept between emails: Google refuses a mailbox that signs in for each one.
function getTransport() {
	transport ??= nodemailer.createTransport({
		host: "smtp.gmail.com",
		port: 465,
		secure: true,
		auth: getMailbox(),
		pool: true,
		maxConnections: 1,
		maxMessages: 100,
		connectionTimeout: TIMEOUT_MS,
		greetingTimeout: TIMEOUT_MS,
		socketTimeout: TIMEOUT_MS,
		disableFileAccess: true,
		disableUrlAccess: true,
	});
	return transport;
}

function closeTransport() {
	transport?.close();
	transport = null;
}

// A connection left open by an instance that slept is gone when it wakes: one more try on a new one.
async function send(email) {
	try {
		return await getTransport().sendMail(email);
	} catch (error) {
		closeTransport();
		if (!isConnectionError(error)) throw error;
		return getTransport().sendMail(email);
	}
}

// MailCheap's own emails (sign-in codes, alerts) on a self-hosted server without Resend. SENDING_ENABLED is for
// customers' emails; sign-in codes go before sending is on.
export async function sendWorkspacePlatformEmail({ from, to, subject, text, html, headers, replyTo }) {
	const { messageId } = await send({ from, to, subject, text, html, headers, replyTo });
	return { messageId };
}

export async function sendWorkspaceEmail(email) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	return sendWorkspacePlatformEmail(email);
}

// The delivery notifications that reached the mailbox after a UID (or, without one, since a date), the oldest first, at
// most limit: { uidValidity, emails: [{ uid, receivedAt, source }] }, source being the start of each as text. A
// different uidValidity than the one given means the UIDs started over, and the date applies instead. All Mail has those
// a filter archived.
export async function readWorkspaceBounces({ since, afterUid = 0, uidValidity = null, limit }) {
	const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: getMailbox(), logger: false, socketTimeout: TIMEOUT_MS });
	await client.connect();
	try {
		const folders = await client.list();
		const allMail = folders.find(({ specialUse }) => specialUse === "\\All")?.path ?? "INBOX";
		const lock = await client.getMailboxLock(allMail, { readOnly: true });
		try {
			const current = String(client.mailbox.uidValidity);
			const isSameFolder = uidValidity === current && afterUid > 0;
			const range = isSameFolder ? { uid: `${afterUid + 1}:*` } : { since };
			const found = await client.search({ ...range, or: BOUNCE_SENDERS.map((from) => ({ from })) }, { uid: true });
			const uids = (found || []).filter((uid) => !isSameFolder || uid > afterUid).sort((a, b) => a - b).slice(0, limit);
			const emails = [];
			if (uids.length === 0) return { uidValidity: current, emails };
			for await (const email of client.fetch(uids, { uid: true, internalDate: true, source: { maxLength: MAX_BOUNCE_BYTES } }, { uid: true })) {
				emails.push({ uid: email.uid, receivedAt: email.internalDate ? new Date(email.internalDate) : new Date(), source: email.source?.toString("utf8") ?? "" });
			}
			return { uidValidity: current, emails: emails.sort((a, b) => a.uid - b.uid) };
		} finally {
			lock.release();
		}
	} finally {
		await client.logout().catch(() => client.close());
	}
}
