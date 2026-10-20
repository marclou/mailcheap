import { isSectionPagePath } from "./newsletter-sections.js";

export const NEWSLETTER_SUMMARY_FIELDS = "name slug imageUrl fromEmail description";
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_AUTHOR_BIO_LENGTH = 160;
// They share the account's plan: its emails each month and its subscribers.
export const MAX_NEWSLETTERS_PER_ACCOUNT = 3;
export const NEWSLETTER_LIMIT_MESSAGE = `An account has up to ${MAX_NEWSLETTERS_PER_ACCOUNT} newsletters`;
// A new slug moves the shared address: its domain at the email provider and its DNS records, out of budgets every
// account shares (the DNS helper's records a day, the provider's calls an hour).
export const SLUG_CHANGES = { name: "account-slug-changes", limit: 3, window: "1 d" };
// The dashboard shows one newsletter at a time, the one this cookie names (lib/selected-newsletter.js). The
// newsletter menu reads it too, so it isn't httpOnly: it's only ever checked against the account's newsletters.
export const NEWSLETTER_COOKIE = "newsletter";
// Add a newsletter is a dialog of the newsletter menu: any dashboard page with this in its URL opens it.
export const ADD_NEWSLETTER_PARAM = "new-newsletter";
export const ADD_NEWSLETTER_PATH = `/?${ADD_NEWSLETTER_PARAM}=1`;

const NEWSLETTER_SECTIONS = ["/campaigns", "/contacts", "/newsletters"];

export function toNewsletterOption(newsletter) {
	return { id: String(newsletter._id), name: newsletter.name, imageUrl: newsletter.imageUrl || null };
}

// The account's newsletter the cookie names, else its first.
export function pickNewsletter(newsletters, id) {
	return newsletters.find(({ _id }) => String(_id) === id) ?? newsletters[0] ?? null;
}

// A page of one newsletter from anywhere: /newsletters/<id> switches to it first.
export function getNewsletterPagePath(newsletterId, path) {
	return `/newsletters/${newsletterId}?next=${encodeURIComponent(path)}`;
}

// Switching newsletters on one of a newsletter's pages opens the same section of the other one, and a settings page
// the same settings page. The pages of the whole account (Domains, API keys, billing) stay: null.
export function getSwitchPath(pathname) {
	if (pathname === "/") return "/";
	if (isSectionPagePath(pathname)) return pathname;
	return NEWSLETTER_SECTIONS.find((section) => pathname === section || pathname?.startsWith(`${section}/`)) ?? null;
}
