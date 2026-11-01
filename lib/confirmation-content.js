import { CONFIRM_URL_PLACEHOLDER } from "./action-links.js";
import { formatSentence } from "./format.js";
import { htmlButton, htmlParagraph, isSameEmail, readEmail, toEmailContent } from "./newsletter-emails.js";
import { renderEmail } from "./render-email.js";

export { CONFIRM_URL_PLACEHOLDER };
const CONFIRM_LINK = `href="${CONFIRM_URL_PLACEHOLDER}"`;
const NEXT_STEP = "Confirm your email and the next issue lands in your inbox.";
export const CONFIRM_BUTTON_TEXT = "Confirm my subscription";

// The built-in email, and where a newsletter's own version starts, in the editor's HTML. Kept short: one job, one button.
function getDefaultConfirmation(newsletter) {
	const name = newsletter?.name?.trim() || "the newsletter";
	const description = formatSentence(newsletter?.description);
	const intro = `You asked to get ${name}.`;
	return {
		subject: `Confirm your subscription to ${name}`,
		previewText: `One click and you're in. Until then, you won't get ${name}.`,
		format: "rich",
		html: [
			htmlParagraph("One click and you're in.", { isBold: true }),
			...(description ? [htmlParagraph(`${intro} ${description}`), htmlParagraph(NEXT_STEP)] : [htmlParagraph(`${intro} ${NEXT_STEP}`)]),
			htmlButton(CONFIRM_URL_PLACEHOLDER, CONFIRM_BUTTON_TEXT),
			htmlParagraph("Didn't sign up? Ignore this email and you won't hear from us again."),
		].join(""),
	};
}

export function isDefaultConfirmation(confirmation, ...newsletters) {
	return newsletters.some((newsletter) => isSameEmail(confirmation, getDefaultConfirmation(newsletter)));
}

// Markdown links encode the braces (%7B%7B), so in Markdown only an HTML link keeps the placeholder; in the editor, a
// button or a link to it does.
export function getConfirmationProblem(confirmation) {
	if (!confirmation?.subject?.trim()) return "Confirmation email needs a subject";
	if (!renderEmail(toEmailContent(confirmation)).html.includes(CONFIRM_LINK)) {
		return `Confirmation email needs its button: a link to ${CONFIRM_URL_PLACEHOLDER}, which becomes each subscriber's own link`;
	}
	return null;
}

// The newsletter's own confirmation email, or null without one that keeps its button.
export function getOwnConfirmation(newsletter) {
	const custom = newsletter?.confirmation && readEmail(newsletter.confirmation);
	return custom && !getConfirmationProblem(custom) ? toEmailContent(custom) : null;
}

// What a new subscriber gets when their newsletter asks them to confirm. It's the only email they get,
// so a newsletter can write its own; without one, if it lost its button, or while the content check holds it
// (builtIn), the built-in one goes out.
export function getConfirmationContent(newsletter, { builtIn = false } = {}) {
	return (!builtIn && getOwnConfirmation(newsletter)) || toEmailContent(getDefaultConfirmation(newsletter));
}
