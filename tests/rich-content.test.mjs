import assert from "node:assert/strict";
import { test } from "node:test";
import { renderIssueBody } from "../lib/archive-content.js";
import { cleanRichHtml } from "../lib/clean-html.js";
import { UNSUBSCRIBE_PLACEHOLDER, hasContent, renderEmail } from "../lib/render-email.js";
import { getSendProblem } from "../lib/sending-rules.js";
import { firstImageUrl } from "../lib/thumbnail.js";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const box = '<div data-callout=""><p>Startups I built</p></div>';
const editorHtml = [
	"<h1>Big news</h1>",
	'<p>Hi <strong>you</strong>, <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.org">Example</a> <a href="javascript:alert(1)">bad</a></p>',
	"<p></p>",
	"<ul><li><p>One</p></li><li><p>Two</p></li></ul>",
	'<img src="blob:http://localhost:3100/5f1c" alt="" width="600" height="300">',
	'<img src="https://cdn.example.com/chart.png" alt="Chart" width="320" height="160" onerror="alert(1)">',
	box,
	'<div data-callout="" style="background:url(https://evil.example/x)"><p>Shipped</p></div>',
	"<script>alert(1)</script>",
	"<p></p>",
].join("");

test("editor HTML keeps its content and drops scripts, handlers and unfinished uploads", () => {
	const html = cleanRichHtml(editorHtml);
	assert.ok(html.startsWith("<h1>Big news</h1>"));
	assert.ok(html.includes('<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.org">Example</a>'));
	assert.ok(html.includes("<a>bad</a>"), "javascript: links lose their href");
	assert.ok(html.includes("<p><br></p>"), "blank lines stay as spacing");
	assert.ok(!html.endsWith("<p><br></p>"), "the editor's trailing empty paragraph goes");
	assert.ok(!html.includes("blob:"), "images still uploading are dropped");
	assert.ok(html.includes('<img src="https://cdn.example.com/chart.png" alt="Chart" width="320" height="160">'));
	assert.ok(!/onerror|<script|evil/.test(html));
	assert.ok(html.includes(box));
	assert.ok(html.includes('<div data-callout=""><p>Shipped</p></div>'), "boxes keep no stored styles");
});

test("editor issues get inline styles in emails", () => {
	const { html, text } = renderEmail({ format: "rich", html: editorHtml, subject: "Big news", newsletter: { name: "Field notes" } });
	assert.equal(html.split("border-radius:12px;background:#f4f4f5;").length - 1, 2);
	assert.ok(!html.includes("data-callout"));
	assert.ok(html.includes('<li><p style="margin:0;">One</p></li>'));
	assert.ok(
		html.includes(
			'<img style="display:block;max-width:100%;height:auto;margin:24px auto;border-radius:8px;" src="https://cdn.example.com/chart.png"'
		)
	);
	assert.ok(html.includes(UNSUBSCRIBE_PLACEHOLDER), "the footer is added");
	assert.match(text, /Startups I built/);
});

test("a picture placed left or right stays there in the email and on the archive; anything else is centered", () => {
	const image = (align) => `<img src="https://cdn.example.com/${align}.png" alt="" width="240" height="120" data-align="${align}">`;
	const html = ["left", "right", "center", "top"].map(image).join("");
	const cleaned = cleanRichHtml(html);
	assert.ok(cleaned.includes('data-align="left"') && cleaned.includes('data-align="right"') && cleaned.includes('data-align="center"'));
	assert.ok(cleaned.includes('<img src="https://cdn.example.com/top.png" alt="" width="240" height="120">'), "an unknown alignment is dropped");

	const email = renderEmail({ format: "rich", html, subject: "Pictures", newsletter: { name: "Field notes" } }).html;
	const margins = Object.fromEntries([...email.matchAll(/margin:([^;]+);border-radius:8px;" src="https:\/\/cdn\.example\.com\/(\w+)\.png"/g)].map(([, margin, name]) => [name, margin]));
	assert.deepEqual(margins, { left: "24px auto 24px 0", right: "24px 0 24px auto", center: "24px auto", top: "24px auto" });
	assert.ok(!email.includes("data-align"), "emails carry the alignment in their styles");

	assert.ok(renderIssueBody({ format: "rich", html }).html.includes('data-align="right"'), "the archive styles it from the attribute");
});

test("editor issues use the archive layout", () => {
	const { kind, html } = renderIssueBody({ format: "rich", html: editorHtml });
	assert.equal(kind, "article");
	assert.ok(html.includes('src="https://cdn.example.com/chart.png" alt="Chart" width="320" height="160" fetchpriority="high"'));
	assert.ok(html.includes(box));
});

test("everything the editor writes keeps its markup on the archive", () => {
	const html = [
		"<h1>One</h1><h2>Two</h2><h3>Three</h3>",
		"<p><strong>b</strong> <em>i</em> <s>s</s> <u>u</u> <code>c</code><br>next</p>",
		"<blockquote><p>Quote</p></blockquote><ol><li><p>1</p></li></ol><ul><li><p>a</p></li></ul><hr>",
		'<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.org">Example</a></p>',
		'<img src="https://cdn.example.com/chart.png" alt="Chart" width="320" height="160">',
		box,
	].join("");
	const expected = html
		.replace("<br>", "<br />")
		.replace("<hr>", "<hr />")
		.replace('height="160">', 'height="160" fetchpriority="high" decoding="async" />');
	assert.equal(renderIssueBody({ format: "rich", html }).html, expected);
});

test("an empty editor document is not content", () => {
	assert.equal(hasContent("<p></p>"), false);
	assert.equal(hasContent(""), false);
	assert.equal(hasContent("<p>Hi</p>"), true);
	assert.equal(hasContent('<img src="https://cdn.example.com/a.png">'), true);

	const newsletter = {
		_id: "74f1a2b3c4d5e6f7a8b9c0d2",
		name: "Field notes",
		fromEmail: "jane@example.com",
		postalAddress: "1 Main St, Paris",
	};
	const campaign = { format: "rich", subject: "Issue", html: "<p></p>" };
	assert.equal(getSendProblem({ campaign, newsletter }), "Add content");
	assert.equal(getSendProblem({ campaign: { ...campaign, html: "<p>Hello</p>" }, newsletter }), null);
});

test("editor issues take their thumbnail from the first image", () => {
	assert.equal(firstImageUrl({ format: "rich", html: editorHtml }), "https://cdn.example.com/chart.png");
});
