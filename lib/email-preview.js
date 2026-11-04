import { SAMPLE_READER, fillForReader } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, withEmailMode, withResponsiveImages } from "./render-email.js";

// What a preview shows of a rendered email: an unsubscribe link that goes nowhere, pictures that fit the frame, and its
// light colors, as the mail apps the previews draw show them. Its merge tags stay for the preview to fill in for the
// reader it shows (fillForReader).
export function toPreviewFrame(html) {
	return withEmailMode(withResponsiveImages(html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#")), "light");
}

// The same, as the sample reader sees it.
export function toPreviewHtml(html) {
	return fillForReader({ html: toPreviewFrame(html) }, SAMPLE_READER).html;
}

// A link clicked in a preview's frame would load its page in place of the email. A web link opens in a new tab instead,
// with nothing of the dashboard passed to it, and a mailto: link opens the mail app; any other, like the "#" a preview's
// unsubscribe link becomes, does nothing. The email itself is left as it is. Each load is a new document, so each load
// listens again.
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

// The Design page's previews follow a theme's changes from where they were instead of jumping, its website with
// .theme-transitions (app/globals.css): corners in place, and spacing and heading weight, which move the text around
// them, only without reduced motion. The email's frame keeps its document for it (updateEmailInPlace).
const MOTION = { duration: 250, easing: "cubic-bezier(0.77, 0, 0.175, 1)" };
const TRANSITIONS = `<style>*{transition-property:border-radius;transition-duration:${MOTION.duration}ms;transition-timing-function:${MOTION.easing}}@media (prefers-reduced-motion:no-preference){*{transition-property:border-radius,padding,margin,line-height,font-weight}}</style>`;
const COLUMN_SLIDE = "email-column-slide";

export function withTransitions(html) {
	return html.replace(/<\/head>/i, `${TRANSITIONS}</head>`);
}

// The frame's email becomes html where it is, when only values changed: attributes, text and styles. Its column, in its
// aligned cell (lib/render-email.js), slides from where it showed, like when it moves from the middle to the left. false
// for any other change, like a paragraph added, for the frame to load anew.
export function updateEmailInPlace(frame, html) {
	const current = frame?.contentDocument?.documentElement;
	const next = current && new DOMParser().parseFromString(html, "text/html").documentElement;
	if (!current || !hasSameNodes(current, next)) return false;
	const column = current.querySelector("td[align] > table");
	const from = column?.getBoundingClientRect().left;
	for (const animation of column?.getAnimations() ?? []) if (animation.id === COLUMN_SLIDE) animation.cancel();
	// setAttribute refuses some names the HTML parser takes.
	try {
		copyValues(current, next);
	} catch {
		return false;
	}
	const offset = from - column?.getBoundingClientRect().left;
	if (Math.abs(offset) >= 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		column.animate([{ transform: `translateX(${offset}px)` }, { transform: "none" }], { ...MOTION, id: COLUMN_SLIDE });
	}
	return true;
}

function hasSameNodes(current, next) {
	return (
		current.nodeName === next.nodeName &&
		current.childNodes.length === next.childNodes.length &&
		[...current.childNodes].every((child, index) => hasSameNodes(child, next.childNodes[index]))
	);
}

function copyValues(current, next) {
	if (current.nodeType !== Node.ELEMENT_NODE) {
		if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
		return;
	}
	for (const { name } of [...current.attributes]) if (!next.hasAttribute(name)) current.removeAttribute(name);
	for (const { name, value } of next.attributes) if (current.getAttribute(name) !== value) current.setAttribute(name, value);
	current.childNodes.forEach((child, index) => copyValues(child, next.childNodes[index]));
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
