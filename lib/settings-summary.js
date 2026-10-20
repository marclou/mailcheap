import { getCleanupSettings } from "./cleanup.js";
import { getWebsiteAddress } from "./newsletter-form.js";
import { getPostalAddress } from "./postal-address.js";
import { isOnSharedDomain } from "./sender-rules.js";
import { toSignupFormSettings } from "./signup-form.js";

// What the settings overview's cards say about each section, at a glance. tone: on and off show a dot, warning asks for
// a look, none is plain. defaultPostalAddress: the server's (lib/postal-address.js). isWelcomePaused: the month's
// emails are used up, so welcome emails are skipped. hasPlan: a website only goes online with one, and the form for the
// owner's site only takes signups with one.
export function getSettingsSummary({
	newsletter,
	domains = [],
	sharedDomain = null,
	appUrl,
	defaultPostalAddress = null,
	hasSentIssue = false,
	hasPlan = true,
	isWelcomePaused = false,
}) {
	return {
		general: { text: `${newsletter.name} · ${newsletter.slug}`, tone: "none" },
		sender: getSenderSummary({ newsletter, domains, sharedDomain, defaultPostalAddress }),
		signups: newsletter.requireConfirmation ? { text: "Double opt-in on", tone: "on" } : { text: "Double opt-in off", tone: "off" },
		welcome: getWelcomeSummary(newsletter, isWelcomePaused),
		cleanup: getCleanupSummary(newsletter),
		website: getWebsiteSummary({ newsletter, sharedDomain, appUrl, hasSentIssue, hasPlan }),
		form: getSignupFormSummary(newsletter, hasPlan),
	};
}

function getSignupFormSummary(newsletter, hasPlan) {
	const { enabled, allowedDomains } = toSignupFormSettings(newsletter.signupForm);
	if (!enabled) return { text: "Off", tone: "off" };
	if (!hasPlan) return { text: "Needs a plan", tone: "warning" };
	const [first, ...others] = allowedDomains;
	if (!first) return { text: "On · any site", tone: "on" };
	return { text: `On · ${first}${others.length ? ` +${others.length}` : ""}`, tone: "on" };
}

// design: { name, isCustomized, colors: { background, text, accent } }, the newsletter's theme.
export function getDesignSummary({ name, isCustomized, colors }) {
	return {
		text: isCustomized ? `${name} · Customized` : name,
		tone: "none",
		swatches: [colors.background, colors.text, colors.accent],
	};
}

function getSenderSummary({ newsletter, domains, sharedDomain, defaultPostalAddress }) {
	const fromEmail = newsletter.fromEmail ?? "";
	if (!getPostalAddress(newsletter, defaultPostalAddress)) return { text: "Add a postal address to send", tone: "warning" };
	const domain = fromEmail.split("@")[1];
	const isUnverified =
		!isOnSharedDomain(fromEmail, sharedDomain) && domains.some((item) => item.domain === domain && !item.verified);
	return isUnverified ? { text: `${domain} isn't verified yet`, tone: "warning" } : { text: fromEmail, tone: "none" };
}

// The confirmation email takes the welcome email's place while signups confirm (lib/sending-rules.js).
function getWelcomeSummary(newsletter, isWelcomePaused) {
	if (newsletter.requireConfirmation) return { text: "Replaced by the confirmation email", tone: "none" };
	if (!newsletter.welcome?.enabled) return { text: "Off", tone: "off" };
	return isWelcomePaused ? { text: "Paused", tone: "warning" } : { text: "On", tone: "on" };
}

function getCleanupSummary(newsletter) {
	const { enabled, issues } = getCleanupSettings(newsletter);
	return enabled ? { text: `On · after ${issues} ignored issues`, tone: "on" } : { text: "Off", tone: "off" };
}

function getWebsiteSummary({ newsletter, sharedDomain, appUrl, hasSentIssue, hasPlan }) {
	if (!newsletter.archiveEnabled) return { text: "Off", tone: "off" };
	if (!hasSentIssue) return { text: "Goes live after your first issue", tone: "none" };
	if (!hasPlan) return { text: "Needs a plan", tone: "warning" };
	const address = getWebsiteAddress(newsletter, { sharedDomain, appUrl }).replace(/^https?:\/\//, "");
	return { text: `Live · ${address}`, tone: "on" };
}
