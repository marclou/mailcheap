import { toIssueBody } from "./issue-body.js";
import { sanitizeHtmlBlock, sanitizeIssueHtml } from "./safe-html.js";

// The first picture is the hero, so it loads right away; the rest wait until they scroll into view.
function prioritizeImages(html) {
	let index = 0;
	return html.replace(/<img\b([^>]*?)\/?>/gi, (_, attributes) => {
		index += 1;
		const loading = index === 1 ? ' fetchpriority="high"' : ' loading="lazy"';
		return `<img${attributes}${loading} decoding="async">`;
	});
}

// An issue's content on its archive page (lib/issue-body.js). Inline HTML becomes part of the page, so it goes through
// the sanitizer last, however it was stored, and the editor's HTML blocks through it on their own terms, with their
// inline styles. HTML issues keep their own design in a sandboxed frame, which measures its height once pictures load,
// so nothing in it loads lazily.
export function renderIssueBody(campaign) {
	return toIssueBody(campaign, { clean: (html) => sanitizeIssueHtml(prioritizeImages(html)), cleanBlock: sanitizeHtmlBlock });
}
