import { KEEP_URL_PLACEHOLDER } from "./action-links.js";
import { htmlButton, htmlParagraph, isSameEmail, readEmail, toEmailContent } from "./newsletter-emails.js";
import { renderEmail } from "./render-email.js";

export { KEEP_URL_PLACEHOLDER };
const KEEP_LINK = `href="${KEEP_URL_PLACEHOLDER}"`;
export const KEEP_BUTTON_TEXT = "Yes, keep sending it";

// What a cold contact gets instead of an issue (lib/cleanup.js), and where a newsletter's own version starts, in the
// editor's HTML. One question, one button.
function getDefaultLastChance(newsletter) {
	const name = newsletter?.name?.trim() || "this newsletter";
	return {
		subject: `Do you still want ${name}?`,
		previewText: "Click the button, and it keeps coming.",
		format: "rich",
		html: [
			htmlParagraph(`Do you still want ${name}?`, { isBold: true }),
			htmlParagraph("You haven't opened it in a while, so I'm checking before I stop sending it."),
			htmlButton(KEEP_URL_PLACEHOLDER, KEEP_BUTTON_TEXT),
			htmlParagraph(`If I don't hear from you, this is the last ${name} email you'll get.`),
		].join(""),
	};
}

export function isDefaultLastChance(lastChance, ...newsletters) {
	return newsletters.some((newsletter) => isSameEmail(lastChance, getDefaultLastChance(newsletter)));
}

export function getLastChanceProblem(lastChance) {
	if (!lastChance?.subject?.trim()) return "Last-chance email needs a subject";
	if (!renderEmail(toEmailContent(lastChance)).html.includes(KEEP_LINK)) {
		return `Last-chance email needs its button: a link to ${KEEP_URL_PLACEHOLDER}, which keeps each contact who clicks it`;
	}
	return null;
}

// The newsletter's own last-chance email, or null without one that keeps its button.
export function getOwnLastChance(newsletter) {
	const custom = newsletter?.lastChance && readEmail(newsletter.lastChance);
	return custom && !getLastChanceProblem(custom) ? toEmailContent(custom) : null;
}

// The newsletter's own, unless the content check holds it (builtIn): then, or without one, the built-in one goes out.
export function getLastChanceContent(newsletter, { builtIn = false } = {}) {
	return (!builtIn && getOwnLastChance(newsletter)) || toEmailContent(getDefaultLastChance(newsletter));
}
