import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfirmationContent } from "../lib/confirmation-content.js";
import { renderEmail } from "../lib/render-email.js";

const markdown = "# Big news\n\nA [link](https://example.org).\n\n:::box\nA box\n:::\n\n> A quote";
const base = { markdown, subject: "Hi", previewText: "Preview", webUrl: "https://example.org/p/hi" };

function render(theme, options = {}) {
	return renderEmail({ ...base, newsletter: { name: "Field notes", postalAddress: "1 Main St", ...(theme && { theme }) }, ...options });
}

test("MailCheap's theme, saved or not, sends the email it always did: system fonts, no web fonts", () => {
	const plain = render(null);
	assert.equal(render({ preset: "mailcheap" }).html, plain.html);
	assert.doesNotMatch(plain.html, /@font-face|font-family: [^;]*!important/);
	assert.match(plain.html, /font-family:-apple-system,BlinkMacSystemFont,'Segoe UI'/);
	assert.match(plain.html, /<div style="margin:24px 0;padding:24px 24px 8px;border-radius:12px;background:#f4f4f5;">/);
});

test("a theme paints the email: page, text, headings, links, boxes and footer", () => {
	const { html, text } = render({ preset: "garden" }, { fontBaseUrl: "https://mail.example.com" });
	assert.match(html, /<body style="margin:0;padding:0;background:#eef1e8;">/);
	assert.match(html, /font-family:'MC DM Sans',-apple-system/);
	assert.match(html, /\.body h1, \.body h2, \.body h3 \{ line-height: 1\.3; margin: 40px 0 15px; color: #1f2a22; font-family: 'MC Fraunces',Georgia,'Times New Roman',Times,serif; font-weight: 600; letter-spacing: -0\.015em; \}/);
	assert.match(html, /\.body a \{ color: #2f6a4a; \}/);
	assert.match(html, /<div style="margin:24px 0;padding:24px 24px 4px;border-radius:16px;background:#/);
	assert.doesNotMatch(html, /background:#f4f4f5/);
	assert.match(html, /padding:40px 24px;/, "spacious spacing");
	assert.equal(text, render(null).text, "the text version doesn't change");
});

test("web fonts load from the app on screens only, and Outlook gets fonts it has", () => {
	const { html } = render({ preset: "broadsheet" }, { fontBaseUrl: "https://mail.example.com" });
	assert.match(html, /<style>\n@media screen \{ @font-face\{font-family:'MC Instrument Serif'/);
	assert.match(html, /url\(https:\/\/mail\.example\.com\/fonts\/newsreader-latin\.woff2\)/);
	assert.match(html, /<!--\[if mso\]><style>body, table, td, p, a, li, blockquote \{ font-family: Georgia,serif !important; \} h1, h2, h3 \{ font-family: Georgia,serif !important; \}<\/style><!\[endif\]-->/);
});

test("the confirmation button takes the accent, its readable label and the theme's corners", () => {
	const { html } = renderEmail({ ...getConfirmationContent({ name: "Field notes" }), newsletter: { name: "Field notes", theme: { preset: "poster" } } });
	assert.match(html, /style="display:inline-block;background:#ffd23f;color:#0a0a0a;[^"]*border-radius:0px;"/);
	const pill = renderEmail({ ...getConfirmationContent({ name: "Field notes" }), newsletter: { name: "Field notes", theme: { preset: "sunset" } } });
	assert.match(pill.html, /border-radius:999px;">Confirm my subscription<\/a>/);
});

test("editor pictures take the theme's corners; designed HTML emails keep their own look", () => {
	const rich = renderEmail({ format: "rich", html: '<p>Hi</p><img src="https://cdn.example.com/a.png" alt="">', subject: "Hi", newsletter: { name: "N", theme: { preset: "swiss" } } });
	assert.match(rich.html, /<img width="600" style="display:block;width:auto;max-width:100%;height:auto;margin:24px auto;border-radius:0px;"/);
	const designed = { format: "html", html: "<html><body><p>Hi</p></body></html>", subject: "Hi" };
	assert.equal(renderEmail({ ...designed, newsletter: { name: "N", theme: { preset: "midnight" } } }).html, renderEmail({ ...designed, newsletter: { name: "N" } }).html);
});
