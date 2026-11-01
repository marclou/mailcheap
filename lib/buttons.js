import { isActionLink } from "./action-links.js";

// Buttons in issues: a link drawn as a button in the newsletter's button colors and corners (lib/themes.js), on the left,
// in the center or on the right of the column. An issue keeps each one as <div data-button=""><a href="…">Text</a></div>,
// with data-align="left" or "right" unless it's centered, so what only reads links, like click tracking, the click
// report and the plain-text email, gets a link. Emails (lib/render-email.js) and the website (app/globals.css) draw it,
// and what a button can be set to later goes on its <div> the same way.
export const BUTTON_ALIGNMENTS = ["left", "center", "right"];
export const BUTTON_MARKER = ' data-button=""';
export const BUTTON_PROBLEM = "Add text and a link to each button";
// A button's <div> as the issue's cleaner writes it (lib/clean-html.js), its tag name in group 1 and its place in group 2.
export const BUTTON_START_PATTERN = /<(div) data-button=""(?: data-align="(left|center|right)")?>/gi;

const BUTTON_LINK_PATTERN = /^\s*<a\b([^>]*)>([\s\S]*)<\/a>\s*$/i;
const BUTTON_HREF_PATTERN = /\shref="([^"]*)"/i;
const BUTTON_LINK_SCHEME = /^(?:https?:|mailto:)/i;
// Outlook on Windows leaves a link's padding out: it pads the cell under the link instead, in the button's color.
const PADDING = "12px 24px";

export function readButtonAlign(value) {
	return value === "left" || value === "right" ? value : "center";
}

// What a button can open: a web address, an email address as a mailto: link, or the link MailCheap fills in for each
// reader of the confirmation and last-chance emails (lib/action-links.js).
export function isButtonLink(href) {
	return BUTTON_LINK_SCHEME.test(String(href ?? "")) || isActionLink(href);
}

// A button's <div> attributes as the cleaner keeps them: the marker, and its place unless it's centered.
export function getButtonAttributes(align) {
	const place = readButtonAlign(align);
	return place === "center" ? BUTTON_MARKER : `${BUTTON_MARKER} data-align="${place}"`;
}

// What's in a button's <div>, when it's one link: its address, a web or email one or none, and its text as HTML. null
// for anything else.
export function readButton(content) {
	const match = BUTTON_LINK_PATTERN.exec(content);
	if (!match || /<\/?a\b/i.test(match[2])) return null;
	const href = BUTTON_HREF_PATTERN.exec(match[1])?.[1];
	return { href: isButtonLink(href) ? href : null, label: match[2] };
}

// A button in an email: tables, which every app lays out, the outer one placing it in the column. Its colors and corners
// are the email theme's (getEmailTheme), its letters the body's font.
export function getEmailButtonHtml({ href, label, align }, theme) {
	const radius = `border-radius:${theme.radius.button}px;`;
	const link = href ? ` href="${href}"` : "";
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="${align}"><table role="presentation" align="${align}" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${theme.button}" style="${radius}background:${theme.button};mso-padding-alt:${PADDING};"><a${link} style="display:inline-block;padding:${PADDING};${radius}background:${theme.button};color:${theme.buttonText};font-family:${theme.fonts.body};font-size:16px;font-weight:600;line-height:20px;text-decoration:none;">${label}</a></td></tr></table></td></tr></table>`;
}
