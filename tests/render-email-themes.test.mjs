import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfirmationContent } from "../lib/confirmation-content.js";
import { toPreviewFrame } from "../lib/email-preview.js";
import { renderEmail, withEmailMode } from "../lib/render-email.js";

const markdown = "# Big news\n\nA [link](https://example.org).\n\n:::box\nA box\n:::\n\n> A quote";
const base = { markdown, subject: "Hi", previewText: "Preview", webUrl: "https://example.org/p/hi" };

function render(theme, options = {}) {
	return renderEmail({ ...base, newsletter: { name: "Field notes", postalAddress: "1 Main St", ...(theme && { theme }) }, ...options });
}

test("MailCheap's theme, saved or not, sends the email it always did: system fonts, no web fonts", () => {
	const plain = render(null);
	assert.equal(render({ preset: "mailcheap" }).html, plain.html);
	assert.doesNotMatch(plain.html, /@font-face|\[if mso\]/);
	assert.match(plain.html, /font-family:-apple-system,BlinkMacSystemFont,'Segoe UI'/);
	assert.match(plain.html, /<div class="email-box" style="margin:24px 0;padding:24px 24px 8px;border-radius:12px;background:#f4f4f5;">/);
});

test("a theme paints the email: page, text, headings, links, boxes and footer", () => {
	const { html, text } = render({ preset: "garden" }, { fontBaseUrl: "https://mail.example.com" });
	assert.match(html, /<body class="email-page" style="margin:0;padding:0;background:#eef1e8;">/);
	assert.match(html, /font-family:'MC DM Sans',-apple-system/);
	assert.match(html, /\.body h1, \.body h2, \.body h3 \{ line-height: 1\.3; margin: 40px 0 15px; color: #1f2a22; font-family: 'MC Fraunces',Georgia,'Times New Roman',Times,serif; font-weight: 600; letter-spacing: -0\.015em; \}/);
	assert.match(html, /\.body a \{ color: #2f6a4a; \}/);
	assert.match(html, /<div class="email-box" style="margin:24px 0;padding:24px 24px 4px;border-radius:16px;background:#/);
	assert.doesNotMatch(html, /background:#f4f4f5/);
	assert.match(html, /padding:40px 24px;/, "spacious spacing");
	assert.equal(text, render(null).text, "the text version doesn't change");
});

test("emails are written in the theme's light colors, and mail apps in dark mode get its dark ones", () => {
	const { html } = render({ preset: "midnight" });
	assert.match(html, /<meta name="color-scheme" content="light dark">/);
	assert.match(html, /<body class="email-page" style="margin:0;padding:0;background:#eef1f6;">/, "Midnight's light page, though it's made for dark");
	const dark = html.match(/@media \(prefers-color-scheme: dark\) \{\n([^]*?)\n\}/)[1];
	assert.match(dark, /^\.email-page \{ background: #0d1017 !important; \}$/m);
	assert.match(dark, /^\.email-button, \.email-button a \{ background: #c4f25c !important; color: #0a0a0a !important; \}$/m);
	assert.match(dark, /^\.body a \{ color: #c4f25c; \}$/m);
	assert.match(render(null).html, /^\.email-page \{ background: #0a0a0a !important; \}$/m, "MailCheap's own dark colors");
	const block = '<div data-html-block=""><p style="color:#123456;">Block</p></div>';
	assert.ok(renderEmail({ ...base, markdown: block, newsletter: { name: "N", theme: { preset: "midnight" } } }).html.includes(block), "an HTML block keeps its colors");
});

test("previews show an email as a mail app in light mode does, and the customizer in the mode it shows", () => {
	const { html } = render({ preset: "midnight" });
	assert.equal(withEmailMode(html, "light"), html.replace("@media (prefers-color-scheme: dark) {", "@media not all {"));
	assert.equal(withEmailMode(html, "dark"), html.replace("@media (prefers-color-scheme: dark) {", "@media all {"));
	assert.ok(toPreviewFrame(html).includes("@media not all {"));
	assert.ok(!toPreviewFrame(html).includes("prefers-color-scheme"));
});

test("an email on the left sits there on a wider screen, and nothing else about it changes", () => {
	const centered = render(null);
	const left = render({ preset: "mailcheap", emailAlign: "left" });
	const column = '<tr><td align="center" style="padding:32px 20px;">\n<table role="presentation" class="email-text" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;';
	assert.ok(centered.html.includes(column));
	assert.equal(left.html, centered.html.replace(column, column.replace('align="center"', 'align="left"')));
	assert.equal(left.text, centered.text);
	assert.match(render({ preset: "garden", emailAlign: "left" }).html, /<tr><td align="left" style="padding:40px 24px;">/);
	assert.match(render({ preset: "garden", emailAlign: '" onclick="alert(1)' }).html, /<tr><td align="center" style="padding:40px 24px;">/);
});

test("web fonts load from the app on screens only, and Outlook gets fonts it has", () => {
	const { html } = render({ preset: "broadsheet" }, { fontBaseUrl: "https://mail.example.com" });
	assert.match(html, /<style>\n@media screen \{ @font-face\{font-family:'MC Instrument Serif'/);
	assert.match(html, /url\(https:\/\/mail\.example\.com\/fonts\/newsreader-latin\.woff2\)/);
	assert.match(html, /<!--\[if mso\]><style>body, table, td, p, a, li, blockquote \{ font-family: Georgia,serif !important; \} h1, h2, h3 \{ font-family: Georgia,serif !important; \}<\/style><!\[endif\]-->/);
});

test("the confirmation button takes the accent, its readable label and the theme's corners", () => {
	const buttonStyle = (content, preset) =>
		renderEmail({ ...content, newsletter: { name: "Field notes", theme: { preset } } }).html.match(
			/<a href="\{\{confirm_url\}\}" style="([^"]*)">Confirm my subscription<\/a>/
		)?.[1];
	const builtIn = getConfirmationContent({ name: "Field notes" });
	assert.match(buttonStyle(builtIn, "poster"), /border-radius:0px;background:#ffd23f;color:#0a0a0a;/);
	assert.match(buttonStyle(builtIn, "sunset"), /border-radius:999px;/);

	// A copy its owner saved in Markdown, before the editor, keeps the built-in button's inline style.
	const markdown = `Hi\n\n<a href="{{confirm_url}}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my subscription</a>`;
	assert.match(buttonStyle({ format: "markdown", markdown, subject: "Hi" }, "poster"), /^display:inline-block;background:#ffd23f;color:#0a0a0a;[^"]*border-radius:0px;$/);
});

test("editor pictures take the theme's corners; designed HTML emails keep their own look", () => {
	const rich = renderEmail({ format: "rich", html: '<p>Hi</p><img src="https://cdn.example.com/a.png" alt="">', subject: "Hi", newsletter: { name: "N", theme: { preset: "swiss" } } });
	assert.match(rich.html, /<img style="display:block;max-width:100%;height:auto;margin:24px auto;border-radius:0px;"/);
	const designed = { format: "html", html: "<html><body><p>Hi</p></body></html>", subject: "Hi" };
	assert.equal(renderEmail({ ...designed, newsletter: { name: "N", theme: { preset: "midnight" } } }).html, renderEmail({ ...designed, newsletter: { name: "N" } }).html);
});
