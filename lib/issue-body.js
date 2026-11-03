import { beforeLastTagEnd, cleanBlockHtml, cleanRichHtml, expandHtmlBlocks, keepSafeUrls } from "./clean-html.js";
import { markdownToHtml } from "./markdown.js";
import { withMergeFallbacks } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail, withResponsiveImages } from "./render-email.js";
import { forWeb } from "./sections.js";

// An issue's content on its page, { kind, html }. Editor and Markdown issues are an article in the archive's typography,
// HTML issues, every one sent through the API included, a frame that keeps their own design. {{first_name}} prints its
// fallback: no reader's name is ever public, and only the sections set to show on the website do (lib/sections.js).
// clean: what an article goes through last, and cleanBlock each of the editor's HTML blocks, which keep their inline
// styles: the archive's sanitizer (lib/archive-content.js), or these cleaners for a preview whose frame runs nothing.
export function toIssueBody(campaign, { clean = (html) => html, cleanBlock = cleanBlockHtml } = {}) {
	if (campaign.format === "rich") {
		const body = clean(cleanRichHtml(withMergeFallbacks(forWeb(campaign.html), { isHtml: true })));
		return { kind: "article", html: expandHtmlBlocks(body, cleanBlock) };
	}
	if (campaign.format !== "html") return { kind: "article", html: clean(cleanRichHtml(markdownToHtml(withMergeFallbacks(campaign.markdown)))) };

	const rendered = renderEmail({
		format: "html",
		html: campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		isWebVersion: true,
	});
	const html = withMergeFallbacks(rendered.html, { isHtml: true });
	const framed = beforeLastTagEnd(keepSafeUrls(withResponsiveImages(html)), (part) =>
		part.replace(/<head([^>]*)>/i, (head) => `${head}<base target="_blank">`)
	);
	return { kind: "frame", html: framed.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#") };
}
