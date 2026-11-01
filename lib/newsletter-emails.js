import { markdownToHtml } from "./markdown.js";
import { hasContent } from "./render-email.js";

// A newsletter's own emails, which MailCheap sends on its own once they're written: the welcome email, the confirmation
// email and the list cleanup's last-chance email. Each has a subject, a preview text and a body written in the editor
// (rich, its HTML, like an issue's) or in Markdown, as they were before the editor and as the API still takes them.
// Stored, the body is in markdown or html, as format says; the settings form and the API have it as { format, content }.
export const EMAIL_FORMATS = ["rich", "markdown"];

// A paragraph that's only a link MailCheap fills in (lib/action-links.js), as the confirmation email had its button
// before the editor: the editor opens it as a button.
const ACTION_LINK_LINE = /<p><a href="(\{\{(?:confirm|keep)_url\}\})"[^>]*>([^<]*)<\/a><\/p>/g;

function readFormat(format) {
	return format === "rich" ? "rich" : "markdown";
}

function normalizeWhitespace(text) {
	return String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.trim();
}

// The stored email, every field there.
export function readEmail(email) {
	return {
		subject: email?.subject ?? "",
		previewText: email?.previewText ?? "",
		format: readFormat(email?.format),
		markdown: email?.markdown ?? "",
		html: email?.html ?? "",
	};
}

// An email as the settings form and the API have it, from any of its shapes: stored, as renderEmail takes it, or already
// this one.
export function toDraftEmail(email) {
	const format = readFormat(email?.format);
	const content = email && "content" in email ? email.content : format === "rich" ? email?.html : email?.markdown;
	return { subject: email?.subject ?? "", previewText: email?.previewText ?? "", format, content: content ?? "" };
}

// A body from the settings form or the API as it's stored: the other format's field emptied.
export function toStoredBody({ format, content = "" }) {
	const isRich = readFormat(format) === "rich";
	return { format: isRich ? "rich" : "markdown", markdown: isRich ? "" : content, html: isRich ? content : "" };
}

// Words or a picture: the editor saves "<p></p>" for an empty email.
export function hasEmailBody(email) {
	const { format, content } = toDraftEmail(email);
	return format === "rich" ? hasContent(content) : Boolean(content.trim());
}

// As it goes out (lib/sending-rules.js buildRecipientEmail) and as previews render it.
export function toEmailContent(email) {
	const { subject, previewText, format, content } = toDraftEmail(email);
	return { format, subject: subject.trim(), previewText: previewText.trim(), [format === "rich" ? "html" : "markdown"]: content };
}

// The same words in the same format, whatever line breaks a browser sent.
export function isSameEmail(first, second) {
	const [a, b] = [toDraftEmail(first), toDraftEmail(second)];
	return a.format === b.format && ["subject", "previewText", "content"].every((key) => normalizeWhitespace(a[key]) === normalizeWhitespace(b[key]));
}

// What the editor opens (components/EditorEmail.jsx): an email written in it as it is, and Markdown as HTML.
export function toEditorHtml(email) {
	const { format, content } = toDraftEmail(email);
	if (format === "rich") return content;
	return markdownToHtml(content).replace(ACTION_LINK_LINE, (_, href, text) => `<div data-button=""><a href="${href}">${text}</a></div>`);
}

// The built-in emails' blocks as the editor writes them, the newsletter's own words in them as text.
export function htmlParagraph(text, { isBold = false } = {}) {
	const html = escapeText(text);
	return `<p>${isBold ? `<strong>${html}</strong>` : html}</p>`;
}

export function htmlButton(href, text) {
	return `<div data-button=""><a href="${href}">${escapeText(text)}</a></div>`;
}

function escapeText(text) {
	return String(text ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
