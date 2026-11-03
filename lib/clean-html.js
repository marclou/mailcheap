import { isActionLink } from "./action-links.js";
import { getButtonAttributes } from "./buttons.js";
import { CALLOUT_ATTRIBUTES } from "./callouts.js";

// The elements issues are written with. Any other tag goes, keeping its text.
export const CONTENT_TAGS = [
	"a",
	"b",
	"blockquote",
	"br",
	"code",
	"del",
	"div",
	"em",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"i",
	"img",
	"li",
	"mark",
	"ol",
	"p",
	"pre",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
];
// Where the editor puts a picture in the column. Center is the default and carries no attribute.
export const IMAGE_ALIGNMENTS = ["left", "center", "right"];
// Attributes that carry content; inline styles and classes are the source's theme, not ours.
export const KEPT_ATTRIBUTES = {
	a: ["href", "target", "rel"],
	img: ["src", "alt", "width", "height", "data-align"],
	ol: ["start"],
	td: ["colspan", "rowspan"],
	th: ["colspan", "rowspan"],
	h2: ["id"],
	h3: ["id"],
	h4: ["id"],
};
// HTML blocks (components/BlockHtml.jsx) keep what their author wrote as text in a <div> with this marker, so the
// cleaners read it as words. expandHtmlBlocks puts it back as markup, cleaned on its own terms by cleanBlockHtml.
export const HTML_BLOCK_MARKER = ' data-html-block=""';
// What an HTML block keeps: the issue's elements and those emails are laid out with, their layout attributes and inline
// styles. Classes and ids mean nothing in an email, and on the website they would reach the page's own.
export const HTML_BLOCK_TAGS = [
	...CONTENT_TAGS,
	...["abbr", "address", "article", "aside", "caption", "center", "cite", "col", "colgroup", "dd", "dl", "dt"],
	...["figcaption", "figure", "font", "footer", "header", "ins", "kbd", "q", "section", "tfoot", "wbr"],
];
export const HTML_BLOCK_ATTRIBUTES = {
	"*": ["style", "align", "valign", "width", "height", "bgcolor", "title", "dir"],
	a: ["href", "target", "rel"],
	img: ["src", "alt", "border"],
	table: ["border", "cellpadding", "cellspacing", "role"],
	td: ["colspan", "rowspan"],
	th: ["colspan", "rowspan", "scope"],
	col: ["span"],
	colgroup: ["span"],
	ol: ["start", "type"],
	ul: ["type"],
	li: ["value"],
	font: ["color", "face", "size"],
};
// The properties emails are styled with. Positions, transforms, outlines and shadows could cover what's around the
// block, so they go, and so does a picture's overflow, which would let object-fit and object-position paint it past its
// box.
export const HTML_BLOCK_STYLES = [
	...["background", "background-color", "background-image", "background-position", "background-repeat", "background-size"],
	...["border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-style", "border-width"],
	...["border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
	...["border-collapse", "border-spacing", "table-layout", "caption-side", "vertical-align"],
	...["color", "font", "font-family", "font-size", "font-style", "font-variant", "font-weight", "letter-spacing", "line-height"],
	...["text-align", "text-decoration", "text-indent", "text-transform", "white-space", "word-break", "word-spacing", "word-wrap"],
	...["overflow-wrap", "direction", "list-style", "list-style-type", "list-style-position"],
	...["width", "height", "min-width", "max-width", "min-height", "max-height", "box-sizing", "display", "float", "clear"],
	...["object-fit", "object-position", "overflow", "opacity", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"],
	...["padding", "padding-top", "padding-right", "padding-bottom", "padding-left"],
];
// A declaration's value: words, numbers, colors, gradients and quoted font names. Nothing else gets through: no url(),
// no expression(), no escape or comment, and no merge tag, which would be filled in after the cleaning.
const CSS_TEXT = String.raw`[a-z0-9#.,%\s+\-/!]`;
const CSS_COLOR = String.raw`(?:rgba?|hsla?)\([a-z0-9.,%\s+\-/]*\)`;
const CSS_GRADIENT = String.raw`linear-gradient\((?:[a-z0-9#.,%\s+\-/]|${CSS_COLOR})*\)`;
const CSS_QUOTED = String.raw`'[\w .,\-]*'|"[\w .,\-]*"`;
export const HTML_BLOCK_CSS_VALUE = new RegExp(String.raw`^(?:${CSS_TEXT}|${CSS_COLOR}|${CSS_GRADIENT}|${CSS_QUOTED})+$`, "i");
// Never negative, so a block can't pull itself over what's around it.
export const HTML_BLOCK_CSS_MARGIN = /^[a-z0-9.%\s!]+$/i;
const MAX_CSS_VALUE = 500;
const BLOCK_URL_PATTERNS = { href: /^(?:https?:|mailto:|tel:|#)/i, src: /^https?:\/\//i };
const BLOCK_VALUE_PATTERNS = { target: /^_blank$/i, role: /^(?:presentation|none)$/i, dir: /^(?:ltr|rtl|auto)$/i };
// Merge tags are filled in after the cleaning (lib/merge-tags.js): one starting in an attribute and ending past it would
// take the quote that closes the attribute with it.
const OPEN_MERGE_TAG_PATTERN = /\{\{(?![^{}]*\}\})/;
// Gone with what's in them, which no email shows, like the title of a whole page pasted in.
const HIDDEN_BLOCK_ELEMENT = {
	start: /<(head|title|template|textarea|select|object|audio|video|canvas|map)\b/gi,
	end: /<\/(head|title|template|textarea|select|object|audio|video|canvas|map)\s*>/gi,
};
// <!DOCTYPE html>, <?xml ?> and Outlook's <![if !mso]>, which would show as text.
const DECLARATION_PATTERN = /<[!?][^>]*>/g;
const HTML_BLOCK_PATTERN = /<div data-html-block="">([^<]*)<\/div>/g;
const DROPPED_NAMES = ["style", "script", "noscript", "svg", "form", "button", "iframe"].join("|");
// Each goes with its content, up to the nearest end tag of its name.
const DROPPED_ELEMENT = {
	start: new RegExp(`<(${DROPPED_NAMES})\\b`, "gi"),
	end: new RegExp(`<\\/(${DROPPED_NAMES})\\s*>`, "gi"),
};
const DROPPED_TAG_PATTERN = new RegExp(`<\\/?(?:${DROPPED_NAMES})\\b[^>]*>`, "gi");
// In a body that never settles, what the passes would remove gets its "<" escaped instead.
const UNSAFE_START_PATTERN = new RegExp(`<(?=\\/?(?:${DROPPED_NAMES})\\b|!--|link\\b)`, "gi");
// Real content settles after one pass; nesting like <scr<script>ipt> takes one per level.
const MAX_PASSES = 8;
const ATTRIBUTE_PATTERN = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const URL_ATTRIBUTE_PATTERN = /(?<=[\s/"'])((?:xlink:)?(?:href|src|action|formaction|background|poster)\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/gi;
const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|#|\/|data:image\/)/i;
// Browsers end a tag name only at whitespace, "/" or ">", so <x_>, <img_> and <x:y> are elements whose
// handlers run. A "<" that opens no tag is escaped: dropping the tag after it would join the two.
const TAG_PATTERN = /<(\/?)([a-z][^\t\n\f\r />]*)([^>]*)>|</gi;
const ELEMENT_TAG_PATTERN = /<(\/?)([a-z][^\t\n\f\r />]*)([^>]*)>/gi;
const SECTION_TAG_PATTERN = /<\/?section/i;
// The attributes that say who sees a section and where (lib/sections.js).
const SECTION_RULE_ATTRIBUTES = new Set(["data-show", "data-hide", "data-where"]);

function hasAttribute(attributes, name) {
	for (const [, key] of attributes.matchAll(ATTRIBUTE_PATTERN)) if (key.toLowerCase() === name) return true;
	return false;
}

function getAttribute(attributes, name) {
	for (const [, key, double, single, bare] of attributes.matchAll(ATTRIBUTE_PATTERN)) if (key.toLowerCase() === name) return double ?? single ?? bare;
	return undefined;
}

// The editor's boxes and HTML blocks keep only their marker, and buttons their place too; the archive and emails style
// them.
function keepAttributes(tag, attributes) {
	if (tag === "div" && hasAttribute(attributes, "data-html-block")) return HTML_BLOCK_MARKER;
	if (tag === "div" && hasAttribute(attributes, "data-button")) return getButtonAttributes(getAttribute(attributes, "data-align"));
	if (tag === "div") return hasAttribute(attributes, "data-callout") ? CALLOUT_ATTRIBUTES : "";
	const allowed = KEPT_ATTRIBUTES[tag];
	if (!allowed) return "";
	let kept = "";
	for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE_PATTERN)) {
		const key = name.toLowerCase();
		const value = double ?? single ?? bare;
		if (!allowed.includes(key) || value === undefined) continue;
		if (key === "href" && !/^(https?:|mailto:|#|\/)/i.test(value.trim()) && !isActionLink(value)) continue;
		if (key === "data-align" && !IMAGE_ALIGNMENTS.includes(value)) continue;
		// Later passes find tags by pattern, so a "<" left in a value would cut it open.
		kept += ` ${key}="${value.replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`;
	}
	return kept;
}

// A pattern whose matches end with ">" can only match before the last one. From a "<" after it, the
// pattern would read to the end of the body and fail, which takes quadratic time over a run of
// unclosed tags, so only the part up to it is searched.
export function beforeLastTagEnd(html, transform) {
	const end = html.lastIndexOf(">") + 1;
	return transform(html.slice(0, end)) + html.slice(end);
}

// Like html.replace(/<(name)…[\s\S]*?<\/\1…>/gi, …): each start tag found by `start` (name in group 1)
// takes the nearest end tag of its name after it, found by `end`. End tags are looked up instead of
// searched for, so a start tag with none after it costs nothing. A `start` that reads up to ">" must
// run within beforeLastTagEnd; `accepts` can turn a start tag down without skipping what it covers.
export function replaceElements(html, { start, end, accepts = () => true, replace = () => "" }) {
	const endTags = new Map();
	for (const tag of html.matchAll(end)) {
		const name = tag[1].toLowerCase();
		if (!endTags.has(name)) endTags.set(name, { tags: [], next: 0 });
		endTags.get(name).tags.push(tag);
	}
	let result = "";
	let cursor = 0;
	for (const tag of html.matchAll(start)) {
		if (tag.index < cursor || !accepts(tag)) continue;
		const ends = endTags.get(tag[1].toLowerCase());
		const contentStart = tag.index + tag[0].length;
		while (ends && ends.next < ends.tags.length && ends.tags[ends.next].index < contentStart) ends.next += 1;
		const endTag = ends?.tags[ends.next];
		if (!endTag) continue;
		result += html.slice(cursor, tag.index) + replace(tag, html.slice(contentStart, endTag.index));
		cursor = endTag.index + endTag[0].length;
	}
	return result + html.slice(cursor);
}

// Same as removing /<!--[\s\S]*?-->|<link\b[^>]*>/gi, but a comment or link left open is passed over
// at once instead of after reading to the end of the body.
function removeCommentsAndLinks(html) {
	const lastCommentEnd = html.lastIndexOf("-->");
	const lastTagEnd = html.lastIndexOf(">");
	let result = "";
	let cursor = 0;
	for (const tag of html.matchAll(/<!--|<link\b/gi)) {
		const isComment = tag[0] === "<!--";
		const from = tag.index + tag[0].length;
		if (tag.index < cursor || from > (isComment ? lastCommentEnd : lastTagEnd)) continue;
		result += html.slice(cursor, tag.index);
		cursor = isComment ? html.indexOf("-->", from) + 3 : html.indexOf(">", from) + 1;
	}
	return result + html.slice(cursor);
}

export function removeUnsafeElements(html) {
	let body = html;
	// Removing a tag can join its neighbours into a new one (<scr<script>ipt>), so repeat until stable.
	for (let pass = 0, previous = null; body !== previous; pass += 1) {
		if (pass === MAX_PASSES) {
			body = body.replace(UNSAFE_START_PATTERN, "&lt;");
			break;
		}
		previous = body;
		const withoutElements = replaceElements(body, DROPPED_ELEMENT);
		body = removeCommentsAndLinks(beforeLastTagEnd(withoutElements, (part) => part.replace(DROPPED_TAG_PATTERN, "")));
	}
	// A tag left open at the end would swallow the page markup that follows it. Replacing /<[^>]*$/
	// instead takes quadratic time on a long run of "<".
	const open = body.indexOf("<", body.lastIndexOf(">") + 1);
	return open === -1 ? body : body.slice(0, open);
}

// Framed issues keep their markup, but their links open outside the frame's sandbox.
export function keepSafeUrls(html) {
	return html.replace(URL_ATTRIBUTE_PATTERN, (match, prefix, value) => {
		const url = value.replace(/^["']|["']$/g, "").trim();
		return SAFE_URL_PATTERN.test(url) ? match : `${prefix}"#"`;
	});
}

// Every tag is written anew from its name and the attributes keep() returns, and any other "<" is escaped.
function keepTags(html, tags, keep) {
	// No "<" after the last ">" opens a tag.
	const end = html.lastIndexOf(">") + 1;
	const kept = html.slice(0, end).replace(TAG_PATTERN, (_, slash, tag, attributes) => {
		if (tag === undefined) return "&lt;";
		const name = tag.toLowerCase();
		if (!tags.includes(name)) return "";
		if (slash) return `</${name}>`;
		const isSelfClosing = /\/\s*$/.test(attributes);
		return `<${name}${keep(name, attributes)}${isSelfClosing && name !== "img" ? " /" : ""}>`;
	});
	return kept + html.slice(end).replaceAll("<", "&lt;");
}

export function keepContentAttributes(html) {
	return keepTags(html, CONTENT_TAGS, keepAttributes);
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

function escapeAttribute(value) {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function keepBlockStyles(css, tag) {
	const kept = [];
	for (const declaration of css.split(";")) {
		const colon = declaration.indexOf(":");
		const name = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration.slice(colon + 1).trim();
		const pattern = name.startsWith("margin") ? HTML_BLOCK_CSS_MARGIN : HTML_BLOCK_CSS_VALUE;
		const isAllowed = HTML_BLOCK_STYLES.includes(name) && !(tag === "img" && name === "overflow");
		if (colon > 0 && isAllowed && value.length <= MAX_CSS_VALUE && pattern.test(value)) kept.push(`${name}:${value}`);
	}
	return kept.join(";");
}

// Checked as browsers read them, entities decoded. Links and pictures keep a web address (a link also mailto:, tel: or
// a #), and inline styles their allowed declarations. The first of an attribute's copies is the one that counts.
function keepBlockAttributes(tag, attributes) {
	const allowed = [...HTML_BLOCK_ATTRIBUTES["*"], ...(HTML_BLOCK_ATTRIBUTES[tag] ?? [])];
	const seen = new Set();
	let kept = "";
	for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE_PATTERN)) {
		const key = name.toLowerCase();
		const raw = double ?? single ?? bare;
		if (raw === undefined || !allowed.includes(key) || seen.has(key)) continue;
		seen.add(key);
		const value = decodeEntities(raw).trim();
		if (OPEN_MERGE_TAG_PATTERN.test(value) || BLOCK_VALUE_PATTERNS[key]?.test(value) === false) continue;
		if (BLOCK_URL_PATTERNS[key]) {
			if (BLOCK_URL_PATTERNS[key].test(value)) kept += ` ${key}="${escapeAttribute(value)}"`;
		} else if (key === "style") {
			const styles = keepBlockStyles(value, tag);
			if (styles) kept += ` style="${escapeAttribute(styles)}"`;
		} else {
			kept += ` ${key}="${raw.replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}"`;
		}
	}
	return kept;
}

// What an HTML block shows, from what its author wrote: its elements and their inline styles, as keepBlockAttributes
// says, and its text. Scripts, styles, forms and frames go with what's in them, like anything an email can't show.
export function cleanBlockHtml(html) {
	return keepWebImages(keepTags(readBlockMarkup(html), HTML_BLOCK_TAGS, keepBlockAttributes)).trim();
}

// An HTML block's HTML as cleanBlockHtml reads its tags: without what no email shows, and without declarations.
function readBlockMarkup(html) {
	const body = replaceElements(removeUnsafeElements(String(html ?? "")), HIDDEN_BLOCK_ELEMENT);
	return beforeLastTagEnd(body, (part) => part.replace(DECLARATION_PATTERN, ""));
}

// Each HTML block of cleaned issue HTML back as markup, cleaned by clean (cleanBlockHtml, or the sanitizer on top of it
// on the website). One left with nothing goes, and so does one with a section's rules in its HTML: sections are resolved
// around blocks, never in them, so what that section holds would reach every reader.
export function expandHtmlBlocks(html, clean = cleanBlockHtml) {
	return String(html ?? "").replace(HTML_BLOCK_PATTERN, (_, source) => {
		const markup = readBlockSource(source);
		const block = hasSectionRules(markup) ? "" : clean(markup).trim();
		return block ? `<div${HTML_BLOCK_MARKER}>${block}</div>` : "";
	});
}

// Whether an HTML block's HTML has a <section> with a section's rules (lib/sections.js), its tags and their attributes
// read as cleanBlockHtml reads them.
export function hasSectionRules(html) {
	const source = String(html ?? "");
	if (!SECTION_TAG_PATTERN.test(source)) return false;
	const body = readBlockMarkup(source);
	for (const [, isEnd, name, attributes] of body.slice(0, body.lastIndexOf(">") + 1).matchAll(ELEMENT_TAG_PATTERN)) {
		if (isEnd || name.toLowerCase() !== "section") continue;
		for (const [, attribute] of attributes.matchAll(ATTRIBUTE_PATTERN)) if (SECTION_RULE_ATTRIBUTES.has(attribute.toLowerCase())) return true;
	}
	return false;
}

// Each HTML block of cleaned issue HTML as its author wrote it, uncleaned.
export function readHtmlBlocks(html) {
	return [...String(html ?? "").matchAll(HTML_BLOCK_PATTERN)].map(([, source]) => readBlockSource(source));
}

// The editor writes a non-breaking space as &nbsp;, which plain text reads as a space.
function readBlockSource(text) {
	return decodeEntities(text.replaceAll("&nbsp;", "\u00a0"));
}

// Cleaned issue HTML without its HTML blocks, whose HTML is the text of their <div>.
export function removeHtmlBlocks(html) {
	return String(html ?? "").replace(HTML_BLOCK_PATTERN, " ");
}

// Pictures load from the web only; blob: URLs are uploads that never finished.
export function keepWebImages(html) {
	return html.replace(/<img\b(?![^>]*\bsrc="https?:\/\/)[^>]*>/gi, "");
}

// The <section> elements of an issue (lib/sections.js), each kept without its tags or dropped with what's in it, as
// keep(attributes, depth) says, depth counting the sections it's in. Read as the cleaners read tags, once scripts and
// comments are gone, so a </section> in one of those, or in another tag's attribute, closes nothing. A section inside a
// dropped one goes with it, one left open runs to the end, and an end tag with nothing to close goes. HTML without a
// section comes back as it was.
export function resolveSectionElements(html, keep) {
	const source = String(html ?? "");
	if (!SECTION_TAG_PATTERN.test(source)) return source;
	const body = removeUnsafeElements(source);
	const open = [];
	let hidden = 0;
	let result = "";
	let cursor = 0;
	for (const tag of body.slice(0, body.lastIndexOf(">") + 1).matchAll(ELEMENT_TAG_PATTERN)) {
		if (tag[2].toLowerCase() !== "section") continue;
		if (hidden === 0) result += body.slice(cursor, tag.index);
		cursor = tag.index + tag[0].length;
		if (tag[1]) {
			if (open.length > 0 && !open.pop()) hidden -= 1;
			continue;
		}
		const isKept = hidden === 0 && keep(tag[3], open.length);
		open.push(isKept);
		if (!isKept) hidden += 1;
	}
	return hidden === 0 ? result + body.slice(cursor) : result;
}

// The editor's HTML. Blank lines are spacing the author typed, so they stay; images that never
// finished uploading (blob: URLs) and the editor's trailing empty paragraph go. Sections are for their reader or page to
// resolve first: any still there goes with its content, rather than showing to everyone.
export function cleanRichHtml(html) {
	return keepWebImages(keepContentAttributes(resolveSectionElements(removeUnsafeElements(String(html ?? "")), () => false)))
		.replace(/(?:<p><\/p>\s*)+$/, "")
		.replaceAll("<p></p>", "<p><br></p>")
		.trim();
}
