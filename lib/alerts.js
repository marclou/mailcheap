import "server-only";
import { headers } from "next/headers";
import { findOwnerEmail } from "@/lib/accounts";
import { formatActivity } from "@/lib/activity";
import { ALERT_OCCURRENCES_KEPT, isDashboardAlert, isTelegramAlert, maskEmails } from "@/lib/alert-rules";
import { getAdminAlertEmails, getAppUrl, getUrgentReplyTo } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { canSendPlatformEmail, sendPlatformEmail } from "@/lib/platform-email";
import { joinSentences } from "@/lib/notification-rules";
import { notify } from "@/lib/notifications";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { getSupportChatUrl } from "@/lib/support";
import { formatTelegramAlert, isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import Alert from "@/models/Alert";

const DEFAULT_COOLDOWN_MINUTES = 60;
const TELEGRAM_COOLDOWN_MINUTES = 6 * 60;
const TELEGRAM_ON_KEY = "telegram-on";
const TELEGRAM_SUMMARY =
	"Only what needs you comes here: account blocks, PostShiba stopping sends, customers it stops from sending, Gmail's spam rate over 0.1%, codes not sending, failing Stripe webhooks and jobs, the DNS helper, shared addresses, the inbound cap, issues the content check holds for your review, and affiliate payouts and referrals waiting for you.";
// A blip that the sender's own retry fixes doesn't alert: the third failure in an hour does.
const REPEATED_FAILURES = { limit: 2, window: "1 h", key: "all" };
const MAX_OCCURRENCE_TEXT = 600;

// An account's alerts go to its owner, platform alerts to ADMIN_ALERT_EMAILS or else ADMIN_EMAILS (lib/config.js), as
// MailCheap's own emails (lib/platform-email.js).
async function emailAlert({ accountId, title, text, isUrgent }) {
	if (!canSendPlatformEmail()) return;
	const recipients = accountId ? [await findOwnerEmail(accountId)].filter(Boolean) : getAdminAlertEmails();
	const replyTo = accountId && isUrgent ? { replyTo: getUrgentReplyTo() } : {};
	await Promise.all(recipients.map((to) => sendPlatformEmail({ to, subject: `[MailCheap] ${title}`, text, ...replyTo })));
}

// The upsert only matches once the cooldown is over; inside it, the insert hits the unique key.
async function claimAlert({ accountId, key, title, cooldownMinutes }) {
	const now = new Date();
	const cutoff = new Date(now.getTime() - cooldownMinutes * 60_000);
	try {
		await Alert.updateOne(
			{ accountId: accountId ?? null, key, $or: [{ lastSentAt: { $lt: cutoff } }, { lastSentAt: null }] },
			{ $set: { title, lastSentAt: now } },
			{ upsert: true }
		);
		return true;
	} catch (error) {
		if (error?.code === 11000) return false;
		throw error;
	}
}

// The same for Telegram, on the same document: sent before the cutoff, or never.
async function claimTelegram(key, cutoff) {
	try {
		await Alert.updateOne(
			{ accountId: null, key, $or: [{ telegramSentAt: { $lt: cutoff } }, { telegramSentAt: null }] },
			{ $set: { telegramSentAt: new Date() } },
			{ upsert: true }
		);
		return true;
	} catch (error) {
		if (error?.code === 11000) return false;
		throw error;
	}
}

// Each time an alert fires, inside its cooldown too: what it said, for the admin page's "Needs a look"
// (lib/admin-alerts.js), the only place an alert for the admin page alone shows. Never throws.
async function recordOccurrence({ accountId, key, title, detail, action, emailed, telegram }) {
	const at = new Date();
	const occurrence = {
		at,
		detail: maskEmails(detail).slice(0, MAX_OCCURRENCE_TEXT),
		action: maskEmails(action).slice(0, MAX_OCCURRENCE_TEXT),
		emailed: Boolean(emailed),
		telegram: Boolean(telegram),
	};
	try {
		await Alert.updateOne(
			{ accountId: accountId ?? null, key },
			{
				$set: { title, lastSeenAt: at },
				$inc: { count: 1 },
				$push: { occurrences: { $each: [occurrence], $slice: -ALERT_OCCURRENCES_KEPT } },
			},
			{ upsert: true }
		);
	} catch (error) {
		console.error("[alert] Could not record:", error?.message);
	}
}

// A message that didn't go out leaves its turn to the next one.
async function sendTelegramAlert(key, alert) {
	try {
		await sendTelegramMessage(formatTelegramAlert(alert));
	} catch (error) {
		await Alert.updateOne({ accountId: null, key }, { $unset: { telegramSentAt: 1 } });
		throw error;
	}
}

// Never throws: a failing alert must not break a send or a webhook. Always logged; emailed at most once per cooldown,
// except the admin alerts only for the admin page. The admin alerts that need an admin (lib/alert-rules.js) go to
// Telegram too, at most once every 6 hours. An account's alerts show in its dashboard's notifications each time
// they're emailed, even on a server that can't send email (lib/notifications.js). action: what to do, on a line of its
// own. link: a page outside the app, in place of path. isUrgent: an owner's alert that they can't send and only an
// admin can change it, whose replies go to an admin's own inbox (lib/config.js getUrgentReplyTo). domain: the website
// it's about, whose favicon the notification shows.
export async function sendAlert({
	accountId,
	key,
	title,
	detail,
	action = "",
	path = "",
	link = "",
	cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
	isUrgent = false,
	domain = "",
}) {
	console.warn(`[alert]${accountId ? ` account ${accountId}:` : ""} ${title}: ${[detail, action].filter(Boolean).join(" ")}`);
	try {
		await connectDb();
		const url = link || `${getAppUrl()}${path}`;
		const isEmailDue = !isDashboardAlert({ accountId, key }) && (await claimAlert({ accountId, key, title, cooldownMinutes }));
		const isTelegramDue =
			isTelegramAlert({ accountId, key }) &&
			isTelegramConfigured() &&
			(await claimTelegram(key, new Date(Date.now() - TELEGRAM_COOLDOWN_MINUTES * 60_000)));
		await recordOccurrence({ accountId, key, title, detail, action, emailed: isEmailDue, telegram: isTelegramDue });
		const text = `${[title, detail, action, url].filter(Boolean).join("\n")}${accountId ? getSupportLine(url) : ""}`;
		const deliveries = await Promise.allSettled([
			isEmailDue && emailAlert({ accountId, title, text, isUrgent }),
			isTelegramDue && sendTelegramAlert(key, { title, lines: [detail, action, (link || path) && url] }),
			isEmailDue && accountId && notify({ accountId, key, title, body: joinSentences([detail, action]), path: link ? "" : path, domain }),
		]);
		for (const { status, reason } of deliveries) {
			if (status === "rejected") console.error("[alert] Could not send:", reason?.message);
		}
	} catch (error) {
		console.error("[alert] Could not send:", error?.message);
	}
}

// An owner's alerts end with the support chat, where questions get answered, unless their own link already opens it.
function getSupportLine(url) {
	const chatUrl = getSupportChatUrl();
	return chatUrl && chatUrl !== url ? `\n\nQuestions? Chat with us: ${chatUrl}` : "";
}

// For what its sender retries on its own (a webhook): only failing again and again needs an admin.
export async function sendAlertIfRepeated(name, alert) {
	if (await isRateLimited({ name: `${name}-failures`, ...REPEATED_FAILURES })) await sendAlert(alert);
}

// The admin alerts of a kind that fired within the last minutes: one per account for a kind whose key names it.
// Never throws.
export async function countRecentAlerts(kind, minutes) {
	try {
		await connectDb();
		return await Alert.countDocuments({
			accountId: null,
			key: { $regex: `^${kind}:` },
			lastSeenAt: { $gte: new Date(Date.now() - minutes * 60_000) },
		});
	} catch (error) {
		console.error("[alert] Could not count:", error?.message);
		return 0;
	}
}

// Once ever, as soon as the token and the chat are set: the proof they work, and what comes there. Tried again until
// it goes out.
export async function announceTelegram() {
	if (!isTelegramConfigured()) return { skipped: "Telegram isn't set up" };
	await connectDb();
	if (!(await claimTelegram(TELEGRAM_ON_KEY, new Date(0)))) return { skipped: "already announced" };
	try {
		await sendTelegramAlert(TELEGRAM_ON_KEY, { title: "Telegram alerts are on", lines: [TELEGRAM_SUMMARY] });
	} catch (error) {
		console.error("[alert] Telegram's first message failed:", error.message);
		return { failed: error.message };
	}
	return { announced: true };
}

// Sign-ins, new API keys and sends, every time, in the logs with where they came from.
export async function notifyActivity(lines, { accountId, withUserAgent = false } = {}) {
	try {
		const list = await headers();
		const text = formatActivity(lines, {
			ip: getClientIp(list),
			country: list.get("x-vercel-ip-country"),
			userAgent: withUserAgent ? (list.get("user-agent") ?? "") : undefined,
		});
		console.info(`[activity]${accountId ? ` account ${accountId}:` : ""} ${text.replaceAll("\n", " | ")}`);
	} catch (error) {
		console.error("[alert] Activity notice failed:", error?.message);
	}
}
