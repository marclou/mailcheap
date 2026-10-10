import "server-only";
import { after } from "next/server";

// Wakes the sender Neon Function after a send starts, so the first emails go out now instead of at the
// next cron tick. The function answers at once and drains in the background (waitUntil).
const KICK_TIMEOUT_MS = 10_000;

export function kickSender() {
	const url = process.env.SENDER_URL || process.env.NEON_FUNCTION_SENDER_BASE_URL;
	const secret = process.env.SENDER_SECRET;
	after(async () => {
		if (!url || !secret) {
			// Local dev without `neon dev`: drain right here, like the old unsigned QStash jobs.
			if (process.env.NODE_ENV === "development") {
				const { drainQueue } = await import("@/lib/sender");
				const result = await drainQueue({ budgetMs: 5 * 60_000 });
				console.info(`[sender] Local drain: ${JSON.stringify(result)}`);
				return;
			}
			console.warn("[sender] SENDER_URL or SENDER_SECRET is not set. The cron tick will pick the send up");
			return;
		}
		try {
			const response = await fetch(`${url.replace(/\/$/, "")}/drain`, {
				method: "POST",
				headers: { "x-secret": secret },
				signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
			});
			if (!response.ok) console.error(`[sender] Kick answered ${response.status}`);
		} catch (error) {
			console.error("[sender] Kick failed, the cron tick will pick the send up:", error.message);
		}
	});
}
