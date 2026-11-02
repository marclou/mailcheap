// A newsletter's own code for its website (its Website settings, update_newsletter's customCode): the tags another tool
// gives for the head of its pages. It only ever reaches the pages on the newsletter's own domain: app/api/website-code
// answers there alone, and the pages ask for it there alone (components/ScriptWebsiteCode.jsx). Its address on the
// shared domain shares a site with every other newsletter's website and, on MailCheap Cloud, the dashboard.
export const CUSTOM_CODE_MAX_LENGTH = 20_000;
// A few tools' code is a handful of tags; the save compiles each script (lib/website-code-check.js).
export const CUSTOM_CODE_MAX_TAGS = 50;
export const WEBSITE_CODE_PATH = "/api/website-code";

// The tags that still work in a page's head once it has loaded, which is when the code goes in. Meta tags don't:
// search engines and the tools that ask for one read the page as it's first sent.
const CODE_TAGS = new Set(["script", "style", "link", "noscript"]);
// Their content is text up to their end tag, as browsers read it while scripts run.
const TEXT_TAGS = new Set(["script", "style", "noscript"]);
const CLASSIC_SCRIPT_TYPE = /^(text|application)\/(x-)?(java|ecma)script$/i;

const TEXT_OUTSIDE_TAG = "text outside a tag. Put JavaScript between <script> and </script>.";
const WHOLE_PAGE = "paste only the code the tool gives you, not a whole page.";
const TAG_PROBLEMS = new Map([
	["html", WHOLE_PAGE],
	["head", "leave out <head>: custom code already goes in the head of your pages."],
	["body", "leave out <body>: code a tool says to put in the body works here too."],
	["base", "leave out <base>: it would change where every link on your website goes."],
	[
		"meta",
		"meta tags are read before custom code runs, so this one would do nothing. To verify your domain for a tool, use the DNS record it offers instead.",
	],
]);
// The website loads these from their own fields, which also send each signup (lib/website-analytics.js).
const TOOL_CODE = [
	{ name: "Google Analytics", pattern: /googletagmanager\.com\/gtag\/js\?id=G-/i },
	{ name: "Tag Manager", pattern: /googletagmanager\.com\/gtm\.js/i },
	{ name: "Meta pixel", pattern: /connect\.facebook\.net\/[\w-]+\/fbevents\.js/i },
];

const SPACE = /\s*/y;
const TAG_START = /<(\/?)([a-z][a-z0-9-]*)/iy;
const ATTRIBUTE_NAME = /[^\s/>][^\s/>=]*/y;
const EQUALS = /\s*=\s*/y;
const UNQUOTED_VALUE = /[^\s>]*/y;

// What keeps the code from working, read as a browser reads it, with its line: { line, message }, or null. scripts: the
// JavaScript of each script written in the code, from its line, for the save to compile (lib/website-code-check.js).
export function readCustomCode(code) {
	const text = String(code ?? "");
	const scripts = [];
	const problemAt = (index, message) => ({ problem: { line: lineAt(text, index), message }, scripts });
	let at = 0;
	let tagCount = 0;
	while (at < text.length) {
		const open = text.indexOf("<", at);
		const outside = text.slice(at, open === -1 ? text.length : open);
		if (outside.trim()) return problemAt(at + outside.search(/\S/), TEXT_OUTSIDE_TAG);
		if (open === -1) break;
		at = open;
		if (text.startsWith("<!--", at)) {
			const close = text.indexOf("-->", at + 2);
			if (close === -1) return problemAt(at, "this comment isn't closed. End it with -->.");
			at = close + 3;
			continue;
		}
		const start = match(TAG_START, text, at);
		if (!start) return problemAt(at, /^<!doctype/i.test(text.slice(at, at + 9)) ? WHOLE_PAGE : TEXT_OUTSIDE_TAG);
		const [opening, slash, tagName] = start;
		const name = tagName.toLowerCase();
		const tag = readTag(text, at + opening.length);
		if (tag.problem === "unfinished") return problemAt(at, `the <${slash}${name}> tag isn't finished. End it with >.`);
		if (tag.problem === "quote") return problemAt(at, `a quote in the <${name}> tag isn't closed.`);
		if (slash) {
			if (name !== "link") return problemAt(at, TAG_PROBLEMS.get(name) ?? `</${name}> closes a tag that isn't open.`);
			at = tag.end;
			continue;
		}
		const tagProblem = getTagProblem(name, tag.attributes);
		if (tagProblem) return problemAt(at, tagProblem);
		tagCount += 1;
		if (tagCount > CUSTOM_CODE_MAX_TAGS) return problemAt(at, `custom code takes up to ${CUSTOM_CODE_MAX_TAGS} tags.`);
		const tagStart = at;
		at = tag.end;
		if (!TEXT_TAGS.has(name)) continue;
		if (tag.isSelfClosing) return problemAt(tagStart, `end the <${name}> tag with </${name}>, not />.`);
		const close = findEndTag(text, name, at);
		const closeEnd = close === -1 ? -1 : text.indexOf(">", close);
		if (closeEnd === -1) return problemAt(tagStart, `the <${name}> tag isn't closed. Add </${name}> at its end.`);
		if (name === "script") {
			const source = text.slice(at, close);
			const scriptProblem = getScriptProblem(tag.attributes, source);
			if (scriptProblem) return problemAt(tagStart, scriptProblem);
			if (source.trim() && isClassicScript(tag.attributes)) scripts.push({ line: lineAt(text, at), source });
		}
		at = closeEnd + 1;
	}
	return { problem: null, scripts };
}

// The browser's own parse of what was saved, the tags custom code takes alone.
export function parseWebsiteCode(code, d = document) {
	const template = d.createElement("template");
	template.innerHTML = code;
	return [...template.content.children].filter((node) => CODE_TAGS.has(node.localName));
}

// Into the head, in order, as the page's own HTML would run: a script the browser would wait for loads before what
// comes after it. Scripts are made anew, since parsed ones never run.
export async function insertWebsiteCode(nodes, d = document) {
	for (const node of nodes) {
		if (node.nodeName !== "SCRIPT") {
			d.head.appendChild(node);
			continue;
		}
		const script = d.createElement("script");
		for (const { name, value } of node.attributes) script.setAttribute(name, value);
		script.text = node.text;
		if (!isBlockingScript(node)) {
			d.head.appendChild(script);
			continue;
		}
		script.async = false;
		const loaded = new Promise((resolve) => {
			script.onload = resolve;
			script.onerror = resolve;
		});
		d.head.appendChild(script);
		await loaded;
	}
}

// A classic script from a URL, which the browser runs before going on; a module waits for the page, and a script of
// another type, like a consent tool's text/plain, never loads.
function isBlockingScript(node) {
	const type = node.getAttribute("type");
	const isClassic = !type || CLASSIC_SCRIPT_TYPE.test(type);
	return isClassic && node.hasAttribute("src") && !node.hasAttribute("async") && !node.hasAttribute("defer");
}

function isClassicScript(attributes) {
	const type = attributes.get("type")?.trim();
	return !type || CLASSIC_SCRIPT_TYPE.test(type);
}

// Event handler attributes never run on the website, whose pages refuse them (script-src-attr in next.config.mjs).
function getTagProblem(name, attributes) {
	if (TAG_PROBLEMS.has(name)) return TAG_PROBLEMS.get(name);
	if (!CODE_TAGS.has(name)) return `custom code takes <script>, <style>, <link> and <noscript> tags, not <${name}>.`;
	const handler = [...attributes.keys()].find((attribute) => /^on[a-z]+$/.test(attribute));
	if (handler) return `${handler} doesn't run on your website. Put its code in a <script> tag.`;
	const urlAttribute = name === "script" ? "src" : name === "link" ? "href" : null;
	if (!urlAttribute) return null;
	const url = attributes.get(urlAttribute)?.trim();
	if (url === undefined) return name === "link" ? "this <link> needs an href that starts with https://." : null;
	if (/^http:\/\//i.test(url)) return "use https:// for this address: browsers block http:// scripts and styles on your website.";
	return /^(https:)?\/\/[^\s"'<>]+$/i.test(url) ? null : `the ${urlAttribute} should be a web address that starts with https://.`;
}

function getScriptProblem(attributes, source) {
	const hasCode = Boolean(source.trim());
	if (attributes.has("src") && hasCode && isClassicScript(attributes)) {
		return "browsers skip the code inside a <script> that has a src. Put it in a <script> of its own.";
	}
	const tool = TOOL_CODE.find(({ pattern }) => pattern.test(`${attributes.get("src") ?? ""}\n${source}`));
	if (tool) return `that's ${tool.name} code. Paste it under ${tool.name} instead, where it also gets an event for each signup.`;
	if (attributes.get("type")?.trim().toLowerCase() === "application/ld+json" && !isJson(source)) {
		return "this JSON-LD isn't valid JSON. Check its commas, quotes and brackets.";
	}
	if (hasCode && isClassicScript(attributes) && /\bdocument\.write(ln)?\s*\(/.test(source)) {
		return "this script uses document.write, which would erase your website's page. Use the tool's async code instead.";
	}
	return null;
}

// The tag's attributes, from after its name up to its ">", as browsers read them: the first of a name counts.
function readTag(text, from) {
	const attributes = new Map();
	let at = from;
	for (;;) {
		at += match(SPACE, text, at)[0].length;
		if (at >= text.length) return { problem: "unfinished" };
		if (text[at] === ">") return { attributes, end: at + 1 };
		if (text.startsWith("/>", at)) return { attributes, end: at + 2, isSelfClosing: true };
		if (text[at] === "/") {
			at += 1;
			continue;
		}
		const [name] = match(ATTRIBUTE_NAME, text, at);
		at += name.length;
		let value = "";
		const equals = match(EQUALS, text, at);
		if (equals) {
			at += equals[0].length;
			const quote = text[at];
			if (quote === '"' || quote === "'") {
				const close = text.indexOf(quote, at + 1);
				if (close === -1) return { problem: "quote" };
				value = text.slice(at + 1, close);
				at = close + 1;
			} else {
				[value] = match(UNQUOTED_VALUE, text, at);
				at += value.length;
			}
		}
		if (!attributes.has(name.toLowerCase())) attributes.set(name.toLowerCase(), value);
	}
}

// Where the tag's content ends: its end tag, whatever its case, followed by a space, a slash or a ">".
function findEndTag(text, name, from) {
	const pattern = new RegExp(`</${name}[\\s/>]`, "gi");
	pattern.lastIndex = from;
	return pattern.exec(text)?.index ?? -1;
}

function isJson(text) {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

function match(pattern, text, at) {
	pattern.lastIndex = at;
	return pattern.exec(text);
}

function lineAt(text, index) {
	let line = 1;
	for (let newline = text.indexOf("\n"); newline !== -1 && newline < index; newline = text.indexOf("\n", newline + 1)) line += 1;
	return line;
}
