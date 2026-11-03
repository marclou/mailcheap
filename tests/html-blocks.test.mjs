import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BlockHtml from "../components/BlockHtml.jsx";
import { fitToWidth } from "../components/FrameIssue.jsx";
import InputHtml from "../components/InputHtml.jsx";
import { renderIssueBody } from "../lib/archive-content.js";
import { HTML_BLOCK_ATTRIBUTES, HTML_BLOCK_STYLES, HTML_BLOCK_TAGS, cleanBlockHtml, cleanRichHtml } from "../lib/clean-html.js";
import { getReviewInput } from "../lib/content-review.js";
import { highlightHtml } from "../lib/highlight-html.js";
import { fillForReader } from "../lib/merge-tags.js";
import { hasContent, htmlToText, renderBlockPreview, renderEmail } from "../lib/render-email.js";
import { getSendProblem } from "../lib/sending-rules.js";
import { firstImageUrl } from "../lib/thumbnail.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

// An HTML block as the editor stores it (components/BlockHtml.jsx): its HTML as the text of the block's <div>.
function block(html) {
	return `<div data-html-block="">${html.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>`;
}

function emailBody(html) {
	return /<td class="body">([\s\S]*?)<\/td><\/tr>\n<tr><td style="padding:32px/.exec(html)?.[1];
}

const NEWSLETTER = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "jane@example.com", postalAddress: "1 Main St, Paris" };

// Cleaned blocks are written in one shape: allowed tags with double-quoted allowed attributes, and no "<" anywhere else.
const CLEAN_TAG_PATTERN = /<\/?([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/g;
const WEBSITE_ATTRIBUTES = ["data-html-block", "loading", "decoding", "fetchpriority"];

function assertInert(html, label) {
	const text = html.replace(CLEAN_TAG_PATTERN, (_, tag, attributes) => {
		assert.ok(HTML_BLOCK_TAGS.includes(tag), `${label}: <${tag}> in ${html}`);
		const allowed = [...HTML_BLOCK_ATTRIBUTES["*"], ...(HTML_BLOCK_ATTRIBUTES[tag] ?? []), ...WEBSITE_ATTRIBUTES];
		for (const [, name, value = ""] of attributes.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) {
			assert.ok(allowed.includes(name), `${label}: ${name} on <${tag}> in ${html}`);
			assert.doesNotMatch(value, /javascript|vbscript|data:|url\(|expression|\\/i, `${label}: ${name}="${value}"`);
			if (name === "href") assert.match(value, /^(https?:|mailto:|tel:|#)/i, `${label}: href="${value}"`);
			if (name === "src") assert.match(value, /^https?:\/\//i, `${label}: src="${value}"`);
			if (name === "style") {
				for (const declaration of value.replaceAll("&quot;", '"').split(";")) {
					const property = declaration.split(":")[0];
					assert.ok(HTML_BLOCK_STYLES.includes(property), `${label}: ${declaration}`);
					assert.ok(tag !== "img" || property !== "overflow", `${label}: a picture's overflow in ${html}`);
				}
			}
		}
		return "";
	});
	assert.ok(!text.includes("<"), `${label}: markup outside the allowed tags in ${html}`);
}

const payloads = {
	handlers: '<a href="https://ok.test" style="color:red" onmouseover="alert(1)" OnClick=alert(2)>x</a><img src="https://ok.test/a.png" onerror=alert(3)>',
	underscore: '<a_ href="https://x.test" onclick="alert(1)">a_</a_><img_ src=x onerror=alert(1)><x_ style="position:fixed;inset:0">x</x_>',
	joined: "<<x_>p onclick=alert(1)>joined<<x_>img src=x onerror=alert(1)>",
	splitScript: "<scr<script>ipt>alert(1)</script><scr<x_>ipt>alert(2)</script><script>alert(3)</script >",
	svg: '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg><svg><a xlink:href="javascript:alert(1)">s</a></svg>',
	math: "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>",
	noscript: '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
	template: "<template><img src=x onerror=alert(1)></template>",
	textarea: '<textarea><p title="</textarea><img src=x onerror=alert(1)>"></p></textarea>',
	title: '<title><p title="</title><img src=x onerror=alert(1)>"></p></title>',
	iframe: '<iframe srcdoc="<script>alert(1)</script>"></iframe><iframe src="https://evil.test"></iframe><embed src="javascript:alert(1)"><object data="javascript:alert(1)">x</object>',
	forms: '<form action="https://evil.test"><input name="password"><button formaction="https://evil.test">Go</button><select><option>a</option></select></form>',
	page: '<base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"><link rel="stylesheet" href="https://evil.test/x.css">',
	quotedGt: '<a title="x>" onclick="alert(1)" href="https://ok.test">q</a><img alt=">" src="https://ok.test/a.png" onerror="alert(1)">',
	encodedUrl:
		'<a href="&#106;avascript:alert(1)">e1</a><a href="jav&#x09;ascript:alert(1)">e2</a><a href="javascript&colon;alert(1)">e3</a><a href="java\nscript:alert(1)">e4</a><a href=" javascript:alert(1)">e5</a>',
	duplicates: '<a href="https://ok.test" HREF="javascript:alert(1)">d</a><p style="color:red" style="background:url(https://evil.test/x)">s</p>',
	urlAttributes:
		'<table background="javascript:alert(1)"><tr><td background="https://evil.test/x">x</td></tr></table><img src="https://ok.test/a.png" srcset="https://evil.test/b.png 2x" usemap="#m"><q cite="javascript:alert(1)">q</q>',
	cssLoads:
		'<div style="background:url(javascript:alert(1))">a</div><div style="background-image:url(&quot;https://evil.test/x&quot;)">b</div><div style="width:expression(alert(1));behavior:url(x.htc);-moz-binding:url(x)">c</div>',
	cssEscapes: '<div style="background:u\\72 l(x)">a</div><div style="background:u&#114;l(x)">b</div><div style="color:/**/red;background:url/**/(x)">c</div>',
	cssCovers:
		'<div style="position:fixed;inset:0;z-index:9999;transform:scale(9);outline:9999px solid red;box-shadow:0 0 0 9999px red;margin-top:-900px">x</div>',
	imageOverflow:
		'<img src="https://ok.test/a.png" style="width:1px;height:1px;object-fit:none;object-position:-900px -900px;overflow:visible;OVERFLOW : visible"><IMG src="https://ok.test/b.png" style="object-fit:cover;overflow&#58;visible">',
	classes: '<div class="fixed inset-0 z-50" id="__next" name="body" data-state="open" role="dialog" aria-hidden="true" tabindex="0">x</div>',
	targets: '<a href="https://ok.test" target="_top">t</a><a href="https://ok.test" target="evil">u</a>',
	valueBreakout: '<a href="https://ok.test/<img src=x//">x</a><p>" onmouseover="alert(1)" x="</p>',
};

describe("what an HTML block keeps", () => {
	test("the layout emails are made of: tables, inline styles, fonts and their attributes, as written", () => {
		const html =
			'<table role="presentation" width="100%" cellpadding="8" bgcolor="#fff8e6" style="border-collapse:collapse;border-radius:12px"><tr><td align="center" valign="top" style="padding:24px;font-family:\'Helvetica Neue\', Arial, sans-serif;color:rgb(24, 24, 27)"><center><font color="#333333" face="Georgia">Sponsored</font></center><a href="https://example.com/offer" target="_blank" rel="noopener" style="display:inline-block;background:linear-gradient(90deg, #18181b, rgba(0,0,0,0.8));color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none">Try it</a></td></tr></table>';
		assert.equal(cleanBlockHtml(html), html);
		assert.equal(cleanBlockHtml('<ul type="square"><li value="3">Three</li></ul><ol start="2"><li>Two</li></ol><hr><br/>'), '<ul type="square"><li value="3">Three</li></ul><ol start="2"><li>Two</li></ol><hr><br />');
	});

	test("classes, ids, handlers and data attributes go, and so do the elements an email can't show, with what's in them", () => {
		const html =
			'<div class="card" id="x" data-x="1" onclick="alert(1)" style="color:red">Hi<script>alert(1)</script><style>.card{}</style><iframe src="https://example.com"></iframe><form action="https://example.com"><input name="q"><button>Go</button></form><svg><circle/></svg><video src="https://example.com/v.mp4">Your app can\'t play it</video><object data="x">fallback</object></div>';
		assert.equal(cleanBlockHtml(html), '<div style="color:red">Hi</div>');
	});

	test("a whole page pasted in keeps its body: its doctype, head, title and comments go", () => {
		const page =
			'<!DOCTYPE html><?xml version="1.0"?><html><head><title>Newsletter</title><meta charset="utf-8"><style>p{}</style><link rel="stylesheet" href="https://x.test"></head><body><!-- note --><!--[if mso]><table><tr><td><![endif]--><p>Body</p><![if !mso]><p>Not Outlook</p><![endif]></body></html>';
		assert.equal(cleanBlockHtml(page), "<p>Body</p><p>Not Outlook</p>");
	});

	test("inline styles keep their allowed declarations, and nothing that could load, run or move over the issue", () => {
		const styleOf = (style) => /style="([^"]*)"/.exec(cleanBlockHtml(`<p style="${style}">x</p>`))?.[1] ?? null;
		assert.equal(styleOf("color: #e11d48; FONT-WEIGHT: bold;  margin: 0 auto 16px;"), "color:#e11d48;font-weight:bold;margin:0 auto 16px");
		assert.equal(styleOf("font-family:&quot;Segoe UI&quot;, 'Helvetica Neue', sans-serif"), "font-family:&quot;Segoe UI&quot;, 'Helvetica Neue', sans-serif");
		assert.equal(styleOf("background:linear-gradient(to right, rgb(255,0,0), #00f 50%);color:rgba(0, 0, 0, 0.5) !important"), "background:linear-gradient(to right, rgb(255,0,0), #00f 50%);color:rgba(0, 0, 0, 0.5) !important");
		assert.equal(styleOf("width:600px;max-width:100%;border:1px solid #e4e4e7;opacity:0.9"), "width:600px;max-width:100%;border:1px solid #e4e4e7;opacity:0.9");
		assert.equal(styleOf("color:red;behavior:url(x.htc)"), "color:red");
		assert.equal(styleOf("padding:12px;position:fixed;top:0"), "padding:12px");
		for (const style of [
			"position:fixed;inset:0",
			"top:0;left:0",
			"z-index:9999",
			"transform:translate(0,-500px)",
			"outline:9999px solid red",
			"box-shadow:0 0 0 9999px red",
			"background:url(https://evil.example/x.png)",
			"background-image:url('javascript:alert(1)')",
			"background:url&#40;x&#41;",
			"background:u&#114;l(x)",
			"width:expression(alert(1))",
			"-moz-binding:url(x)",
			"color:\\72 ed",
			"color:/**/red",
			"margin-top:-500px",
			"margin:0 0 -20px",
			"color:{{color|red}}",
			"font-family:'a;b'",
			"content:'x'",
			"color:var(--x)",
			"width:calc(100% - 1px)",
			`color:${"a".repeat(501)}`,
			"color:red&semi;position:fixed",
		]) {
			assert.equal(styleOf(style), null, style);
		}
	});

	test("a picture fills the size it's given as object-fit says, cropped rather than stretched, and never past its box", () => {
		const thumbnail =
			'<img src="https://cdn.example.com/house.jpg" width="80" height="80" alt="" style="display:block;width:80px;height:80px;object-fit:cover;object-position:center top;border-radius:8px">';
		const issue = block(thumbnail);
		assert.equal(cleanBlockHtml(thumbnail), thumbnail);
		assert.ok(emailBody(renderEmail({ format: "rich", html: issue, subject: "Hi", newsletter: NEWSLETTER }).html).includes(thumbnail), "in emails");
		assert.ok(renderIssueBody({ format: "rich", html: issue }).html.includes("object-fit:cover;object-position:center top;"), "on the website");
		assert.ok(renderBlockPreview(thumbnail, NEWSLETTER).includes(thumbnail), "in the editor's preview");

		assert.equal(
			cleanBlockHtml('<img src="https://cdn.example.com/a.png" style="width:1px;height:1px;object-fit:none;overflow:visible">'),
			'<img src="https://cdn.example.com/a.png" style="width:1px;height:1px;object-fit:none">'
		);
		assert.equal(cleanBlockHtml('<div style="overflow:hidden;border-radius:8px">x</div>'), '<div style="overflow:hidden;border-radius:8px">x</div>', "a box still clips what's in it");
	});

	test("links need a web, mail or phone address or a #, and pictures a web address, however they're spelled", () => {
		const hrefOf = (href) => /href="([^"]*)"/.exec(cleanBlockHtml(`<a href="${href}">x</a>`))?.[1] ?? null;
		assert.equal(hrefOf("https://example.com/a?b=1&amp;c=2"), "https://example.com/a?b=1&amp;c=2");
		assert.equal(hrefOf("https://example.com/a?b=1&c=2"), "https://example.com/a?b=1&amp;c=2");
		assert.equal(hrefOf("  mailto:jane@example.com"), "mailto:jane@example.com");
		assert.equal(hrefOf("tel:123"), "tel:123");
		assert.equal(hrefOf("#top"), "#top");
		assert.equal(hrefOf("&#104;ttps://example.com"), "https://example.com");
		assert.equal(hrefOf("https://example.com/?ref={{first_name}}"), "https://example.com/?ref={{first_name}}");
		for (const href of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"&#106;avascript:alert(1)",
			"jav&#x09;ascript:alert(1)",
			"javascript&colon;alert(1)",
			" javascript:alert(1)",
			"vbscript:x",
			"data:text/html;base64,PHNjcmlwdD4=",
			"/relative",
			"//evil.example",
			"relative/path",
			"{{website}}",
			"https://example.com/{{first_name|",
		]) {
			assert.equal(hrefOf(href), null, href);
		}
		assert.equal(cleanBlockHtml('<img src="https://cdn.example.com/a.png" alt="">'), '<img src="https://cdn.example.com/a.png" alt="">');
		for (const src of ["http:/x", "data:image/png;base64,AAA", "blob:https://mail.example.com/1", "/a.png", "//cdn.example.com/a.png", "javascript:alert(1)"]) {
			assert.equal(cleanBlockHtml(`<img src="${src}" alt="">`), "", src);
		}
	});

	test("markup the cleaners don't know can't run in an email, its preview or on the website, whatever path it takes", () => {
		for (const [label, payload] of Object.entries(payloads)) {
			assertInert(cleanBlockHtml(payload), `${label} (block)`);
			const issue = `<p>Before</p>${block(payload)}<p>After</p>`;
			const article = renderIssueBody({ format: "rich", html: issue });
			assert.equal(article.kind, "article");
			assertInert(article.html.replace(/^<p>Before<\/p>|<p>After<\/p>$/g, ""), `${label} (website)`);
			assertInert(emailBody(renderEmail({ format: "rich", html: issue, subject: "Hi", newsletter: NEWSLETTER }).html).replace(/^<p>Before<\/p>|<p>After<\/p>$/g, ""), `${label} (email)`);
			const preview = renderBlockPreview(payload, NEWSLETTER);
			if (preview) assertInert(/<div class="body" style="display:flow-root;">([\s\S]*)<\/div>\n<\/body>/.exec(preview)[1], `${label} (preview)`);
		}
	});

	test("merge tags fill in an HTML block's text and links, and one can't take markup out of an attribute", () => {
		const source =
			'<p>Hi {{first_name|there}}</p><a href="https://example.com/?ref={{first_name}}">Join</a><a title="{{first_name|" href="https://x.test/">}}" onclick="alert(1)">x</a>';
		const email = renderEmail({ format: "rich", html: block(source), subject: "Hi", newsletter: NEWSLETTER }).html;
		const filled = fillForReader({ html: email }, { firstName: '"><img src=x onerror=alert(1)>' }).html;
		assert.ok(filled.includes("<p>Hi &quot;&gt;&lt;img src=x onerror=alert(1)&gt;</p>"), filled);
		assert.ok(filled.includes('<a href="https://example.com/?ref=&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">Join</a>'));
		assert.doesNotMatch(filled, /<a\b[^>]*\sonclick=|<img src=x/);
		assert.ok(fillForReader({ html: email }, { firstName: "Jane" }).html.includes('<a href="https://x.test/">}}" onclick="alert(1)">x</a>'), "it stays text");
	});
});

describe("where HTML blocks go", () => {
	test("emails put each block back in place with its own styles, and its words in the plain-text version", () => {
		const html = `<p>Intro</p>${block('<p style="color:#e11d48">Red <b>news</b></p><img src="https://cdn.example.com/logo.png" width="40" alt="Logo" style="width:40px">')}<p>Outro</p>`;
		const { html: email, text } = renderEmail({ format: "rich", html, subject: "Hi", newsletter: NEWSLETTER });
		assert.equal(
			emailBody(email),
			'<p>Intro</p><div data-html-block=""><p style="color:#e11d48">Red <b>news</b></p><img src="https://cdn.example.com/logo.png" width="40" alt="Logo" style="width:40px"></div><p>Outro</p>',
			"the editor's own picture styles stay off it"
		);
		assert.doesNotMatch(email, /&lt;/, "its HTML never shows as text");
		assert.match(text, /^Intro\n\nRed news\n\nOutro\n\n—/);
		assert.equal(cleanRichHtml(html), html, "the issue's cleaner reads it as words");
	});

	test("a non-breaking space and an entity typed into the HTML stay what they were", () => {
		const stored = '<div data-html-block="">&lt;p&gt;A&nbsp;B &amp;amp; C &amp;nbsp;D&lt;/p&gt;</div>';
		assert.ok(emailBody(renderEmail({ format: "rich", html: stored, subject: "Hi" }).html).includes("<p>A\u00a0B &amp; C &nbsp;D</p>"));
	});

	test("the website sanitizes each block on its own terms, prints the merge tags' fallbacks and loads its pictures lazily", () => {
		const html = `<h2>News</h2>${block('<p style="color:#e11d48;position:fixed" class="x">Hi {{first_name|reader}}</p><img src="https://cdn.example.com/a.png" alt="">')}`;
		assert.deepEqual(renderIssueBody({ format: "rich", html }), {
			kind: "article",
			html: '<h2>News</h2><div data-html-block=""><p style="color:#e11d48">Hi reader</p><img src="https://cdn.example.com/a.png" alt="" loading="lazy" decoding="async" /></div>',
		});
		const markdown = renderIssueBody({ format: "markdown", markdown: block("<b>x</b>") }).html;
		assert.equal(markdown, '<div data-html-block="">&lt;b&gt;x&lt;/b&gt;</div>', "only the editor's issues have HTML blocks");
	});

	test("a block counts as content once it shows something, and its first picture can be the issue's thumbnail", () => {
		assert.equal(hasContent(block("<p></p><script>alert(1)</script>")), false);
		assert.equal(hasContent(block('<img src="https://cdn.example.com/a.png">')), true);
		assert.equal(hasContent(`<p></p>${block("<p>Hi</p>")}`), true);
		const campaign = { format: "rich", subject: "Issue", html: block("<style>p{}</style>") };
		assert.equal(getSendProblem({ campaign, newsletter: NEWSLETTER }), "Add content");

		assert.equal(firstImageUrl({ format: "rich", html: `<p>Hi</p>${block('<img src="https://cdn.example.com/hero.png" width="600">')}` }), "https://cdn.example.com/hero.png");
		const both = `<img src="https://cdn.example.com/first.png">${block('<img src="https://cdn.example.com/second.png">')}`;
		assert.equal(firstImageUrl({ format: "rich", html: both }), "https://cdn.example.com/first.png");
	});

	test("the content check reads a block as readers get it: a link can't hide in its HTML", () => {
		const html = '<p>Hello</p><div data-html-block>&lt;a href=&quot;https://login.example.net/verify&quot;&gt;Verify your account&lt;/a&gt;&lt;script&gt;x()&lt;/script&gt;</div>';
		const input = getReviewInput({ campaign: { format: "rich", subject: "Hi", previewText: "", html }, newsletter: { name: "Field notes" } });
		assert.deepEqual(input.links, ["login.example.net"]);
		assert.equal(input.text, "Hello\n\nVerify your account (https://login.example.net/verify)");

		const plain = '<p>Hello <a href="https://example.com/a">there</a></p>';
		const before = getReviewInput({ campaign: { format: "rich", subject: "Hi", previewText: "", html: plain }, newsletter: {} });
		assert.equal(before.text, htmlToText(plain), "an issue without one reads as it always did");
	});

	test("the editor's preview shows the block cleaned, in the newsletter's email design, and nothing when nothing is left", () => {
		assert.equal(renderBlockPreview("", NEWSLETTER), null);
		assert.equal(renderBlockPreview("<script>alert(1)</script><style>p{}</style>", NEWSLETTER), null);
		const preview = renderBlockPreview('<p style="color:red" onclick="alert(1)">Hi</p>', { ...NEWSLETTER, theme: { id: "editorial" } });
		assert.ok(preview.includes('<div class="body" style="display:flow-root;"><p style="color:red">Hi</p></div>'));
		assert.match(preview, /<base target="_blank">/);
		assert.doesNotMatch(preview, /onclick|<script/);
	});

	test("a preview that loads while its step is hidden waits to show before it's measured", () => {
		const root = { scrollWidth: 0, scrollHeight: 0 };
		const frame = { contentDocument: { documentElement: root }, parentElement: { clientWidth: 0 }, style: {} };
		assert.equal(fitToWidth(frame), null, "its height stays a number instead of 0 / 0");

		Object.assign(root, { scrollWidth: 600, scrollHeight: 240 });
		frame.parentElement.clientWidth = 600;
		assert.equal(fitToWidth(frame), 240);
		frame.parentElement.clientWidth = 300;
		assert.equal(fitToWidth(frame), 120, "a wide block shrinks to fit");
	});
});

describe("an HTML block's code in color", () => {
	const kinds = (source) => highlightHtml(source).map(({ type, text }) => [type, text]);

	test("tags, attributes, values, a style's properties, merge tags, entities and comments each get their color", () => {
		assert.deepEqual(kinds('<!-- sponsor --><td align=center style="color:#fff; padding:{{gap}}">Hi {{first_name|there}} &amp; you</td><br/>'), [
			["comment", "<!-- sponsor -->"],
			["punctuation", "<"],
			["tag", "td"],
			["text", " "],
			["attribute", "align"],
			["punctuation", "="],
			["value", "center"],
			["text", " "],
			["attribute", "style"],
			["punctuation", "="],
			["value", '"'],
			["property", "color"],
			["punctuation", ":"],
			["value", "#fff"],
			["punctuation", ";"],
			["property", " padding"],
			["punctuation", ":"],
			["field", "{{gap}}"],
			["value", '"'],
			["punctuation", ">"],
			["text", "Hi "],
			["field", "{{first_name|there}}"],
			["text", " "],
			["entity", "&amp;"],
			["text", " you"],
			["punctuation", "</"],
			["tag", "td"],
			["punctuation", "><"],
			["tag", "br"],
			["punctuation", "/>"],
		]);
	});

	test("what isn't markup stays text, a script's code included, and a half-written tag colors as far as it goes", () => {
		assert.deepEqual(kinds("1 < 2 {x} <script>if (a<b) go()</script>"), [
			["text", "1 < 2 {x} "],
			["punctuation", "<"],
			["tag", "script"],
			["punctuation", ">"],
			["text", "if (a<b) go()"],
			["punctuation", "</"],
			["tag", "script"],
			["punctuation", ">"],
		]);
		assert.deepEqual(kinds('<a href="https://exam'), [
			["punctuation", "<"],
			["tag", "a"],
			["text", " "],
			["attribute", "href"],
			["punctuation", "="],
			["value", '"https://exam'],
		]);
	});

	test("every character lands in one token, so the colored copy lines up with the field", () => {
		const sources = [...Object.values(payloads), "", "<", "</", "<a", '<a b="', "<!--", "<!", "{{", "&", "<a =x>", "<a b c=d e='f'>", "<p\n  class=x\n>"];
		for (const source of sources) assert.equal(highlightHtml(source).map(({ text }) => text).join(""), source, JSON.stringify(source));
	});

	test("the field shows its code in color behind letters of its own, and types in the field's own value", () => {
		const html = renderToStaticMarkup(createElement(InputHtml, { value: '<p class="x">Hi</p>', onChange: () => {}, "aria-label": "HTML" }));
		assert.match(html, /<div aria-hidden="true"[^>]*><span class="text-zinc-400[^"]*">&lt;<\/span><span class="text-rose-600[^"]*">p<\/span>/);
		assert.match(html, /<textarea[^>]*\sclass="[^"]*\btext-transparent\b[^"]*"[^>]*>&lt;p class=&quot;x&quot;&gt;Hi&lt;\/p&gt;<\/textarea>/);
		assert.match(html, /<textarea[^>]*\saria-label="HTML"/);
	});

	test("a block being edited can be deleted from its header, next to Done", () => {
		const props = {
			node: { attrs: { html: "", isNew: true }, nodeSize: 1 },
			updateAttributes: () => {},
			selected: false,
			editor: {},
			getPos: () => 0,
			extension: { options: { newsletter: NEWSLETTER } },
		};
		const html = renderToStaticMarkup(createElement(BlockHtml, props));
		assert.match(html, /<button[^>]*\saria-label="Delete HTML block"[^>]*><svg[^>]*lucide-trash-2[^>]*>[\s\S]*?<\/button><button[^>]*>Done<\/button>/);
	});
});

describe("HTML blocks through the API and the dashboard", () => {
	let app;
	let m;
	let user;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
		};
		user = await signIn("html-blocks@example.com");
		await activate(user);
		const fields = { name: "Blocks", slug: "html-blocks", fromName: "Field notes", fromEmail: "hello@html-blocks.mailcheapmail.com", postalAddress: "1 Main St, Paris" };
		user.newsletterId = (await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))))).split("/").at(-1);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	});

	after(() => app?.stop());

	test("an issue with an HTML block is kept as written, and its preview shows it cleaned for the reader", async () => {
		const content = `<p>Hello</p>${block('<a href="https://example.com/?u={{first_name}}" style="background:#18181b;color:#ffffff;padding:12px 20px" onclick="alert(1)">Join</a><script>alert(1)</script>')}`;
		const created = await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { newsletter: "html-blocks", subject: "Hi", format: "rich", content } });
		assert.equal(created.status, 201, JSON.stringify(created.body));
		assert.equal(created.body.content, content, "the author's HTML, as written");

		const preview = await callApi("GET", `/api/v1/campaigns/${created.body.id}/preview`, { key: user.key });
		assert.equal(preview.status, 200, JSON.stringify(preview.body));
		assert.ok(preview.body.html.includes('<div data-html-block=""><a href="https://example.com/?u=Jane" style="background:#18181b;color:#ffffff;padding:12px 20px">Join</a></div>'), preview.body.html);
		assert.doesNotMatch(preview.body.html, /<script|onclick|&lt;a/);
		assert.match(preview.body.text, /Join \(https:\/\/example\.com\/\?u=Jane\)/);
	});

	test("the editor saves its blocks like the rest of the issue", async () => {
		const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		const id = url.split("/").at(-1);
		const body = `<p>Hi</p>${block('<p style="text-align:center">Centered</p>')}`;
		assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject: "Saved", previewText: "", body, format: "rich" })), { ok: true });
		const saved = await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key });
		assert.equal(saved.body.content, body);
		assert.equal(saved.body.format, "rich");
	});
});
