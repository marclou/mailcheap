import { SAMPLE_READER, fillForReader } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, withResponsiveImages } from "./render-email.js";

// What a preview shows of a rendered email: an unsubscribe link that goes nowhere, and pictures that fit the frame. Its
// merge tags stay for the preview to fill in for the reader it shows (fillForReader).
export function toPreviewFrame(html) {
	return withResponsiveImages(html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"));
}

// The same, as the sample reader sees it.
export function toPreviewHtml(html) {
	return fillForReader({ html: toPreviewFrame(html) }, SAMPLE_READER).html;
}

// A link clicked in a preview's frame would load its page in place of the email. A web link opens in a new tab instead,
// with nothing of the dashboard passed to it, and a mailto: link opens the mail app; any other, like the "#" a preview's
// unsubscribe link becomes, does nothing. The email itself is left as it is. Each new email is a new document, so each
// load listens again.
export function openLinksOutside(frame) {
	const open = (event) => {
		const link = event.target.closest?.("a[href], area[href]");
		if (!link || event.button > 1) return;
		event.preventDefault();
		const url = readLinkUrl(link.getAttribute("href"));
		if (url?.protocol === "mailto:") window.location.assign(url.href);
		else if (url) window.open(url.href, "_blank", "noopener,noreferrer");
	};
	frame.contentDocument?.addEventListener("click", open);
	frame.contentDocument?.addEventListener("auxclick", open);
}

// A click in a preview puts the focus in its frame, whose key presses never reach the dashboard: Escape there is passed
// on to the dialog, which closes on it. Each new document is a new load, so each load listens again.
export function forwardEscape(frame) {
	frame.contentDocument?.addEventListener("keydown", (event) => {
		if (event.key === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	});
}

// Only a full web or mailto: address: a relative one would resolve against the dashboard's own page.
function readLinkUrl(href) {
	try {
		const url = new URL(String(href ?? "").trim());
		return ["http:", "https:", "mailto:"].includes(url.protocol) ? url : null;
	} catch {
		return null;
	}
}
