import { calloutExtension, inlineCalloutStyles } from "./callouts.js";
import { beforeLastTagEnd, cleanRichHtml, replaceElements } from "./clean-html.js";
import { createMarkdownParser } from "./markdown.js";

export const UNSUBSCRIBE_PLACEHOLDER = "{{unsubscribe_url}}";
// Generated HTML prints these instead of its own copy, so editing the campaign changes the email too.
export const SUBJECT_PLACEHOLDER = "{{subject}}";
export const PREVIEW_TEXT_PLACEHOLDER = "{{preview_text}}";
// Parts only the email needs, like a headline the archive page already shows. One can't contain an
// element with its own tag name.
const EMAIL_ONLY_ELEMENT = {
	start: /<([a-z][a-z0-9]*)\b[^>]*>/gi,
	end: /<\/([a-z][a-z0-9]*)>/gi,
	accepts: ([tag]) => /\sdata-email-only\b/i.test(tag),
};
const HIDDEN_ELEMENT = { start: /<(style|script|head)/gi, end: /<\/(style|script|head)>/gi };
const PREHEADER_ELEMENT = { start: /<(div)\b[^>]*>/gi, end: /<\/(div)>/gi, accepts: ([tag]) => /\bdata-preheader\b/i.test(tag) };
const LINK_HREF_PATTERN = /^<a\s[^>]*href="([^"]+)"/i;
const LINK_ELEMENT = { start: /<(a)\s[^>]*>/gi, end: /<\/(a)>/gi, accepts: ([tag]) => LINK_HREF_PATTERN.test(tag), replace: linkText };
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const parseMarkdown = createMarkdownParser(calloutExtension({ isEmail: true }));

export function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function stripTags(html) {
	return beforeLastTagEnd(html, (part) => part.replace(/<[^>]+>/g, ""));
}

function linkText([tag], label) {
	const href = LINK_HREF_PATTERN.exec(tag)[1];
	const text = stripTags(label).trim();
	return !text || text === href ? href : `${text} (${href})`;
}

export function htmlToText(html) {
	const visible = beforeLastTagEnd(replaceElements(String(html ?? ""), HIDDEN_ELEMENT), (part) =>
		replaceElements(replaceElements(part, PREHEADER_ELEMENT), LINK_ELEMENT)
	);
	const blocks = visible
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n\n");
	return stripTags(beforeLastTagEnd(blocks, (part) => part.replace(/<li[^>]*>/gi, "• ")))
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		// Starting only at the first space of a run, so a long run not ending a line is read once.
		.replace(/(?<![ \t])[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// The editor saves "<p></p>" for an empty document, so content means words or a picture.
export function hasContent(body) {
	return /<img\b/i.test(body ?? "") || htmlToText(body).length > 0;
}

// Some clients drop <style>, so editor content carries its layout inline. Images are centered like
// on the archive, and the paragraph the editor puts inside each list item loses its margin.
function richEmailBody(html) {
	return inlineCalloutStyles(cleanRichHtml(html))
		.replaceAll("<li><p>", '<li><p style="margin:0;">')
		.replace(
			/<img\b/gi,
			'<img width="600" style="display:block;width:auto;max-width:100%;height:auto;margin:24px auto;border-radius:8px;"'
		);
}

// Outlook on Windows sizes an image by its width attribute alone, so a photo wider than the column
// widens it. width:auto keeps every other client at the image's own size, up to the column.
function markdownEmailBody(source) {
	return parseMarkdown(source).replace(/<img\b/gi, '<img width="600" style="width:auto;max-width:100%;height:auto;"');
}

function footerHtml({ newsletter, unsubscribeUrl }) {
	const address = newsletter?.postalAddress
		? `<br>${escapeHtml(newsletter.postalAddress)}`
		: "";
	return `<tr><td style="padding:32px 0 0;font-size:12px;line-height:1.6;color:#71717a;border-top:1px solid #e4e4e7;">
You're receiving this because you subscribed to ${escapeHtml(newsletter?.name || "this newsletter")}.<br>
<a href="${unsubscribeUrl}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>${address}
</td></tr>`;
}

function footerText({ newsletter, unsubscribeUrl }) {
	return [
		"—",
		`You're receiving this because you subscribed to ${newsletter?.name || "this newsletter"}.`,
		`Unsubscribe: ${unsubscribeUrl}`,
		newsletter?.postalAddress,
	]
		.filter(Boolean)
		.join("\n");
}

function preheaderHtml(previewText) {
	if (!previewText) return "";
	// Padding characters stop clients from pulling body text into the inbox preview.
	return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;" data-preheader>${escapeHtml(previewText)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>`;
}

function readOnlineLink(webUrl) {
	return `<a href="${escapeHtml(webUrl)}" style="color:#a1a1aa;text-decoration:none;">Read online</a>`;
}

function fillFields(html, { subject, previewText }) {
	return html
		.replaceAll(SUBJECT_PLACEHOLDER, escapeHtml(subject))
		.replaceAll(PREVIEW_TEXT_PLACEHOLDER, escapeHtml(previewText));
}

function wrapMarkdownBody({ bodyHtml, subject, previewText, footer, webUrl }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
<style>
.body a { color: #18181b; }
.body img { max-width: 100%; height: auto; border-radius: 8px; }
.body h1, .body h2, .body h3 { line-height: 1.3; margin: 32px 0 12px; color: #09090b; }
.body p { margin: 0 0 16px; }
.body ul, .body ol { margin: 0 0 16px 24px; padding: 0; }
.body blockquote { margin: 0 0 16px; padding-left: 16px; border-left: 3px solid #e4e4e7; color: #52525b; }
.body code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f4f4f5; padding: 2px 4px; border-radius: 4px; }
.body hr { border: 0; border-top: 1px solid #e4e4e7; margin: 32px 0; }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${preheaderHtml(previewText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:32px 20px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT_STACK};font-size:16px;line-height:1.65;color:#27272a;">
${webUrl ? `<tr><td align="right" style="padding:0 0 24px;font-size:12px;line-height:1;">${readOnlineLink(webUrl)}</td></tr>\n` : ""}<tr><td class="body">${bodyHtml}</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// Generated HTML (an issue built by another app) keeps its own design and gets the footer appended.
function withFooter({ html, newsletter, unsubscribeUrl, previewText, webUrl }) {
	const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 20px 32px;"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT_STACK};">${footerHtml({ newsletter, unsubscribeUrl })}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table>`;
	// Its column width is unknown, so the link sits centered above it.
	const readOnline = webUrl
		? `<div style="padding:12px 16px 0;text-align:center;font-family:${FONT_STACK};font-size:12px;line-height:1.4;">${readOnlineLink(webUrl)}</div>`
		: "";
	const top = `${preheaderHtml(previewText)}${readOnline}`;
	// Only a <body before the last ">" can match; when one does, so does the first, where the replace stops.
	const hasBody = /<body[^>]*>/i.test(html.slice(0, html.lastIndexOf(">") + 1));
	const withTop = hasBody ? html.replace(/<body[^>]*>/i, (match) => `${match}${top}`) : `${top}${html}`;
	if (withTop.includes(UNSUBSCRIBE_PLACEHOLDER)) return withTop;
	return /<\/body>/i.test(withTop) ? withTop.replace(/<\/body>/i, `${footer}</body>`) : `${withTop}${footer}`;
}

// HTML issues built elsewhere may rely on their own site's CSS to keep images inside the column.
export function withResponsiveImages(html) {
	const style = "<style>img{max-width:100%;height:auto}</style>";
	return beforeLastTagEnd(html, (part) => part.replace(/<head([^>]*)>/i, (head) => `${head}${style}`));
}

export function renderEmail({
	format = "markdown",
	markdown: source = "",
	html = "",
	subject = "",
	previewText = "",
	newsletter,
	unsubscribeUrl = UNSUBSCRIBE_PLACEHOLDER,
	// The issue's archive page, linked at the top of the email.
	webUrl = null,
	// Public archive pages: same design, no subscriber footer.
	isWebVersion = false,
}) {
	const readOnlineUrl = isWebVersion ? null : webUrl;
	if (format === "html") {
		const filled = fillFields(html, { subject, previewText });
		const rendered = isWebVersion
			? beforeLastTagEnd(filled, (part) => replaceElements(part, EMAIL_ONLY_ELEMENT))
			: withFooter({ html: filled, newsletter, unsubscribeUrl, previewText, webUrl: readOnlineUrl });
		const text = htmlToText(rendered.replaceAll(UNSUBSCRIBE_PLACEHOLDER, unsubscribeUrl));
		return { html: rendered, text, bytes: byteLength(rendered) };
	}

	const bodyHtml = format === "rich" ? richEmailBody(html) : markdownEmailBody(source);
	const footer = isWebVersion ? "" : footerHtml({ newsletter, unsubscribeUrl });
	const rendered = wrapMarkdownBody({ bodyHtml, subject, previewText, footer, webUrl: readOnlineUrl });
	const readOnlineText = readOnlineUrl ? `Read online: ${readOnlineUrl}\n\n` : "";
	const text = isWebVersion
		? htmlToText(bodyHtml)
		: `${readOnlineText}${htmlToText(bodyHtml)}\n\n${footerText({ newsletter, unsubscribeUrl })}`;
	return { html: rendered, text, bytes: byteLength(rendered) };
}

function byteLength(value) {
	return new TextEncoder().encode(value).length;
}
