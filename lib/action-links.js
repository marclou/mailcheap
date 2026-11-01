// The links MailCheap fills in for each reader as its own emails go out (lib/sending-rules.js): the confirmation email's
// button and the last-chance email's. A newsletter's own version of either keeps its link, so the cleaners and the
// editor's buttons take them as links (lib/clean-html.js, lib/buttons.js).
export const CONFIRM_URL_PLACEHOLDER = "{{confirm_url}}";
export const KEEP_URL_PLACEHOLDER = "{{keep_url}}";

export function isActionLink(href) {
	const value = String(href ?? "").trim();
	return value === CONFIRM_URL_PLACEHOLDER || value === KEEP_URL_PLACEHOLDER;
}
