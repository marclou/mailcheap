import { getAppHost, getEmailProviderId, getSharedDomain } from "./config.js";
import { getDnsProblemMessage, getDnsProblems } from "./domain-dns-rules.js";

const HOSTNAME_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// MailCheap's own domains: a customer can't claim them or anything under them.
const RESERVED_DOMAINS = ["mailcheap.ai", "amazonses.com", "postshiba.com", "groundmail.dev", "vercel.app"];
const SHARED_LOCAL_PART = "hello";

// A newsletter without its own domain sends from its own subdomain of the shared domain, <slug>.<shared domain>:
// a domain in its account's tenant at the email provider, so its reputation and suppressions are its own.
export function getSharedSendingDomain(slug, sharedDomain = getSharedDomain()) {
	return sharedDomain && slug ? `${slug}.${sharedDomain}` : null;
}

export function getSharedAddress(slug, sharedDomain = getSharedDomain()) {
	const domain = getSharedSendingDomain(slug, sharedDomain);
	return domain ? `${SHARED_LOCAL_PART}@${domain}` : null;
}

function isWithin(host, domain) {
	return host === domain || host.endsWith(`.${domain}`);
}

export function getEmailDomain(email) {
	return String(email ?? "").split("@")[1]?.trim().toLowerCase() || "";
}

// Any address on the shared domain or under it, including the <slug>@<shared domain> addresses of before.
export function isOnSharedDomain(email, sharedDomain = getSharedDomain()) {
	return Boolean(sharedDomain) && isWithin(getEmailDomain(email), sharedDomain);
}

export function isSharedSendingDomain(domain, sharedDomain = getSharedDomain()) {
	return Boolean(sharedDomain) && isWithin(String(domain ?? "").toLowerCase(), sharedDomain);
}

// The domain a newsletter's from address sends from: its slug's on the shared domain, or its own. resolveFrom's identity,
// without checking the domain can send.
export function getSendingDomain(newsletter, sharedDomain = getSharedDomain()) {
	const fromEmail = newsletter?.fromEmail ?? "";
	return isOnSharedDomain(fromEmail, sharedDomain) ? getSharedSendingDomain(newsletter.slug, sharedDomain) : getEmailDomain(fromEmail);
}

// A domain is verified at the provider it was added at. After EMAIL_PROVIDER changes, it sends once its new
// records are in (lib/domains.js checkDomain adds it at the new provider). Domains from before have no provider: SES.
// A record MailCheap found proxied, different or missing (dnsProblems, lib/domain-dns-rules.js) stops it too.
export function withActiveProvider(domain, providerId = getEmailProviderId()) {
	const isVerified = Boolean(domain.verified) && (domain.provider ?? "ses") === providerId;
	const dnsProblems = getDnsProblems({ ...domain, verified: isVerified });
	return { ...domain, verified: isVerified && dnsProblems.length === 0, dnsProblems };
}

// The newsletter's sending subdomain, set up and verified at the active provider (lib/shared-sender.js).
export function isSharedSenderReady(newsletter, { sharedDomain = getSharedDomain(), providerId = getEmailProviderId() } = {}) {
	const sender = newsletter?.sharedSender;
	return Boolean(sender?.verified) && sender.provider === providerId && sender.domain === getSharedSendingDomain(newsletter.slug, sharedDomain);
}

// What a customer types: a bare domain, maybe pasted with https:// or a path.
export function normalizeHostInput(value) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/[/?#].*$/, "")
		.replace(/\.$/, "");
}

// A sending domain, typed or pasted as an address at it or a link to it: Jane <jane@example.com>, https://www.example.com/about.
export function normalizeDomainInput(value) {
	return normalizeHostInput(value)
		.split("@")
		.pop()
		.replace(/>$/, "")
		.trim()
		.replace(/:\d*$/, "")
		.replace(/\.$/, "")
		.replace(/^www\./, "");
}

// The next step toward its own domain for a newsletter on the shared address: send from a verified domain, finish
// verifying one, or add one. Null once it sends from a domain of its own, or without a shared domain. domains: the
// account's, as withActiveProvider sees them.
export function getOwnDomainNudge({ fromEmail, domains = [], sharedDomain = getSharedDomain() }) {
	if (!isOnSharedDomain(fromEmail, sharedDomain)) return null;
	const verified = domains.find((domain) => domain.verified);
	if (verified) return { step: "switch", domain: verified.domain, domainId: String(verified._id) };
	const pending = domains.find((domain) => !domain.verified);
	if (pending) return { step: "verify", domain: pending.domain };
	return { step: "add" };
}

export const OWN_DOMAIN_STEPS = ["add", "verify", "switch"];

// A closed helper stays closed for its newsletter until the step changes: adding or verifying a domain shows it once more.
export function isOwnDomainNudgeShown(nudge, newsletter) {
	return Boolean(nudge) && newsletter?.dismissedNudges?.ownDomain !== nudge.step;
}

// The name before the @ a newsletter keeps on a domain of its own. After the shared address it's hi, as the
// newsletter's settings offer.
export function getOwnDomainLocalPart(fromEmail, sharedDomain = getSharedDomain()) {
	const [local] = String(fromEmail ?? "").trim().toLowerCase().split("@");
	return local && !isOnSharedDomain(fromEmail, sharedDomain) ? local : "hi";
}

export function isHostname(value) {
	return HOSTNAME_PATTERN.test(value);
}

// MailCheap's domains, the shared one and the app's, anything under them, or a domain they're under.
export function isReservedDomain(domain, { sharedDomain = getSharedDomain(), appHost = getAppHost() } = {}) {
	const reserved = [...RESERVED_DOMAINS, sharedDomain, appHost.split(":")[0]].filter(Boolean);
	return reserved.some((own) => isWithin(domain, own) || isWithin(own, domain));
}

export function getDomainProblem(domain, { sharedDomain = getSharedDomain(), appHost = getAppHost() } = {}) {
	if (!isHostname(domain)) return "Enter a domain like example.com";
	if (isReservedDomain(domain, { sharedDomain, appHost })) return "This domain can't be added";
	return null;
}

// An account sends from a verified domain it added, or from its newsletter's shared address. Replies to the
// shared address go to the customer: the newsletter's reply-to, else the account owner's email.
export function resolveFrom({ newsletter, domains = [], ownerEmail, sharedDomain = getSharedDomain(), providerId = getEmailProviderId() }) {
	const fromEmail = String(newsletter?.fromEmail ?? "").toLowerCase();
	const fromDomain = getEmailDomain(fromEmail);
	if (!fromEmail) return { problem: "Add a from email to the newsletter" };

	if (isOnSharedDomain(fromEmail, sharedDomain)) {
		const address = getSharedAddress(newsletter.slug, sharedDomain);
		if (fromEmail !== address) return { problem: `The shared address for this newsletter is ${address}` };
		const replyTo = newsletter.replyTo || ownerEmail;
		if (!replyTo) return { problem: "Add a reply-to email to the newsletter" };
		if (!isSharedSenderReady(newsletter, { sharedDomain, providerId })) {
			return { problem: `${address} is still being set up. Try again in a few minutes.` };
		}
		return { identity: getSharedSendingDomain(newsletter.slug, sharedDomain), replyTo, isShared: true };
	}

	const domain = domains.find((item) => item.domain === fromDomain);
	if (!domain) return { problem: `${fromDomain} isn't one of your domains. Add it on the Domains page or use the shared address.` };
	if (domain.dnsProblems?.length > 0) {
		return { problem: `${getDnsProblemMessage(fromDomain, domain.dnsProblems)} Then click Check now on the Domains page.` };
	}
	if (!domain.verified) return { problem: `${fromDomain} isn't verified yet. Add its DNS records on the Domains page.` };
	return { identity: fromDomain, replyTo: newsletter.replyTo || undefined, isShared: false };
}

// Saving a newsletter: a domain the account added (verified or not yet), or the shared address.
export function getFromEmailSaveProblem({ fromEmail, slug, domains = [], sharedDomain = getSharedDomain() }) {
	const fromDomain = getEmailDomain(fromEmail);
	if (isOnSharedDomain(fromEmail, sharedDomain)) {
		return fromEmail === getSharedAddress(slug, sharedDomain) ? null : `Use ${getSharedAddress(slug, sharedDomain)}, the shared address for this slug`;
	}
	if (domains.some((item) => item.domain === fromDomain)) return null;
	return sharedDomain
		? `Add ${fromDomain || "the domain"} on the Domains page first, or use ${getSharedAddress(slug, sharedDomain)}`
		: `Add ${fromDomain || "the domain"} on the Domains page first`;
}
