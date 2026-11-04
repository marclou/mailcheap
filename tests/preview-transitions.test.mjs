import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { updateEmailInPlace, withTransitions } from "../lib/email-preview.js";
import { renderEmail } from "../lib/render-email.js";

// The Design page's previews follow a theme's changes from where they were: its website with CSS transitions, its email
// in the document its frame keeps.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

// An email's nodes as the frame and DOMParser give them, as far as updateEmailInPlace reads them.
function element(name, attributes, ...children) {
	const values = new Map(Object.entries(attributes).filter(([, value]) => value !== undefined));
	return {
		nodeType: 1,
		nodeName: name.toUpperCase(),
		childNodes: children.map((child) => (typeof child === "string" ? { nodeType: 3, nodeName: "#text", nodeValue: child, childNodes: [] } : child)),
		get attributes() {
			return [...values].map(([name, value]) => ({ name, value }));
		},
		hasAttribute: (name) => values.has(name),
		getAttribute: (name) => values.get(name) ?? null,
		setAttribute: (name, value) => values.set(name, value),
		removeAttribute: (name) => values.delete(name),
	};
}

// The Design page's email, cut down: its column in its aligned cell, a paragraph per line.
function email({ align = "center", padding = "32px 20px", lines = ["Hello"] }) {
	const column = element("table", {}, ...lines.map((line) => element("p", {}, line)));
	const cell = element("td", { align, style: padding ? `padding:${padding};` : undefined }, column);
	return element("html", {}, element("head", {}, element("style", {}, ".body p { margin: 0 0 16px; }")), element("body", {}, cell));
}

// The frame showing it 1024px wide: the 600px column 20px in on the left, or in the middle.
function frameShowing(values) {
	const page = email(values);
	const cell = page.childNodes[1].childNodes[0];
	const column = cell.childNodes[0];
	const slides = [];
	page.querySelector = (selector) => (selector === "td[align] > table" ? column : null);
	Object.assign(column, {
		slides,
		getBoundingClientRect: () => ({ left: cell.getAttribute("align") === "left" ? 20 : 212 }),
		getAnimations: () => slides.filter((slide) => !slide.isCanceled),
		animate(keyframes, options) {
			const slide = { keyframes, ...options };
			slide.cancel = () => (slide.isCanceled = true);
			slides.push(slide);
			return slide;
		},
	});
	return { cell, column, contentDocument: { documentElement: page } };
}

const html = (values) => JSON.stringify(values);

function stubBrowser(t, { isReduced = () => false } = {}) {
	globalThis.Node = { ELEMENT_NODE: 1 };
	globalThis.DOMParser = class {
		parseFromString(values) {
			return { documentElement: email(JSON.parse(values)) };
		}
	};
	globalThis.window = { matchMedia: () => ({ matches: isReduced() }) };
	t.after(() => {
		delete globalThis.Node;
		delete globalThis.DOMParser;
		delete globalThis.window;
	});
}

test("a theme's change takes the place of the email shown, and its column slides from where it was", (t) => {
	stubBrowser(t);
	const frame = frameShowing({});
	assert.equal(updateEmailInPlace(frame, html({ align: "left", padding: "40px 24px", lines: ["Hi"] })), true);
	assert.equal(frame.cell.getAttribute("align"), "left");
	assert.equal(frame.cell.getAttribute("style"), "padding:40px 24px;");
	assert.equal(frame.column.childNodes[0].childNodes[0].nodeValue, "Hi");
	assert.deepEqual(
		frame.column.slides.map(({ keyframes, duration, easing }) => ({ keyframes, duration, easing })),
		[{ keyframes: [{ transform: "translateX(192px)" }, { transform: "none" }], duration: 250, easing: "cubic-bezier(0.77, 0, 0.175, 1)" }],
		"from the middle, where it showed"
	);

	assert.equal(updateEmailInPlace(frame, html({ align: "left", padding: null })), true);
	assert.equal(frame.cell.hasAttribute("style"), false, "what it no longer has goes");
	assert.equal(frame.column.slides.length, 1, "a column that stays doesn't slide");
});

test("a slide under way gives way to the next, and with reduced motion the column moves at once", (t) => {
	let isReduced = false;
	stubBrowser(t, { isReduced: () => isReduced });
	const frame = frameShowing({});
	updateEmailInPlace(frame, html({ align: "left" }));
	updateEmailInPlace(frame, html({ align: "center" }));
	assert.deepEqual(
		frame.column.slides.map(({ keyframes, isCanceled = false }) => [keyframes[0].transform, isCanceled]),
		[
			["translateX(192px)", true],
			["translateX(-192px)", false],
		]
	);

	isReduced = true;
	assert.equal(updateEmailInPlace(frame, html({ align: "left" })), true);
	assert.equal(frame.cell.getAttribute("align"), "left");
	assert.equal(frame.column.slides.length, 2);
});

test("another email, or a frame without one yet, loads anew", (t) => {
	stubBrowser(t);
	const frame = frameShowing({});
	assert.equal(updateEmailInPlace(frame, html({ align: "left", lines: ["Hello", "A paragraph added"] })), false);
	assert.equal(frame.cell.getAttribute("align"), "center", "the email shown stays as it is until then");
	assert.equal(frame.column.slides.length, 0);
	assert.equal(updateEmailInPlace({ contentDocument: null }, html({})), false);
	assert.equal(updateEmailInPlace(null, html({})), false);
});

test("the Design page's corners, spacing, alignment, heading weight and colors only change values in its email", () => {
	const markdown = `# Notes\n\nA [link](https://example.com) and **one thing**.\n\n> A quote\n\n:::box\nA box\n:::\n\n<div data-button=""><a href="https://example.com">Read</a></div>`;
	const nodes = (theme) =>
		withTransitions(renderEmail({ markdown, subject: "This week", newsletter: { name: "Field notes", postalAddress: "1 Main St", theme } }).html).match(
			/<!--|<\/?[a-z][a-z0-9]*/gi
		);
	const changes = [
		{ radius: "none" },
		{ radius: "full" },
		{ spacing: "compact" },
		{ spacing: "spacious" },
		{ emailAlign: "left" },
		{ headingWeight: 800 },
		{ colors: { background: "#101010", text: "#fafafa", accent: "#ff5a1f" } },
	];
	for (const preset of ["mailcheap", "garden"]) {
		const shown = nodes({ preset });
		for (const change of changes) assert.deepEqual(nodes({ preset, ...change }), shown, `${preset}, ${JSON.stringify(change)}`);
	}
});

test("shapes change in place even with reduced motion, and what moves the text only without it", () => {
	assert.match(
		withTransitions("<html><head><title>Hi</title></head><body></body></html>"),
		/<style>\*\{transition-property:border-radius;[^}]*\}@media \(prefers-reduced-motion:no-preference\)\{\*\{transition-property:border-radius,padding,margin,line-height,font-weight\}\}<\/style><\/head>/
	);
	const css = read("app/globals.css");
	const site = css.slice(css.indexOf(".theme-transitions *,"), css.indexOf("@keyframes uploading"));
	assert.match(site, /^\.theme-transitions \*,\n\.theme-transitions \.prose-issue a \{\n  transition-property: box-shadow, border-radius;/);
	assert.match(site, /@media \(prefers-reduced-motion: no-preference\) \{\n\s+transition-property: box-shadow, border-radius, line-height, margin, font-weight;/);
	assert.match(read("components/PreviewTheme.jsx"), /<ScopeTheme theme=\{theme\} mode=\{mode\} className="theme-transitions /);
});
