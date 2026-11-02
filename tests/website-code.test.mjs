import assert from "node:assert/strict";
import { test } from "node:test";
import { CUSTOM_CODE_MAX_TAGS, insertWebsiteCode, parseWebsiteCode, readCustomCode } from "../lib/website-code.js";
import { getCustomCodeProblem } from "../lib/website-code-check.js";

// What the browser parses a newsletter's custom code into, as its template's nodes.
function parsed(nodeName, attributes = {}, text = "") {
	return {
		nodeName,
		localName: nodeName.toLowerCase(),
		text,
		attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
		getAttribute: (name) => attributes[name] ?? null,
		hasAttribute: (name) => name in attributes,
	};
}

// A page's head, which loads a script it's given a moment later, and what happened in it, in order.
function fakeDocument() {
	const head = [];
	const events = [];
	const describe = (node) => (node.tag ? `script ${node.attributes.src ?? node.text}` : node.nodeName.toLowerCase());
	const d = {
		head: {
			appendChild(node) {
				head.push(node);
				events.push(`add ${describe(node)}`);
				if (node.onload) {
					setTimeout(() => {
						events.push(`load ${describe(node)}`);
						node.onload();
					}, 5);
				}
			},
		},
		createElement: (tag) => ({
			tag,
			attributes: {},
			setAttribute(name, value) {
				this.attributes[name] = value;
			},
		}),
	};
	return { d, head, events };
}

// Code as each tool gives it to paste, IDs made up.
const TOOLS_CODE = {
	clicky:
		'<script async data-id="101234567" src="//static.getclicky.com/js"></script>\n<noscript><p><img alt="Clicky" width="1" height="1" src="//in.getclicky.com/101234567ns.gif" /></p></noscript>',
	plausible:
		'<script async src="https://plausible.io/js/pa-XXXXXXXX.js"></script>\n<script>\n  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};\n  plausible.init()\n</script>',
	hotjar:
		"<!-- Hotjar Tracking Code for example.com -->\n<script>\n    (function(h,o,t,j,a,r){\n        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};\n        h._hjSettings={hjid:1234567,hjsv:6};\n        a=o.getElementsByTagName('head')[0];\n        r=o.createElement('script');r.async=1;\n        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;\n        a.appendChild(r);\n    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');\n</script>",
	linkedin:
		'<script type="text/javascript">\n_linkedin_partner_id = "1234567";\nwindow._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];\n</script>\n<noscript>\n<img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=1234567&fmt=gif" />\n</noscript>',
	fonts:
		'<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">\n<style>\n  body { font-family: "Inter", sans-serif; }\n</style>',
	structuredData: '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Organization", "name": "Field notes"}</script>',
	consent: '<SCRIPT type="text/plain" data-cookieconsent="statistics">anything { goes</SCRIPT >',
};

test("custom code goes in the head in order, its scripts made anew so they run, waiting on a script that blocks", async () => {
	const { d, head, events } = fakeDocument();
	const nodes = [
		parsed("LINK", { rel: "stylesheet", href: "https://cdn.example.com/widget.css" }),
		parsed("SCRIPT", { src: "https://cdn.example.com/library.js" }),
		parsed("SCRIPT", {}, "library.start({ site: 101234567 });"),
		parsed("SCRIPT", { async: "", src: "https://static.example.com/101234567.js" }),
		parsed("SCRIPT", { type: "text/plain", src: "https://consent.example.com/blocked.js" }),
		parsed("SCRIPT", { type: "module", src: "https://cdn.example.com/widget.mjs" }),
	];
	await insertWebsiteCode(nodes, d);

	assert.deepEqual(events, [
		"add link",
		"add script https://cdn.example.com/library.js",
		"load script https://cdn.example.com/library.js",
		"add script library.start({ site: 101234567 });",
		"add script https://static.example.com/101234567.js",
		"add script https://consent.example.com/blocked.js",
		"add script https://cdn.example.com/widget.mjs",
	]);
	assert.equal(head[0], nodes[0], "other tags go in as they are");
	assert.notEqual(head[1], nodes[1], "a parsed script never runs, so each is made anew");
	assert.equal(head[1].async, false, "a script that blocks keeps its place in the order");
	assert.equal(head[2].text, "library.start({ site: 101234567 });");
	assert.deepEqual(head[3].attributes, { async: "", src: "https://static.example.com/101234567.js" });
	assert.equal(head[4].onload, undefined, "a text/plain script, which never loads, holds nothing up");
});

test("only the tags custom code takes reach the page, whatever was saved", () => {
	const children = ["SCRIPT", "META", "STYLE", "DIV", "LINK", "IMG", "NOSCRIPT"].map((name) => parsed(name));
	const template = { content: { children }, innerHTML: "" };
	const d = { createElement: (tag) => (tag === "template" ? template : null) };
	assert.deepEqual(
		parseWebsiteCode("<script></script>", d).map(({ nodeName }) => nodeName),
		["SCRIPT", "STYLE", "LINK", "NOSCRIPT"]
	);
	assert.equal(template.innerHTML, "<script></script>");
});

test("the code tools give works as it is, and its scripts are kept for the save to compile", () => {
	for (const [tool, code] of Object.entries(TOOLS_CODE)) assert.equal(readCustomCode(code).problem, null, tool);
	assert.equal(readCustomCode("").problem, null, "no code at all");

	const { scripts } = readCustomCode(TOOLS_CODE.plausible);
	assert.equal(scripts.length, 1, "a script from a URL has nothing to compile");
	assert.equal(scripts[0].line, 2);
	assert.match(scripts[0].source, /^\n {2}window\.plausible=/);
	assert.deepEqual(readCustomCode(TOOLS_CODE.consent).scripts, [], "nor a script of another type");
	assert.deepEqual(readCustomCode(TOOLS_CODE.structuredData).scripts, []);
});

test("code that wouldn't work names the line to fix and how, as a browser would read it", () => {
	const cases = [
		["window.dataLayer = [];", 1, "text outside a tag. Put JavaScript between <script> and </script>."],
		['<script async src="https://a.example.com/a.js"></script>\n<script>\nvar a = 1;', 2, "the <script> tag isn't closed. Add </script> at its end."],
		['<script src="https://a.example.com/a.js" />', 1, "end the <script> tag with </script>, not />."],
		['<script src="https://a.example.com/a.js></script>', 1, "a quote in the <script> tag isn't closed."],
		['<script src="https://a.example.com/a.js"', 1, "the <script> tag isn't finished. End it with >."],
		["<!-- Start of the code\n<script></script>", 1, "this comment isn't closed. End it with -->."],
		['<script src="https://a.example.com/a.js"></script>\n</script>', 2, "</script> closes a tag that isn't open."],
		['<div id="widget"></div>', 1, "custom code takes <script>, <style>, <link> and <noscript> tags, not <div>."],
		["<constructor>", 1, "custom code takes <script>, <style>, <link> and <noscript> tags, not <constructor>."],
		[
			'<meta name="google-site-verification" content="abc123" />',
			1,
			"meta tags are read before custom code runs, so this one would do nothing. To verify your domain for a tool, use the DNS record it offers instead.",
		],
		["<head>\n<script></script>\n</head>", 1, "leave out <head>: custom code already goes in the head of your pages."],
		["<!DOCTYPE html>\n<html>", 1, "paste only the code the tool gives you, not a whole page."],
		["<body>", 1, "leave out <body>: code a tool says to put in the body works here too."],
		['<base href="https://example.com/">', 1, "leave out <base>: it would change where every link on your website goes."],
		['<script src="http://a.example.com/a.js"></script>', 1, "use https:// for this address: browsers block http:// scripts and styles on your website."],
		['<script src="/a.js"></script>', 1, "the src should be a web address that starts with https://."],
		['<script src="javascript:alert(1)"></script>', 1, "the src should be a web address that starts with https://."],
		['<link rel="stylesheet">', 1, "this <link> needs an href that starts with https://."],
		[
			'<link rel="preload" href="https://a.example.com/a.css" as="style" onload="this.rel=\'stylesheet\'">',
			1,
			"onload doesn't run on your website. Put its code in a <script> tag.",
		],
		[
			'<script src="https://a.example.com/a.js">start();</script>',
			1,
			"browsers skip the code inside a <script> that has a src. Put it in a <script> of its own.",
		],
		[
			'<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-PSW1MY7HB4"></script>',
			2,
			"that's Google Analytics code. Paste it under Google Analytics instead, where it also gets an event for each signup.",
		],
		[
			"<script>(function(w,d,s,l,i){var j=d.createElement(s);j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-ABCDEFGH');</script>",
			1,
			"that's Tag Manager code. Paste it under Tag Manager instead, where it also gets an event for each signup.",
		],
		[
			"<script>!function(f,b,e,v){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '123456789012345');</script>",
			1,
			"that's Meta pixel code. Paste it under Meta pixel instead, where it also gets an event for each signup.",
		],
		["<script>\ndocument.write('<p>Hello</p>');\n</script>", 1, "this script uses document.write, which would erase your website's page. Use the tool's async code instead."],
		['<script type="application/ld+json">{"name": }</script>', 1, "this JSON-LD isn't valid JSON. Check its commas, quotes and brackets."],
	];
	for (const [code, line, message] of cases) assert.deepEqual(readCustomCode(code).problem, { line, message }, code);

	const tags = (count) => Array.from({ length: count }, (_, index) => `<script>window.step${index} = true;</script>`).join("\n");
	assert.equal(readCustomCode(tags(CUSTOM_CODE_MAX_TAGS)).problem, null);
	assert.deepEqual(readCustomCode(tags(CUSTOM_CODE_MAX_TAGS + 1)).problem, {
		line: CUSTOM_CODE_MAX_TAGS + 1,
		message: `custom code takes up to ${CUSTOM_CODE_MAX_TAGS} tags.`,
	});
});

test("before it's saved, each script's JavaScript is compiled, never run, and an error names its own line", () => {
	globalThis.customCodeRan = false;
	const script = (body) => `<script async src="https://a.example.com/a.js"></script>\n<script>\n${body}\n</script>`;
	assert.equal(getCustomCodeProblem(script("window.ready = true;\nglobalThis.customCodeRan = true;")), null);
	assert.equal(globalThis.customCodeRan, false, "compiling runs nothing");

	assert.equal(
		getCustomCodeProblem(script("(function () {\n  if (window.ready) {\n    start();\n})();")),
		"Custom code, line 6: this script has a JavaScript error: Unexpected token ')'."
	);
	assert.equal(getCustomCodeProblem(script("(function () {\n  start();")), "Custom code, line 5: this script ends too early: a } or a ) is missing.");
	assert.equal(
		getCustomCodeProblem(script("gtag(“config”, “AW-123456789”);")),
		"Custom code, line 3: this script has curly quotes (“ ”), which JavaScript doesn't read. Type straight quotes (\") instead."
	);
	assert.equal(getCustomCodeProblem(script("const note = “It’s fine in a string”;")), "Custom code, line 3: this script has curly quotes (“ ”), which JavaScript doesn't read. Type straight quotes (\") instead.");
	assert.equal(getCustomCodeProblem(script('const note = "It’s fine in a string";')), null, "inside a string they're text");
	assert.equal(getCustomCodeProblem("<div></div>"), "Custom code, line 1: custom code takes <script>, <style>, <link> and <noscript> tags, not <div>.");
	assert.equal(getCustomCodeProblem('<script type="module">import x from "https://a.example.com/x.js";</script>'), null, "a module isn't compiled as a script");
	assert.equal(
		getCustomCodeProblem(`<script>\n${"(".repeat(9000)}${")".repeat(9000)}\n</script>`),
		"Custom code, line 1: this script nests too deeply for browsers to read.",
		"a script the parser can't finish is refused, not let through"
	);
});
