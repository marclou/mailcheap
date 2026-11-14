import "server-only";
import { getAppUrl, getEmailProviderId, getWorkspaceMailbox } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { handleEmailEvent } from "@/lib/email-events";
import { parseBounce } from "@/lib/email-provider/workspace-rules";
import { readWorkspaceBounces } from "@/lib/google-workspace";
import { publishJob } from "@/lib/sending";
import Event from "@/models/Event";
import MailboxCursor from "@/models/MailboxCursor";
import Message from "@/models/Message";

// A Google Workspace mailbox sends no events: its bounces are emails in its inbox, read after each batch and every hour,
// from where the last read stopped. The first read, or one after the folder's UIDs started over, looks back a few days.
const CURSOR_ID = "workspace-bounces";
const LOOK_BACK_MS = 4 * 24 * 60 * 60 * 1000;
// Bounces come back within days; one about an older email is someone else's doing.
const MAX_BOUNCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Each read stops here and the next one goes on, so a flood of notifications can't hold the job past its time.
const MAX_PER_READ = 500;
const READ_AFTER_SECONDS = 15 * 60;

function isActive() {
	return getEmailProviderId() === "workspace" && Boolean(getWorkspaceMailbox());
}

// Anyone can write to the inbox, and every reader of an email has its signed header. So a notification only counts for
// the email it quotes, and only for that email's own address, within days of its send; and it never does more than
// suppress that address for that account (isForgeable, lib/email-event-rules.js). Each counts once: its event is
// recorded with the notification's own id.
async function applyBounce({ bounce, uid, receivedAt }) {
	const { accountId, messageId, id, recipient, ...event } = bounce;
	const message = await Message.findOne({ accountId, _id: messageId }).select({ email: 1, sentAt: 1 }).lean();
	if (!message?.sentAt || recipient !== message.email) return "unknown";
	if (receivedAt - new Date(message.sentAt) > MAX_BOUNCE_AGE_MS) return "unknown";
	const providerEventId = `workspace:${id ?? uid}`;
	if (await Event.exists({ accountId, providerEventId })) return "seen";
	await handleEmailEvent({
		...event,
		isForgeable: true,
		accountId,
		messageId,
		providerEventId,
		email: message.email,
		emails: [message.email],
		occurredAt: receivedAt,
	});
	return "bounced";
}

export async function readBounces({ now = new Date() } = {}) {
	if (!isActive()) return { skipped: "not the email provider" };
	await connectDb();
	const cursor = await MailboxCursor.findById(CURSOR_ID).lean();
	const { uidValidity, emails } = await readWorkspaceBounces({
		since: new Date(now.getTime() - LOOK_BACK_MS),
		afterUid: cursor?.lastUid ?? 0,
		uidValidity: cursor?.uidValidity ?? null,
		limit: MAX_PER_READ,
	});
	const result = { read: emails.length, bounced: 0, seen: 0, unknown: 0 };
	let lastUid = cursor?.uidValidity === uidValidity ? (cursor?.lastUid ?? 0) : 0;
	for (const { source, uid, receivedAt } of emails) {
		const bounce = parseBounce(source);
		result[bounce ? await applyBounce({ bounce, uid, receivedAt }) : "unknown"]++;
		lastUid = Math.max(lastUid, uid);
	}
	await MailboxCursor.updateOne({ _id: CURSOR_ID }, { $set: { uidValidity, lastUid } }, { upsert: true });
	return result;
}

// The hourly cron's part: a mailbox that doesn't answer is tried again the next hour.
export async function readBouncesQuietly() {
	try {
		return await readBounces();
	} catch (error) {
		console.error(`[workspace] Bounces not read: ${error.message}`);
		return { error: "unreadable" };
	}
}

// After a batch went out: one look at the inbox a few minutes later, whatever the number of batches in between.
export async function scheduleBounceRead(now = Date.now()) {
	if (!isActive()) return;
	const notBefore = Math.floor(now / 1000) + READ_AFTER_SECONDS;
	try {
		await publishJob({
			url: `${getAppUrl()}/api/jobs/read-bounces`,
			body: {},
			notBefore,
			deduplicationId: `read-bounces-${Math.floor(notBefore / READ_AFTER_SECONDS)}`,
		});
	} catch (error) {
		console.error(`[workspace] Bounce read not scheduled: ${error.message}`);
	}
}
