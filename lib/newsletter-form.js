import { getArchiveUrls } from "./archive-hosts.js";
import { getCleanupSettings } from "./cleanup.js";
import { getConfirmationContent } from "./confirmation-content.js";
import { formatWindow } from "./format.js";
import { SLUG_CHANGES } from "./newsletters.js";
import { getPostalAddress } from "./postal-address.js";
import { getSharedAddress, isOnSharedDomain } from "./sender-rules.js";

// The settings form's fields (FormNewsletter) as the newsletter has them saved: where the form starts, and what
// Discard goes back to. Without a newsletter, a new one's. The postal address is the one its emails print.
export function getNewsletterDraft({ newsletter, domains, sharedDomain, defaultPostalAddress = null }) {
	const from = getInitialFrom({ newsletter, domains, sharedDomain });
	const cleanup = getCleanupSettings(newsletter);
	return {
		name: newsletter?.name ?? "",
		slug: newsletter?.slug ?? "",
		isSlugEdited: Boolean(newsletter),
		imageUrl: newsletter?.imageUrl ?? "",
		fromName: newsletter?.fromName ?? "",
		fromLocal: from.local,
		fromDomain: from.domain,
		replyTo: newsletter?.replyTo ?? "",
		postalAddress: getPostalAddress(newsletter, defaultPostalAddress),
		isConfirmationRequired: newsletter ? Boolean(newsletter.requireConfirmation) : true,
		confirmationEdits: null,
		// Off while signups confirm, as it goes out: newsletters saved before the two were linked can have both on.
		isWelcomeEnabled: Boolean(newsletter?.welcome?.enabled) && !(newsletter ? newsletter.requireConfirmation : true),
		welcome: {
			subject: newsletter?.welcome?.subject ?? "",
			previewText: newsletter?.welcome?.previewText ?? "",
			markdown: newsletter?.welcome?.markdown ?? "",
		},
		isCleanupEnabled: newsletter ? cleanup.enabled : true,
		cleanup: { issues: String(cleanup.issues), days: String(cleanup.days) },
		isArchiveEnabled: newsletter ? Boolean(newsletter.archiveEnabled) : true,
		description: newsletter?.description ?? "",
		authorBio: newsletter?.author?.bio ?? "",
		authorImageUrl: newsletter?.author?.imageUrl ?? "",
		socialLinks: newsletter?.socialLinks?.join("\n") ?? "",
	};
}

// The shared domain stands for the shared address, whose subdomain follows the slug.
export function getDraftFromEmail({ slug, fromLocal, fromDomain }, sharedDomain) {
	if (sharedDomain && fromDomain === sharedDomain) return getSharedAddress(slug || "slug", sharedDomain);
	return fromDomain ? `${fromLocal}@${fromDomain}` : "";
}

// Until it's edited, the built-in confirmation email follows the name and the description.
export function getDraftConfirmation({ name, description, confirmationEdits }, newsletter) {
	return confirmationEdits ?? getConfirmationContent({ name, description, confirmation: newsletter?.confirmation });
}

// What saving the draft sends, to tell whether it has unsaved changes.
export function getDraftKey(draft, { newsletter, sharedDomain }) {
	const { isSlugEdited, fromLocal, fromDomain, confirmationEdits, ...fields } = draft;
	return JSON.stringify({
		...fields,
		fromEmail: getDraftFromEmail(draft, sharedDomain),
		confirmation: getDraftConfirmation(draft, newsletter),
	});
}

// The website's address, without the trailing slash. archiveHost: the newsletter's own subdomain, if it has one.
export function getWebsiteAddress({ slug, archiveHost }, { sharedDomain, appUrl }) {
	return getArchiveUrls({ slug, archiveHost }, { sharedDomain, appUrl }).siteIndex.replace(/\/$/, "");
}

// What saving a new slug changes, as lib/shared-sender.js, lib/archive-hosts.js and proxy.js do it. The shared
// address and the website follow the slug. The old subdomain keeps answering for the links in sent emails, which
// carry their own token, and stops showing pages, since it no longer names the newsletter.
export function getSlugChanges({ slug, savedSlug, archiveHost, isShared, sharedDomain, appUrl }) {
	const changes = isShared ? [`Sends from ${getSharedAddress(slug, sharedDomain)}`] : [];
	if (archiveHost) {
		changes.push(`Your website and its links stay on ${archiveHost}`);
	} else {
		changes.push(
			`Your website moves to ${getWebsiteAddress({ slug }, { sharedDomain, appUrl })}`,
			`Pages at ${getWebsiteAddress({ slug: savedSlug }, { sharedDomain, appUrl })} stop working, Read online links in sent issues included. Unsubscribe and tracked links in sent emails keep working.`
		);
	}
	changes.push(`You can change the slug ${SLUG_CHANGES.limit} times ${formatWindow(SLUG_CHANGES.window)}`);
	return changes;
}

// The saved address if it's on a domain the account can use, else the shared address, else the first domain.
function getInitialFrom({ newsletter, domains, sharedDomain }) {
	const [local = "", domain = ""] = String(newsletter?.fromEmail ?? "").split("@");
	if (isOnSharedDomain(newsletter?.fromEmail, sharedDomain)) return { local: "hi", domain: sharedDomain };
	if (domain && domains.some((item) => item.domain === domain)) return { local, domain };
	return { local: local || "hi", domain: sharedDomain ?? domains[0]?.domain ?? "" };
}
