// SparkLoop cards put an offer or a recommended newsletter inside an issue. The editor stores a card
// as an empty div whose attributes hold a snapshot of it; emails and the archive draw it from those.
// This module runs in the browser too (the editor's preview), so it imports nothing server-only.

// SparkLoop's links take the reader's email, so they don't have to type it to subscribe or claim. Card
// links carry this placeholder, and only the click redirect fills it in (fillCardLink): the address never
// sits in an email, and a placeholder anyone writes in an issue fills nothing.
export const SUBSCRIBER_EMAIL_PLACEHOLDER = "{{sparkloop_email}}";
const PLACEHOLDER_PARAMETER_PATTERN = /(\?|&amp;|&)email=\{\{sparkloop_email\}\}/g;
// An issue with dozens of cards is a mistake or an attack; each one adds about 2 KB to every email.
export const MAX_CARDS = 10;

export const CARD_KINDS = ["offer", "recommendation"];
export const CARD_FIELDS = {
	url: "data-url",
	image: "data-image",
	logo: "data-logo",
	label: "data-label",
	brand: "data-brand",
	title: "data-title",
	description: "data-description",
	cta: "data-cta",
	// "true" for a paid recommendation: like an offer, the newsletter is paid for it.
	paid: "data-paid",
};
export const CARD_ATTRIBUTES = ["data-sparkloop-card", ...Object.values(CARD_FIELDS)];
export const CARD_LIMITS = { label: 40, brand: 80, title: 160, description: 400, cta: 40 };

// Every div start tag matches, so a failed match never rescans: the attributes are checked in code.
const DIV_PATTERN = /<div\b([^>]*)>(\s*<\/div>)?/gi;
const CARD_MARKER_PATTERN = /\sdata-sparkloop-card\b/i;
const ATTRIBUTE_PATTERN = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
// Only SparkLoop's link pages and its CDN for pictures; a card is never a way to link anywhere else.
const CARD_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*(recs\.page|sparkloop\.app)\//i;
const IMAGE_URL_PATTERN = /^https:\/\/[^\s"'<>]+$/i;
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const DEFAULT_CARD_TEXT = {
	offer: { label: "Sponsored", cta: "Claim offer" },
	recommendation: { label: "Recommended read", cta: "Subscribe for free" },
};
export const SPONSORED_LABEL = "Sponsored";

// Readers are told when a placement is paid for, whatever its wording: offers and paid recommendations
// always say Sponsored. Only a free recommendation's label can change.
export function isSponsored(card) {
	return card?.kind === "offer" || card?.paid === true || card?.paid === "true";
}

export function getCardLabel(card) {
	if (isSponsored(card)) return SPONSORED_LABEL;
	return String(card?.label ?? "").trim() || DEFAULT_CARD_TEXT.recommendation.label;
}

function escapeAttribute(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function decodeAttribute(value) {
	return String(value ?? "")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

function truncate(value, max) {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function isCardUrl(value) {
	return CARD_URL_PATTERN.test(String(value ?? ""));
}

// What the editor stores: the div and its attributes, nothing inside.
export function cardToHtml(card) {
	const kind = CARD_KINDS.includes(card?.kind) ? card.kind : "offer";
	const attributes = Object.entries(CARD_FIELDS)
		.filter(([key]) => card[key])
		.map(([key, name]) => ` ${name}="${escapeAttribute(card[key])}"`)
		.join("");
	return `<div data-sparkloop-card="${kind}"${attributes}></div>`;
}

export function readCard(attributes) {
	const values = {};
	for (const [, name, double, single, bare] of String(attributes).matchAll(ATTRIBUTE_PATTERN)) {
		values[name.toLowerCase()] = decodeAttribute(double ?? single ?? bare ?? "");
	}
	const kind = CARD_KINDS.includes(values["data-sparkloop-card"]) ? values["data-sparkloop-card"] : "offer";
	const card = { kind };
	for (const [key, name] of Object.entries(CARD_FIELDS)) {
		const value = values[name];
		card[key] = CARD_LIMITS[key] ? truncate(value, CARD_LIMITS[key]) : String(value ?? "").trim();
	}
	if (!isCardUrl(card.url)) return null;
	if (!IMAGE_URL_PATTERN.test(card.image)) card.image = "";
	if (!IMAGE_URL_PATTERN.test(card.logo)) card.logo = "";
	card.paid = card.paid === "true";
	card.label = getCardLabel(card);
	card.cta ||= DEFAULT_CARD_TEXT[kind].cta;
	return card.title ? card : null;
}

// The email link carries the reader's address; the archive's doesn't, since anyone can open it.
export function getCardHref(url, { isEmail }) {
	const clean = withoutSubscriberEmail(url);
	if (!isEmail) return clean;
	return `${clean}${clean.includes("?") ? "&" : "?"}email=${SUBSCRIBER_EMAIL_PLACEHOLDER}`;
}

export function withoutSubscriberEmail(url) {
	const text = String(url ?? "");
	try {
		const parsed = new URL(text);
		if (!parsed.searchParams.has("email")) return text;
		parsed.searchParams.delete("email");
		return parsed.toString();
	} catch {
		return text.replace(PLACEHOLDER_PARAMETER_PATTERN, "");
	}
}

// The click redirect: a SparkLoop link gets the reader's address, any other link loses the placeholder.
// No email (a test send, a link scanner) means no address.
export function fillCardLink(url, email) {
	const text = String(url ?? "");
	if (!text.includes(SUBSCRIBER_EMAIL_PLACEHOLDER)) return text;
	if (!email || !isCardUrl(text)) return withoutSubscriberEmail(text.replaceAll(SUBSCRIBER_EMAIL_PLACEHOLDER, ""));
	return text.replaceAll(SUBSCRIBER_EMAIL_PLACEHOLDER, encodeURIComponent(email));
}

// Links that don't go through the redirect (the text part, untracked emails) go without it.
export function stripSubscriberEmail(body) {
	return String(body ?? "").replace(PLACEHOLDER_PARAMETER_PATTERN, "");
}

function emailCard(card) {
	const href = escapeAttribute(getCardHref(card.url, { isEmail: true }));
	const text = (value) => escapeAttribute(value);
	const image = card.image
		? `<tr><td style="padding:0;"><a href="${href}" style="text-decoration:none;"><img src="${text(card.image)}" width="600" alt="${text(card.brand || card.title)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px 12px 0 0;"></a></td></tr>`
		: "";
	const logo = card.logo
		? `<td width="44" valign="middle" style="padding:0 12px 0 0;"><img src="${text(card.logo)}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:10px;object-fit:cover;"></td>`
		: "";
	const brand = card.brand
		? `<span style="color:#18181b;font-weight:600;">${text(card.brand)}</span>`
		: "";
	const eyebrow = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>${logo}<td valign="middle" style="font-size:13px;line-height:1.4;color:#71717a;">${brand}${brand ? "<br>" : ""}<span style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;">${text(card.label)}</span></td></tr></table>`;
	const description = card.description
		? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">${text(card.description)}</p>`
		: "";
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;border:1px solid #e4e4e7;border-radius:12px;border-collapse:separate;background:#ffffff;font-family:${FONT_STACK};">
${image}<tr><td style="padding:22px 24px 24px;">${eyebrow}<p style="margin:0 0 8px;font-size:19px;font-weight:600;line-height:1.35;color:#09090b;">${text(card.title)}</p>
${description}<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#18181b;"><a href="${href}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">${text(card.cta)} →</a></td></tr></table>
</td></tr></table>`;
}

// On the archive, a card is one of the issue's boxes, so it goes through the sanitizer like any other.
// Paid links say so to search engines too.
function webCard(card) {
	const href = escapeAttribute(getCardHref(card.url, { isEmail: false }));
	const rel = isSponsored(card) ? "sponsored noopener" : "nofollow noopener";
	const text = (value) => escapeAttribute(value);
	const link = (content) => `<a href="${href}" rel="${rel}">${content}</a>`;
	const image = card.image ? `<p>${link(`<img src="${text(card.image)}" alt="${text(card.brand || card.title)}">`)}</p>` : "";
	const byline = [card.label, card.brand].filter(Boolean).map(text).join(" · ");
	const description = card.description ? `<p>${text(card.description)}</p>` : "";
	return `<div data-callout="" data-card="">${image}<p>${byline}</p><h3>${text(card.title)}</h3>${description}<p>${link(text(card.cta))}</p></div>`;
}

// Only up to the last ">": from a "<div" after it, the pattern would read to the end of the body.
export function expandCards(html, { isEmail }) {
	const body = String(html ?? "");
	const end = body.lastIndexOf(">") + 1;
	let count = 0;
	const expanded = body.slice(0, end).replace(DIV_PATTERN, (match, attributes, close) => {
		if (!close || !CARD_MARKER_PATTERN.test(attributes)) return match;
		if (count >= MAX_CARDS) return "";
		const card = readCard(attributes);
		if (!card) return "";
		count += 1;
		return isEmail ? emailCard(card) : webCard(card);
	});
	return expanded + body.slice(end);
}

export function hasCard(html) {
	return CARD_MARKER_PATTERN.test(String(html ?? ""));
}
