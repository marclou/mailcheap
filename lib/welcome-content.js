import { formatSentence } from "./format.js";
import { hasEmailBody, htmlParagraph } from "./newsletter-emails.js";

// Where the settings form starts a welcome email switched on with no subject and no content, in the editor's HTML. Only
// a prefill: saved welcome emails go out as they are (lib/sending-rules.js). welcome: as the form has it, { subject,
// previewText, format, content }.
export function prefillWelcome(welcome, newsletter) {
	if (welcome.subject.trim() || hasEmailBody(welcome)) return welcome;
	const name = newsletter?.name?.trim() || "the newsletter";
	const intro = [`Thanks for joining ${name}.`, formatSentence(newsletter?.description)].filter(Boolean).join(" ");
	return {
		...welcome,
		subject: `Welcome to ${name}`,
		format: "rich",
		content: [htmlParagraph(intro), htmlParagraph("The next issue lands in your inbox. Hit reply to say hi.")].join(""),
	};
}
