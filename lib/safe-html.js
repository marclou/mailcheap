import sanitizeHtml from "sanitize-html";
import { CONTENT_TAGS, KEPT_ATTRIBUTES } from "./clean-html.js";

// The cleaners match tags with patterns; this parses the HTML, so whatever they miss can't run on the
// archive page. Client components import clean-html.js and render-email.js, so the package stays here.
const OPTIONS = {
	allowedTags: CONTENT_TAGS,
	allowedAttributes: {
		...KEPT_ATTRIBUTES,
		img: [
			...KEPT_ATTRIBUTES.img,
			{ name: "loading", values: ["lazy"] },
			{ name: "fetchpriority", values: ["high"] },
			{ name: "decoding", values: ["async"] },
		],
		// data-card: a box drawn from a SparkLoop card (lib/sparkloop-cards.js), styled apart.
		div: [
			{ name: "data-callout", values: [""] },
			{ name: "data-card", values: [""] },
		],
	},
	allowedEmptyAttributes: ["alt", "data-callout", "data-card"],
	allowedSchemes: ["http", "https", "mailto"],
	allowProtocolRelative: false,
	exclusiveFilter: isOffWebImage,
};

function isOffWebImage(frame) {
	return frame.tag === "img" && !/^https?:\/\//i.test(frame.attribs.src ?? "");
}

export function sanitizeIssueHtml(html) {
	return sanitizeHtml(html, OPTIONS);
}
