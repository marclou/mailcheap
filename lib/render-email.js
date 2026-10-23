import { EMAIL_BOX_TAG, calloutExtension, inlineCalloutStyles } from "./callouts.js";
import { beforeLastTagEnd, cleanRichHtml, replaceElements } from "./clean-html.js";
import { createMarkdownParser } from "./markdown.js";
import { getEmailTheme, resolveTheme } from "./themes.js";

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
const DEFAULT_EMAIL_THEME = getEmailTheme(resolveTheme(null));

const parseMarkdown = createMarkdownParser(calloutExtension({ isEmail: true }));

export function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// HTML's text back to plain text: the common named entities and every numeric one.
export function decodeEntities(value) {
	return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
		if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
		const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
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

// Some clients drop <style>, so editor content carries its layout inline. Images sit where the editor
// put them, centered unless aligned left or right, and the paragraph the editor puts inside each list
// item loses its margin.
function richEmailBody(html, theme) {
	return inlineCalloutStyles(cleanRichHtml(html))
		.replaceAll("<li><p>", '<li><p style="margin:0;">')
		.replace(/<img\b([^>]*)>/gi, (_, attributes) => {
			const align = attributes.match(/\sdata-align="(left|right)"/)?.[1];
			const margin = IMAGE_MARGINS[align] ?? IMAGE_MARGINS.center;
			const kept = attributes.replace(/\sdata-align="[^"]*"/, "");
			const outlookWidth = /\swidth=/i.test(kept) ? "" : ` width="600"`;
			const width = outlookWidth && "width:auto;";
			return `<img${outlookWidth} style="display:block;${width}max-width:100%;height:auto;margin:${margin};border-radius:${theme.radius.image}px;"${kept}>`;
		});
}

// Outlook on Windows ignores max-width: a 600px table only it reads holds the column, and it sizes an
// image by its width attribute alone, so a photo wider than the column would widen it. width:auto keeps
// every other client at the image's own size, up to the column.
const OUTLOOK_COLUMN_START = '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->';
const OUTLOOK_COLUMN_END = "<!--[if mso]></td></tr></table><![endif]-->";

function markdownEmailBody(source) {
	return parseMarkdown(source).replace(/<img\b(?![^>]*\swidth=)/gi, '<img width="600" style="width:auto;max-width:100%;height:auto;"');
}

// Outlook on Windows draws no rounded corners, ignores a div's padding and background, and paints <hr> its own way.
// Each gets a stand-in only Outlook reads, so every other client keeps the markup it always got.
const VML_NS = 'xmlns:v="urn:schemas-microsoft-com:vml"';
const mso = (html) => `<!--[if mso]>${html}<![endif]-->`;
const notMso = (html) => `<!--[if !mso]><!-->${html}<!--<![endif]-->`;
const outlookSpacer = (px) =>
	px > 0 ? `<p style="margin:0;font-size:${px}px;line-height:${px}px;mso-line-height-rule:exactly;">&nbsp;</p>` : "";

function outlookShapes(html, theme) {
	return outlookRules(outlookBoxes(outlookImages(outlookLists(html, theme), theme), theme), theme);
}

// Outlook drops a list's bottom margin, so the next block would touch it.
function outlookLists(html, theme) {
	return html.replace(/<\/(?:ol|ul)>/gi, (tag) => tag + mso(outlookSpacer(theme.gap)));
}

// Other clients merge a block's margin with its neighbours'; Outlook adds them up. Its stand-ins leave out the part
// a neighbour already gives: the paragraph, list or heading just before, the heading just after.
const BLOCK_BEFORE = /<\/(p|ul|ol|blockquote|h[1-6])>\s*(?:<!--[\s\S]*?-->\s*)*$/i;
const HEADING_AFTER = /^\s*(?:<!--[\s\S]*?-->\s*)*<h[1-6]\b/i;

function spaceBefore(html, at, theme) {
	const tag = html.slice(0, at).match(BLOCK_BEFORE)?.[1];
	if (!tag) return 0;
	return tag[0].toLowerCase() === "h" ? Math.round(theme.gap * 0.75) : theme.gap;
}

function spaceAfter(html, at, theme) {
	return HEADING_AFTER.test(html.slice(at)) ? theme.gap * 2 : 0;
}

// VML's corner radius is a share of half the shape's shorter side.
function arcsize(radius, width, height) {
	return `${Math.min(100, Math.round((radius / (Math.min(width, height) / 2)) * 100))}%`;
}

// A picture the editor sized becomes a rounded VML shape filled with it. Markdown pictures carry no height, so
// Outlook keeps them square.
function outlookImages(html, theme) {
	const radius = theme.radius.image;
	if (!radius) return html;
	return html.replace(/(<a\b[^>]*\shref="([^"]*)"[^>]*>\s*)?<img\b([^>]*)>/gi, (tag, _link, href, attributes, at) => {
		const width = Number(attributes.match(/\swidth="(\d+)"/)?.[1]);
		const height = Number(attributes.match(/\sheight="(\d+)"/)?.[1]);
		const src = attributes.match(/\ssrc="([^"]+)"/)?.[1];
		if (!width || !height || !src) return tag;
		const align = attributes.includes(`margin:${IMAGE_MARGINS.left}`)
			? "left"
			: attributes.includes(`margin:${IMAGE_MARGINS.right}`)
				? "right"
				: "center";
		const link = href ? ` href="${href}"` : "";
		// v:imagedata, not a v:fill of type frame: Outlook 2016 and 2019 draw the fill's fallback color, never the picture.
		const shape = `<v:roundrect ${VML_NS}${link} arcsize="${arcsize(radius, width, height)}" stroked="f" style="width:${width}px;height:${height}px;"><v:imagedata src="${src}" /></v:roundrect>`;
		return (
			mso(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${align}" style="padding:${Math.max(0, 24 - spaceBefore(html, at, theme))}px 0 ${Math.max(0, 24 - spaceAfter(html, at + tag.length, theme))}px;">${shape}</td></tr></table>`) +
			notMso(tag)
		);
	});
}

// One rounded corner: a quarter disc of the fill in its own cell.
function vmlCorner(corner, r, fill) {
	const arc = { tl: `m 0,${r} qy ${r},0`, tr: `m 0,0 qx ${r},${r}`, br: `m ${r},0 qy 0,${r}`, bl: `m ${r},${r} qx 0,0` }[corner];
	const back = { tl: `${r},${r}`, tr: `0,${r}`, br: "0,0", bl: `${r},0` }[corner];
	return `<td width="${r}" height="${r}" style="width:${r}px;height:${r}px;font-size:1px;line-height:${r}px;mso-line-height-rule:exactly;"><v:shape ${VML_NS} coordsize="${r},${r}" path="${arc} l ${back} x e" fillcolor="${fill}" stroked="f" style="width:${r}px;height:${r}px;"></v:shape></td>`;
}

// A box (lib/callouts.js, themed above) becomes a three-row table: corner discs, and a filled, padded cell between.
// A single v:roundrect around it would be simpler, but Word draws no picture inside another shape's text box.
const BOX_PATTERN = /<div style="margin:(\d+)px 0;padding:([^;"]+);border-radius:(\d+)px;background:([^;"]+);">/g;

function outlookBoxes(html, theme) {
	let out = "";
	let at = 0;
	for (const match of html.matchAll(BOX_PATTERN)) {
		if (match.index < at) continue;
		const start = match.index + match[0].length;
		const close = closingDiv(html, start);
		if (close < 0) continue;
		const [, margin, padding, radius, fill] = match;
		const [top, right = top, bottom = top, left = right] = padding.split(" ").map((side) => Number.parseFloat(side) || 0);
		const r = Number(radius);
		// Every cell of the corner rows has its width, or Word sizes the columns by the text below them.
		const edge = `<td width="${600 - 2 * r}" height="${r}" bgcolor="${fill}" style="width:${600 - 2 * r}px;font-size:1px;line-height:${r}px;mso-line-height-rule:exactly;">&nbsp;</td>`;
		// The padding sits on a table inside the filled cell, never on the cell that spans the corners.
		const cell = `<td colspan="3" bgcolor="${fill}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${Math.max(0, top - r)}px ${right}px ${Math.max(0, bottom - r)}px ${left}px;">`;
		const table = '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;border-collapse:collapse;">';
		const open = r ? `${table}<tr>${vmlCorner("tl", r, fill)}${edge}${vmlCorner("tr", r, fill)}</tr><tr>${cell}` : `${table}<tr>${cell.replace(' colspan="3"', "")}`;
		const end = `</td></tr></table></td></tr>${r ? `<tr>${vmlCorner("bl", r, fill)}${edge}${vmlCorner("br", r, fill)}</tr>` : ""}</table>`;
		out +=
			html.slice(at, match.index) +
			mso(outlookSpacer(Number(margin) - spaceBefore(html, match.index, theme)) + open) +
			notMso(match[0]) +
			html.slice(start, close) +
			notMso("</div>") +
			mso(end + outlookSpacer(Number(margin) - spaceAfter(html, close + "</div>".length, theme)));
		at = close + "</div>".length;
	}
	return out + html.slice(at);
}

function closingDiv(html, from) {
	const tags = /<(\/?)div\b[^>]*>/gi;
	tags.lastIndex = from;
	let depth = 1;
	for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
		depth += tag[1] ? -1 : 1;
		if (depth === 0) return tag.index;
	}
	return -1;
}

// A 1px cell in the theme's border color, spaced like .body hr.
function outlookRules(html, theme) {
	const rule = (above, below) =>
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${above}px 0 ${below}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${theme.border}" style="font-size:1px;line-height:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table></td></tr></table>`;
	const space = theme.gap * 2;
	return html.replace(
		/<hr\b[^>]*>/gi,
		(tag, at) =>
			mso(rule(Math.max(0, space - spaceBefore(html, at, theme)), Math.max(0, space - spaceAfter(html, at + tag.length, theme)))) +
			notMso(tag)
	);
}

const IMAGE_MARGINS = { left: "24px auto 24px 0", center: "24px auto", right: "24px 0 24px auto" };
// The built-in confirmation and last-chance buttons (lib/confirmation-content.js, lib/last-chance-content.js), also
// in the copies owners edited.
const BUTTON_STYLE_PATTERN = /(<a\s[^>]*style="display:inline-block;)background:#18181b;color:#ffffff;([^"]*?)border-radius:\d+px;/gi;

// Boxes and buttons are written in MailCheap's colors: a theme repaints them.
function themeInlineStyles(html, theme) {
	if (theme.isDefault) return html;
	const box = `<div style="margin:24px 0;padding:24px 24px ${Math.max(0, 24 - theme.gap)}px;border-radius:${theme.radius.box}px;background:${theme.surface};">`;
	return html
		.replaceAll(EMAIL_BOX_TAG, box)
		.replace(
			BUTTON_STYLE_PATTERN,
			(_, start, middle) => `${start}background:${theme.button};color:${theme.buttonText};${middle}border-radius:${theme.radius.button}px;`
		);
}

function footerHtml({ newsletter, unsubscribeUrl, theme }) {
	const address = newsletter?.postalAddress
		? `<br>${escapeHtml(newsletter.postalAddress)}`
		: "";
	return `<tr><td style="padding:32px 0 0;font-size:12px;line-height:1.6;color:${theme.muted};border-top:1px solid ${theme.border};">
You're receiving this because you subscribed to ${escapeHtml(newsletter?.name || "this newsletter")}.<br>
<a href="${unsubscribeUrl}" style="color:${theme.muted};text-decoration:underline;">Unsubscribe</a>${address}
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

function readOnlineLink(webUrl, color = "#a1a1aa") {
	return `<a href="${escapeHtml(webUrl)}" style="color:${color};text-decoration:none;">Read online</a>`;
}

function fillFields(html, { subject, previewText }) {
	return html
		.replaceAll(SUBJECT_PLACEHOLDER, escapeHtml(subject))
		.replaceAll(PREVIEW_TEXT_PLACEHOLDER, escapeHtml(previewText));
}

// Web fonts sit in @media screen, which Outlook on Windows skips: it would otherwise drop the fallbacks for Times New
// Roman. It gets its own fonts instead, in a block only it reads.
function headStyles(theme) {
	const { fonts, gap } = theme;
	const heading = [
		fonts.heading && ` font-family: ${fonts.heading};`,
		theme.headingWeight && ` font-weight: ${theme.headingWeight};`,
		theme.headingTracking && ` letter-spacing: ${theme.headingTracking};`,
	].join("");
	const outlook = fonts.outlookBody
		? `\n<!--[if mso]><style>body, table, td, p, a, li, blockquote { font-family: ${fonts.outlookBody} !important; } h1, h2, h3 { font-family: ${fonts.outlookHeading} !important; }</style><![endif]-->`
		: "";
	return `<style>
${fonts.faces ? `@media screen { ${fonts.faces} }\n` : ""}.body a { color: ${theme.link}; }
.body img { max-width: 100%; height: auto; border-radius: ${theme.radius.image}px; }
.body h1, .body h2, .body h3 { line-height: 1.3; margin: ${gap * 2}px 0 ${Math.round(gap * 0.75)}px; color: ${theme.heading};${heading} }
.body p { margin: 0 0 ${gap}px; }
.body ul, .body ol { margin: 0 0 ${gap}px 24px; padding: 0; }
.body blockquote { margin: 0 0 ${gap}px; padding-left: 16px; border-left: 3px solid ${theme.border}; color: ${theme.quote}; }
.body code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: ${theme.surface}; padding: 2px 4px; border-radius: 4px; }
.body hr { border: 0; border-top: 1px solid ${theme.border}; margin: ${gap * 2}px 0; }
</style>${outlook}
<!--[if mso]><style>.body p, .body li, .body blockquote { line-height: ${Math.round(16 * theme.lineHeight)}px; mso-line-height-rule: exactly; }</style><![endif]-->`;
}

function wrapMarkdownBody({ bodyHtml, subject, previewText, footer, webUrl, theme }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
${headStyles(theme)}
</head>
<body style="margin:0;padding:0;background:${theme.background};">
${preheaderHtml(previewText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.background};">
<tr><td align="center" style="padding:${theme.padding};">
${OUTLOOK_COLUMN_START}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${theme.fonts.body};font-size:16px;line-height:${theme.lineHeight};color:${theme.text};">
${webUrl ? `<tr><td align="right" style="padding:0 0 24px;font-size:12px;line-height:1;">${readOnlineLink(webUrl, theme.faint)}</td></tr>\n` : ""}<tr><td class="body">${bodyHtml}</td></tr>
${footer}
</table>
${OUTLOOK_COLUMN_END}
</td></tr>
</table>
</body>
</html>`;
}

// Generated HTML (an issue built by another app) keeps its own design, theme aside, and gets the footer appended.
function withFooter({ html, newsletter, unsubscribeUrl, previewText, webUrl }) {
	const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 20px 32px;">${OUTLOOK_COLUMN_START}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT_STACK};">${footerHtml({ newsletter, unsubscribeUrl, theme: DEFAULT_EMAIL_THEME })}</table>${OUTLOOK_COLUMN_END}</td></tr></table>`;
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
	// Where the theme's fonts are served from: the app's URL in sent emails, the page's own host in previews.
	fontBaseUrl = "",
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

	const theme = getEmailTheme(resolveTheme(newsletter?.theme), fontBaseUrl);
	const bodyHtml = outlookShapes(themeInlineStyles(format === "rich" ? richEmailBody(html, theme) : markdownEmailBody(source), theme), theme);
	const footer = isWebVersion ? "" : footerHtml({ newsletter, unsubscribeUrl, theme });
	const rendered = wrapMarkdownBody({ bodyHtml, subject, previewText, footer, webUrl: readOnlineUrl, theme });
	const readOnlineText = readOnlineUrl ? `Read online: ${readOnlineUrl}\n\n` : "";
	const text = isWebVersion
		? htmlToText(bodyHtml)
		: `${readOnlineText}${htmlToText(bodyHtml)}\n\n${footerText({ newsletter, unsubscribeUrl })}`;
	return { html: rendered, text, bytes: byteLength(rendered) };
}

function byteLength(value) {
	return new TextEncoder().encode(value).length;
}
