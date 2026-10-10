// SparkLoop's script on signup pages, shared by the archive and the Signup flow page.

// One script per publication, as SparkLoop's Settings → Script page shows it, from the host its
// js.sparkloop.app address redirects to, so archive pages skip the redirect.
export function getScriptUrl(publicationUuid) {
	return `https://script.sparkloop.app/embed.js?publication_id=${encodeURIComponent(publicationUuid)}`;
}

export function getScriptTag(publicationUuid) {
	return `<script async src="${getScriptUrl(publicationUuid)}" data-sparkloop></script>`;
}

function normalize(url) {
	return String(url ?? "")
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/+$/, "");
}

// The script only opens the flow on pages its visibility rules allow. A rule is a URL; this reads it as
// a prefix, which is what a page and the pages under it need.
export function isShownOn(visibility, url) {
	if (!visibility || visibility.all_pages) return true;
	const page = normalize(url);
	return (visibility.page_rules ?? []).some((rule) => {
		const prefix = normalize(rule).replace(/\*+$/, "");
		return Boolean(prefix) && page.startsWith(prefix);
	});
}

// Mailcheap's forms submit without a page load, so they tell the script about each signup themselves.
// The script loads a moment after the page does and announces nothing when ready, so a signup before
// that waits for it, for a while.
const WAIT_MS = 15_000;
const POLL_MS = 250;

export function openSignupFlow(email) {
	if (typeof window === "undefined" || !email) return;
	if (!document.querySelector("script[data-sparkloop]")) return;
	const startedAt = Date.now();
	const track = () => {
		if (typeof window.SL?.trackSubscriber === "function") window.SL.trackSubscriber(email);
		else if (Date.now() - startedAt < WAIT_MS) setTimeout(track, POLL_MS);
	};
	track();
}
