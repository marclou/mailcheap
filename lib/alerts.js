import { isNull, lt, or } from "drizzle-orm";
import { getAppUrl, isSendingEnabled } from "./config.js";
import { getDb } from "./db.js";
import { sendEmail } from "./email.js";
import { alerts } from "./schema.js";

// No Next.js imports: the sender function raises alerts too. Activity notices are in lib/notify-activity.js.
const DEFAULT_COOLDOWN_MINUTES = 60;

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

// Optional: needs ALERT_FROM on a verified domain, and goes out only while sending is on.
export async function sendAlertEmail({ title, text }) {
	const { ALERT_FROM: from, ADMIN_EMAIL: to } = process.env;
	if (!from || !to || !isSendingEnabled()) return;
	await sendEmail({
		from,
		to,
		subject: `[Mailcheap] ${title}`,
		text,
		html: `<pre style="font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
	});
}

// The upsert only writes once the cooldown is over; inside it, the conflict matches nothing and no row returns.
async function claimAlert({ key, title, cooldownMinutes }) {
	const now = new Date();
	const cutoff = new Date(now.getTime() - cooldownMinutes * 60_000);
	const claimed = await getDb()
		.insert(alerts)
		.values({ key, title, lastSentAt: now })
		.onConflictDoUpdate({
			target: alerts.key,
			set: { title, lastSentAt: now, updatedAt: now },
			setWhere: or(lt(alerts.lastSentAt, cutoff), isNull(alerts.lastSentAt)),
		})
		.returning({ key: alerts.key });
	return claimed.length > 0;
}

// Never throws: a failing alert must not break a send or a webhook. Always logged; emailed to
// ADMIN_EMAIL at most once per cooldown.
export async function sendAlert({ key, title, detail, path = "", cooldownMinutes = DEFAULT_COOLDOWN_MINUTES }) {
	console.warn(`[alert] ${title}: ${detail}`);
	try {
		if (!(await claimAlert({ key, title, cooldownMinutes }))) return;
		await sendAlertEmail({ title, text: `${title}\n${detail}\n${getAppUrl()}${path}` });
	} catch (error) {
		console.error("[alert] Could not send:", error?.message);
	}
}

