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

function hasAttribute(attributes, name) {
	for (const [, key] of attributes.matchAll(ATTRIBUTE_PATTERN)) if (key.toLowerCase() === name) return true;
	return false;
}

// The editor's boxes keep only their marker; the archive and emails style them.
function keepAttributes(tag, attributes) {
	if (tag === "div") return hasAttribute(attributes, "data-callout") ? CALLOUT_ATTRIBUTES : "";
	const allowed = KEPT_ATTRIBUTES[tag];
	if (!allowed) return "";
	let kept = "";
	for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE_PATTERN)) {
		const key = name.toLowerCase();
		const value = double ?? single ?? bare;
		if (!allowed.includes(key) || value === undefined) continue;
		if (key === "href" && !/^(https?:|mailto:|#|\/)/i.test(value.trim())) continue;
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

export function keepContentAttributes(html) {
	// No "<" after the last ">" opens a tag.
	const end = html.lastIndexOf(">") + 1;
	const tags = html.slice(0, end).replace(TAG_PATTERN, (_, slash, tag, attributes) => {
		if (tag === undefined) return "&lt;";
		const name = tag.toLowerCase();
		if (!CONTENT_TAGS.includes(name)) return "";
		if (slash) return `</${name}>`;
		const isSelfClosing = /\/\s*$/.test(attributes);
		return `<${name}${keepAttributes(name, attributes)}${isSelfClosing && name !== "img" ? " /" : ""}>`;
	});
	return tags + html.slice(end).replaceAll("<", "&lt;");
}

// Pictures load from the web only; blob: URLs are uploads that never finished.
export function keepWebImages(html) {
	return html.replace(/<img\b(?![^>]*\bsrc="https?:\/\/)[^>]*>/gi, "");
}

// The editor's HTML. Blank lines are spacing the author typed, so they stay; images that never
// finished uploading (blob: URLs) and the editor's trailing empty paragraph go.
export function cleanRichHtml(html) {
	return keepWebImages(keepContentAttributes(removeUnsafeElements(String(html ?? ""))))
		.replace(/(?:<p><\/p>\s*)+$/, "")
		.replaceAll("<p></p>", "<p><br></p>")
		.trim();
}
