import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { formatActivity } from "@/lib/activity";
import { sendAlertEmail } from "@/lib/alerts";
import { getClientIp } from "@/lib/client-ip";

// Logins, new API keys and sends, every time: logged, and emailed like other alerts. It goes out after
// the response, so a failing alert never holds up or blocks the action.
export async function notifyActivity(lines, { withUserAgent = false } = {}) {
	try {
		const list = await headers();
		const text = formatActivity(lines, {
			ip: getClientIp(list),
			country: list.get("x-vercel-ip-country"),
			userAgent: withUserAgent ? (list.get("user-agent") ?? "") : undefined,
		});
		after(async () => {
			console.info(`[activity] ${text.replaceAll("\n", " | ")}`);
			try {
				await sendAlertEmail({ title: lines[0], text });
			} catch (error) {
				console.error("[alert] Activity notice failed:", error?.message);
			}
		});
	} catch (error) {
		console.error("[alert] Activity notice failed:", error?.message);
	}
}
