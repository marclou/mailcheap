import { decodeEntities, expandHtmlBlocks } from "./clean-html.js";

const SKIPPED_URL_PATTERN = /(pixel|tracking|spacer|beacon|1x1|favicon|emoji)/i;
// Narrower images are icons, avatars and social buttons, not the picture of the issue.
const MIN_IMAGE_WIDTH = 120;

// Each tag is read once, up to its ">": one before another's ">" (<img <img src=…>) has a src only
// if that one does, and none can end after the last ">". The address is the one it loads: the editor writes a & in it
// as &amp;, and HTML from elsewhere may not.
function* htmlImages(html) {
	for (const [tag] of html.slice(0, html.lastIndexOf(">") + 1).matchAll(/<img\b[^>]*>/gi)) {
		const url = /\bsrc=["'](https:\/\/[^"']+)["']/i.exec(tag)?.[1];
		if (url) yield [tag, decodeEntities(url)];
	}
}

// Same for "![alt](https://…": the alt text ends at the next "]".
function* markdownImages(markdown) {
	const link = /\((https:\/\/[^)\s]+)/y;
	let cursor = 0;
	for (const alt of markdown.slice(0, markdown.lastIndexOf("]") + 1).matchAll(/!\[[^\]]*\]/g)) {
		if (alt.index < cursor) continue;
		link.lastIndex = alt.index + alt[0].length;
		const match = link.exec(markdown);
		if (!match) continue;
		cursor = link.lastIndex;
		yield [alt[0] + match[0], match[1]];
	}
}

// The pictures that can stand for the issue, in order and each once, up to limit. An HTML block's pictures count where
// they are in the issue.
export function listImageUrls({ format, html, markdown }, limit = 1) {
	const isMarkdown = format === "markdown";
	const source = isMarkdown ? String(markdown ?? "") : format === "rich" ? expandHtmlBlocks(html) : String(html ?? "");
	const urls = [];

	for (const [tag, url] of isMarkdown ? markdownImages(source) : htmlImages(source)) {
		if (SKIPPED_URL_PATTERN.test(url) || urls.includes(url)) continue;
		const width = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1]);
		if (width && width < MIN_IMAGE_WIDTH) continue;
		urls.push(url);
		if (urls.length >= limit) break;
	}
	return urls;
}

export function firstImageUrl(content) {
	return listImageUrls(content)[0] ?? null;
}

// Local files and pictures uploaded to Vercel Blob or the images CDN go through Next's resizer (allowed in
// next.config). Other hosts and generated cards load as they are.
export function isOptimizableImage(src, env = process.env) {
	if (src.startsWith("/") || /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(src)) return true;
	const cdn = env.IMAGES_CDN_URL;
	return Boolean(cdn) && URL.canParse(cdn) && src.startsWith(`${new URL(cdn).origin}/`);
}
