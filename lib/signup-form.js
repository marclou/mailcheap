import { getEmailTheme, resolveTheme } from "./themes.js";

// A signup form for the newsletter's own site, off until its owner turns it on. Two ways to paste it: a script that adds
// it in a frame, in the newsletter's theme (/embed/<newsletter id>), or a plain HTML form that works without JavaScript,
// while no sites are listed. Both post to /api/embed/<newsletter id>, and its contacts come in with the source "embed"
// and the site's host.
export const SIGNUP_FORM_LAYOUTS = ["inline", "card"];
export const SIGNUP_FORM_DEFAULTS = { layout: "inline", buttonText: "Subscribe", placeholder: "you@example.com" };
export const SIGNUP_FORM_LIMITS = { buttonText: 30, placeholder: 60, headline: 80, subheadline: 200, domains: 10 };
export const FIRST_NAME_PLACEHOLDER = "First name";
export const EMBED_SOURCE = "embed";
export const EMBED_SCRIPT_PATH = "/embed.js";
// Vercel BotID's browser code, for the framed form (app/embed/botid/route.js).
export const EMBED_BOTID_PATH = "/embed/botid";
// Signups per visitor and per address, whichever newsletters ask, and per newsletter (app/api/embed/[id]/route.js).
// Past its newsletter's limit, the form refuses signups until the rate drops: a flood costs the form a few minutes,
// never strangers' inboxes. The plain HTML form, which no browser check covers, gets a much smaller share.
export const SIGNUP_FORM_RATE_LIMITS = {
	perIp: { name: "embed-ip", limit: 5, window: "10 m" },
	perEmail: { name: "embed-email", limit: 3, window: "1 d" },
	perNewsletter: { name: "embed-newsletter", limit: 300, window: "10 m" },
	perNewsletterPlain: { name: "embed-newsletter-plain", limit: 20, window: "10 m" },
	perNewsletterPlainDaily: { name: "embed-newsletter-plain-day", limit: 200, window: "1 d" },
};

const HOST_PATTERN = /^(?=.{1,253}$)(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63})$/;

export function getSignupFormPaths(newsletterId) {
	const id = String(newsletterId);
	return { frame: `/embed/${id}`, endpoint: `/api/embed/${id}`, done: `/embed/${id}/done` };
}

// The stored settings with their defaults, as the dashboard, the API and the form read them. The card's headline and
// the line under it are null while they follow the newsletter's name and description, and empty when hidden.
export function toSignupFormSettings(signupForm) {
	return {
		enabled: Boolean(signupForm?.enabled),
		layout: SIGNUP_FORM_LAYOUTS.includes(signupForm?.layout) ? signupForm.layout : SIGNUP_FORM_DEFAULTS.layout,
		headline: toOwnText(signupForm?.headline),
		subheadline: toOwnText(signupForm?.subheadline),
		askFirstName: Boolean(signupForm?.askFirstName),
		buttonText: String(signupForm?.buttonText ?? "").trim() || SIGNUP_FORM_DEFAULTS.buttonText,
		placeholder: String(signupForm?.placeholder ?? "").trim() || SIGNUP_FORM_DEFAULTS.placeholder,
		allowedDomains: Array.isArray(signupForm?.allowedDomains) ? signupForm.allowedDomains : [],
	};
}

function toOwnText(value) {
	return typeof value === "string" ? value.trim() : null;
}

// What the card shows above the form; an empty one shows nothing.
export function getSignupFormHeading(settings, newsletter) {
	return {
		headline: settings.headline ?? newsletter?.name ?? "",
		subheadline: settings.subheadline ?? newsletter?.description ?? "",
	};
}

// "https://www.Example.com/blog" and "*.example.com" are example.com, which covers its subdomains too. Null for anything
// that isn't a host name.
export function normalizeDomain(value) {
	let host = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!host) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
		if (!URL.canParse(host)) return null;
		host = new URL(host).hostname;
	}
	host = host.replace(/^\*\./, "").replace(/^www\./, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
	return HOST_PATTERN.test(host) ? host : null;
}

// The domains as saved: valid ones only, without duplicates.
export function normalizeDomains(values) {
	return [...new Set((values ?? []).map(normalizeDomain).filter(Boolean))];
}

export function getSignupFormProblem(settings) {
	const { layout, headline, subheadline, buttonText, placeholder, allowedDomains } = settings;
	if (!SIGNUP_FORM_LAYOUTS.includes(layout)) return `The form's layout is ${SIGNUP_FORM_LAYOUTS.join(" or ")}`;
	if (headline?.length > SIGNUP_FORM_LIMITS.headline) return `Keep the headline under ${SIGNUP_FORM_LIMITS.headline} characters`;
	if (subheadline?.length > SIGNUP_FORM_LIMITS.subheadline) {
		return `Keep the text under the headline under ${SIGNUP_FORM_LIMITS.subheadline} characters`;
	}
	if (buttonText.length > SIGNUP_FORM_LIMITS.buttonText) {
		return `Keep the button under ${SIGNUP_FORM_LIMITS.buttonText} characters`;
	}
	if (placeholder.length > SIGNUP_FORM_LIMITS.placeholder) {
		return `Keep the placeholder under ${SIGNUP_FORM_LIMITS.placeholder} characters`;
	}
	if (allowedDomains.length > SIGNUP_FORM_LIMITS.domains) return `List ${SIGNUP_FORM_LIMITS.domains} sites at most`;
	const invalid = allowedDomains.find((domain) => !normalizeDomain(domain));
	return invalid ? `${invalid} isn't a site's address. Use one like example.com` : null;
}

// The host of a page's address or origin, lowercase. Null for "null" origins and anything else unreadable.
export function getHost(value) {
	if (!value || !URL.canParse(value)) return null;
	const { protocol, hostname } = new URL(value);
	return protocol === "http:" || protocol === "https:" ? hostname.toLowerCase() : null;
}

// Without a list, any site can hold the form. A listed domain covers its subdomains. Browsers name the site honestly;
// scripts name any, so the list only keeps the form off other sites' pages, and the endpoint's other checks stop scripts.
export function isAllowedHost(host, allowedDomains) {
	if (!allowedDomains?.length) return true;
	if (!host) return false;
	const bare = host.replace(/^www\./, "");
	return allowedDomains.some((domain) => bare === domain || bare.endsWith(`.${domain}`));
}

// With a list of sites, the browser itself keeps the frame off every other site: the site's usual policy with only those
// sites, and their subdomains, as its frame's parent. Null without a list, where next.config's frame-ancestors * applies.
export function getFramePolicy(allowedDomains) {
	if (!allowedDomains?.length) return null;
	const sites = allowedDomains.flatMap((domain) => [domain, `*.${domain}`]).join(" ");
	return `frame-ancestors ${sites}; object-src 'none'; base-uri 'self'; form-action 'self'; script-src-attr 'none'`;
}

export function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

// What the owner pastes on their site. The plain form takes the theme's colors and corners, and the site's own font; as a
// card, it sits in a box under its headline. newsletter: its name and description, which the headline follows by default.
// With a list of sites, html is null: a plain form can't prove which site it's on, so only the framed one works.
export function getEmbedCode({ appUrl, newsletterId, settings, theme, newsletter }) {
	const script = `<script src="${appUrl}${EMBED_SCRIPT_PATH}" data-form="${newsletterId}" async></script>`;
	if (settings.allowedDomains?.length) return { script, html: null };
	const paths = getSignupFormPaths(newsletterId);
	const email = getEmailTheme(resolveTheme(theme));
	const radius = `${Math.min(email.radius.button, 12)}px`;
	const field = `min-width:0;box-sizing:border-box;padding:10px 12px;font:inherit;color:${email.text};background:${email.background};border:1px solid ${email.border};border-radius:${radius}`;
	const { headline, subheadline } = getSignupFormHeading(settings, newsletter);
	const heading =
		settings.layout === "card"
			? [
					headline &&
						`<p style="margin:0;font-size:19px;font-weight:${email.headingWeight ?? 600};line-height:1.25;color:${email.heading}">${escapeHtml(headline)}</p>`,
					subheadline &&
						`<p style="margin:${headline ? "6px" : "0"} 0 0;font-size:15px;line-height:1.5;color:${email.muted}">${escapeHtml(subheadline)}</p>`,
				].filter(Boolean)
			: [];
	const form = [
		`<form action="${appUrl}${paths.endpoint}" method="post" style="display:flex;flex-wrap:wrap;gap:8px;max-width:440px;${heading.length ? "margin:16px 0 0;" : ""}font:inherit">`,
		settings.askFirstName &&
			`  <input type="text" name="first_name" autocomplete="given-name" placeholder="${FIRST_NAME_PLACEHOLDER}" aria-label="First name" style="flex:1 1 100%;${field}">`,
		`  <input type="email" name="email" required placeholder="${escapeHtml(settings.placeholder)}" aria-label="Email" style="flex:1 1 220px;${field}">`,
		`  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">`,
		`  <button type="submit" style="padding:10px 18px;font:inherit;font-weight:600;color:${email.buttonText};background:${email.button};border:0;border-radius:${radius};cursor:pointer">${escapeHtml(settings.buttonText)}</button>`,
		"</form>",
	].filter(Boolean);
	if (settings.layout !== "card") return { script, html: form.join("\n") };
	const card = `<div style="max-width:440px;box-sizing:border-box;padding:20px;color:${email.text};background:${email.background};border:1px solid ${email.border};border-radius:${Math.min(email.radius.box, 16)}px">`;
	return { script, html: [card, ...[...heading, ...form].map((line) => `  ${line}`), "</div>"].join("\n") };
}
