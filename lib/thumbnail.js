const SKIPPED_URL_PATTERN = /(pixel|tracking|spacer|beacon|1x1|favicon|emoji)/i;
// Narrower images are icons, avatars and social buttons, not the picture of the issue.
const MIN_IMAGE_WIDTH = 120;

// Each tag is read once, up to its ">": one before another's ">" (<img <img src=…>) has a src only
// if that one does, and none can end after the last ">".
function* htmlImages(html) {
	for (const [tag] of html.slice(0, html.lastIndexOf(">") + 1).matchAll(/<img\b[^>]*>/gi)) {
		const url = /\bsrc=["'](https:\/\/[^"']+)["']/i.exec(tag)?.[1];
		if (url) yield [tag, url];
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

export function firstImageUrl({ format, html, markdown }) {
	const isMarkdown = format === "markdown";
	const source = String((isMarkdown ? markdown : html) ?? "");

	for (const [tag, url] of isMarkdown ? markdownImages(source) : htmlImages(source)) {
		if (SKIPPED_URL_PATTERN.test(url)) continue;
		const width = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1]);
		if (width && width < MIN_IMAGE_WIDTH) continue;
		return url;
	}
	return null;
}

// Local files and pictures uploaded to the Neon Object Storage bucket go through Next's resizer (allowed in
// next.config).
// Other hosts and generated cards load as they are.
export function isOptimizableImage(src) {
	return src.startsWith("/") || /^https:\/\/[a-z0-9-]+\.storage\.[a-z0-9-]+\.[a-z0-9-]+\.aws\.neon\.tech\/mailcheap-images\//i.test(src);
}
