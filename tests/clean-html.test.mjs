import assert from "node:assert/strict";
import { test } from "node:test";
import { renderIssueBody } from "../lib/archive-content.js";
import { CONTENT_TAGS, cleanRichHtml, keepContentAttributes } from "../lib/clean-html.js";
import { sanitizeIssueHtml } from "../lib/safe-html.js";

const payloads = {
	audit: '<x_ style="position:fixed;inset:0" onpointerover="alert(document.domain)"></x_>',
	underscore: '<a_ href="https://x.test" onclick="alert(1)">a_</a_><img_ src=x onerror=alert(1)>',
	punctuation:
		"<x-y onpointerover=alert(1)>dash</x-y> <x.y onpointerover=alert(1)>dot</x.y> <x:y onpointerover=alert(1)>colon</x:y> <x$ onpointerover=alert(1)>dollar</x$> <xé onpointerover=alert(1)>accent</xé>",
	whitespace: "<p\u00a0onpointerover=alert(1)>nbsp</p><img\vsrc=x onerror=alert(1)>",
	mixedCase: '<X_ OnPointerOver="alert(1)">upper</X_><IMG SRC=x ONERROR=alert(1)><A HREF="JaVaScRiPt:alert(1)">link</A>',
	joined: "<<x_>p onclick=alert(1)>joined<<x_>img src=x onerror=alert(1)>",
	splitScript: "<scr<script>ipt>alert(1)</script><scr<x_>ipt>alert(2)</script><script>alert(3)</script >",
	svg: '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg><svg><a href="javascript:alert(1)">s</a></svg>',
	math: "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>",
	noscript: '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
	template: "<template><img src=x onerror=alert(1)></template>",
	textarea: '<textarea><p title="</textarea><img src=x onerror=alert(1)>"></p></textarea>',
	title: '<title><p title="</title><img src=x onerror=alert(1)>"></p></title>',
	xmp: '<xmp><p title="</xmp><img src=x onerror=alert(1)>"></p></xmp>',
	iframe: '<iframe srcdoc="<script>alert(1)</script>"></iframe><iframe srcdoc="&lt;img src=x onerror=alert(1)&gt;">',
	quotedGt: '<a title="x>" onclick="alert(1)" href="https://ok.test">q</a><img alt=">" src="https://ok.test/a.png" onerror="alert(1)">',
	encodedUrl:
		'<a href="&#106;avascript:alert(1)">e1</a><a href="jav&#x09;ascript:alert(1)">e2</a><a href="javascript&colon;alert(1)">e3</a><a href="java\nscript:alert(1)">e4</a><a href=" javascript:alert(1)">e5</a>',
	dataUrl:
		'<a href="data:text/html,<script>alert(1)</script>">d1</a><img src="data:text/html;base64,PHNjcmlwdD4="><object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
	valueBreakout: '<a href="/<img src=x//">x</a><p>" onmouseover="alert(1)" x="</p>',
};

// Cleaned HTML is written in one shape: lowercase allowed tags with double-quoted attributes, and no
// "<" anywhere else. Text can still read like markup, so only tags are checked.
const CLEAN_TAG_PATTERN = /<\/?([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/g;
const URL_PATTERNS = { href: /^(https?:|mailto:|#|\/)/i, src: /^https?:\/\//i };

function assertInert(html, label) {
	const text = html.replace(CLEAN_TAG_PATTERN, (_, tag, attributes) => {
		assert.ok(CONTENT_TAGS.includes(tag), `${label}: <${tag}> in ${html}`);
		for (const [, name, value = ""] of attributes.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) {
			assert.ok(!name.startsWith("on"), `${label}: ${name} in ${html}`);
			assert.ok(!/javascript:|data:/i.test(value), `${label}: ${name}="${value}"`);
			if (URL_PATTERNS[name]) assert.match(value, URL_PATTERNS[name], `${label}: ${name}="${value}"`);
		}
		return "";
	});
	assert.ok(!text.includes("<"), `${label}: markup outside the allowed tags in ${html}`);
	assert.doesNotMatch(html, /<\/?(script|style|svg|math|iframe|template|textarea|title|xmp|noscript|object|embed)\b/i, label);
}

test("tags named outside the allowlist go with their attributes, whatever their spelling", () => {
	assert.equal(cleanRichHtml(payloads.audit), "");
	assert.equal(cleanRichHtml(payloads.underscore), "a_");
	assert.equal(cleanRichHtml(payloads.punctuation), "dash dot colon dollar accent");
	assert.equal(cleanRichHtml(payloads.mixedCase), "upper<a>link</a>");
	assert.equal(keepContentAttributes('<P CLASS="x">Hi</P ><br/>'), "<p>Hi</p><br />");
});

test("dropping a tag can't join a stray < to the text after it", () => {
	assert.equal(cleanRichHtml("<<x_>p onclick=alert(1)>joined"), "&lt;p onclick=alert(1)>joined");
});

test("a < kept in a link can't be cut open by the passes after it", () => {
	const html = cleanRichHtml(payloads.valueBreakout);
	assert.ok(html.startsWith('<a href="/&lt;img src=x//">x</a>'), html);
	assertInert(html, "valueBreakout");
});

test("markup the cleaners don't know can't run on an archive page, whatever path it takes", () => {
	for (const [label, payload] of Object.entries(payloads)) {
		assertInert(cleanRichHtml(payload), `${label} (editor HTML)`);
		for (const campaign of [
			{ format: "rich", html: payload },
			{ format: "markdown", markdown: payload },
			{ format: "markdown", markdown: payload, source: "api" },
		]) {
			const body = renderIssueBody(campaign);
			assert.equal(body.kind, "article");
			assertInert(body.html, `${label} (${campaign.source ?? ""} ${campaign.format} issue)`);
		}
		assert.equal(renderIssueBody({ format: "html", html: payload, source: "api" }).kind, "frame", label);
	}
});

test("a long run of < is escaped, keeping the text before it", () => {
	const { html } = renderIssueBody({ format: "rich", html: `<p>Hi</p>${"<".repeat(500_000)}>` });
	assert.ok(html.startsWith("<p>Hi</p>&lt;&lt;"));
});

test("a run of unclosed iframes that gets past the cleaners stays inert, instead of overflowing the stack", () => {
	const html = sanitizeIssueHtml(`<p>Hi</p>${"<iframe>".repeat(20_000)}`);
	assert.ok(html.startsWith("<p>Hi</p>"));
	assertInert(html, "unclosed iframes");
});
