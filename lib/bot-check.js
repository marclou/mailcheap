import "server-only";
import { checkBotId } from "botid/server";

// Vercel BotID at its Basic level, which is free: a page with a form bots abuse starts its check in the browser
// (components/ScriptBotId.jsx), and the form's action asks Vercel whether a browser really sent it. Only on Vercel: a
// self-hosted server elsewhere keeps the forms' rate limits and nothing else changes.
export function isBotIdEnabled() {
	return process.env.VERCEL === "1";
}

// The requests each page's check covers. A newsletter's website sends its signup form to the page it's on: the home
// page, an issue's or an author's on the newsletter's host, or under /archive on MailCheap's own.
export const BOTID_SIGNIN = [{ path: "/signin", method: "POST" }];
export const BOTID_WEBSITE = ["/", "/p/*", "/authors/*", "/archive/*"].map((path) => ({ path, method: "POST" }));

// Whether Vercel says a bot sent this form. When the check itself fails (BotID down, a misconfiguration), the form goes
// through: a BotID problem never costs a signup or a sign-in. Refusals are logged with "[botid]".
export async function isBotRequest(form) {
	if (!isBotIdEnabled()) return false;
	try {
		const { isBot } = await checkBotId();
		if (isBot) console.warn(`[botid] Refused a ${form} that no browser sent`);
		return isBot;
	} catch (error) {
		console.error(`[botid] Couldn't check a ${form}:`, error.message);
		return false;
	}
}
