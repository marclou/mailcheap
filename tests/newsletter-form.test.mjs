import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraftConfirmation, getDraftFromEmail, getDraftKey, getNewsletterDraft, getSlugChanges } from "../lib/newsletter-form.js";

// The settings form's save bar shows while the form has unsaved changes: what saving would send, against what the
// newsletter has saved.
const sharedDomain = "mailcheapmail.com";
const newsletter = {
	_id: "n1",
	name: "Field notes",
	slug: "field-notes",
	fromName: "Jane",
	fromEmail: "hello@field-notes.mailcheapmail.com",
	postalAddress: "1 Main St, Paris",
	requireConfirmation: true,
	welcome: { enabled: false, subject: "", previewText: "", markdown: "" },
	socialLinks: ["https://x.com/example"],
};
const saved = getNewsletterDraft({ newsletter, domains: [], sharedDomain });

function hasChanges(draft) {
	return getDraftKey(draft, { newsletter, sharedDomain }) !== getDraftKey(saved, { newsletter, sharedDomain });
}

test("a draft has unsaved changes until it's back to what the newsletter has saved", () => {
	assert.equal(hasChanges(getNewsletterDraft({ newsletter, domains: [], sharedDomain })), false);
	assert.equal(hasChanges({ ...saved, postalAddress: "2 Main St, Paris" }), true);
	assert.equal(hasChanges({ ...saved, postalAddress: "1 Main St, Paris" }), false);
	assert.equal(hasChanges({ ...saved, isArchiveEnabled: true }), true);
	assert.equal(hasChanges({ ...saved, cleanup: { ...saved.cleanup, days: "90" } }), true);
	assert.equal(hasChanges({ ...saved, socialLinks: "https://x.com/example" }), false);
});

test("the confirmation email and the welcome email both count, the welcome page staying open while signups confirm", () => {
	const confirmation = getDraftConfirmation(saved, newsletter);
	assert.equal(hasChanges({ ...saved, confirmationEdits: { ...confirmation, subject: "Please confirm" } }), true);
	assert.equal(hasChanges({ ...saved, confirmationEdits: { ...confirmation } }), false, "edited back to the built-in email");
	assert.equal(hasChanges({ ...saved, name: "Field notes weekly" }), true);

	assert.equal(hasChanges({ ...saved, welcome: { ...saved.welcome, subject: "Welcome" } }), true);
	assert.equal(hasChanges({ ...saved, isWelcomeEnabled: true }), true);
	assert.equal(hasChanges({ ...saved, isConfirmationRequired: false }), true);
});

test("a welcome email saved on while signups confirm shows off, as it doesn't go out", () => {
	const bothOn = getNewsletterDraft({ newsletter: { ...newsletter, welcome: { enabled: true, subject: "Hi", markdown: "Hello" } }, domains: [], sharedDomain });
	assert.equal(bothOn.isWelcomeEnabled, false);
	const welcoming = getNewsletterDraft({ newsletter: { ...newsletter, requireConfirmation: false, welcome: { enabled: true } }, domains: [], sharedDomain });
	assert.equal(welcoming.isWelcomeEnabled, true);
	assert.equal(getNewsletterDraft({ newsletter: null, domains: [], sharedDomain }).isWelcomeEnabled, false, "new newsletters confirm signups");
});

test("the shared address follows the slug; an own domain keeps its address", () => {
	assert.equal(getDraftFromEmail({ ...saved, slug: "notes" }, sharedDomain), "hello@notes.mailcheapmail.com");
	assert.equal(hasChanges({ ...saved, slug: "notes" }), true);
	assert.equal(hasChanges({ ...saved, fromLocal: "jane" }), false, "the shared address takes no name");

	const ownDomain = { ...newsletter, fromEmail: "jane@example.com" };
	const draft = getNewsletterDraft({ newsletter: ownDomain, domains: [{ domain: "example.com" }], sharedDomain });
	assert.deepEqual([draft.fromLocal, draft.fromDomain], ["jane", "example.com"]);
	assert.equal(getDraftFromEmail(draft, sharedDomain), "jane@example.com");
	const removed = getNewsletterDraft({ newsletter: ownDomain, domains: [], sharedDomain });
	assert.equal(getDraftFromEmail(removed, sharedDomain), "hello@field-notes.mailcheapmail.com", "a domain the account removed falls back to the shared address");
});

test("the postal address starts as the one emails print: the newsletter's own, else the default, unless it was cleared", () => {
	const defaultPostalAddress = "Example Company, 1 Example Way";
	const draft = (fields) => getNewsletterDraft({ newsletter: { ...newsletter, ...fields }, domains: [], sharedDomain, defaultPostalAddress });
	assert.equal(draft({}).postalAddress, "1 Main St, Paris");
	assert.equal(draft({ postalAddress: undefined }).postalAddress, defaultPostalAddress);
	assert.equal(draft({ postalAddress: "" }).postalAddress, defaultPostalAddress, "saved before there was a default");
	assert.equal(draft({ postalAddress: "", postalAddressCleared: true }).postalAddress, "");
	assert.equal(getNewsletterDraft({ newsletter: { ...newsletter, postalAddress: "" }, domains: [], sharedDomain }).postalAddress, "");
});

test("a new slug says what it moves: the shared address and the website, whose old pages go while sent links stay", () => {
	const changes = (fields) => getSlugChanges({ slug: "notes", savedSlug: "field-notes", isShared: true, sharedDomain, appUrl: "https://app.example.com", ...fields });
	assert.deepEqual(changes(), [
		"Sends from hello@notes.mailcheapmail.com",
		"Your website moves to https://notes.mailcheapmail.com",
		"Pages at https://field-notes.mailcheapmail.com stop working, Read online links in sent issues included. Unsubscribe and tracked links in sent emails keep working.",
		"You can change the slug 3 times a day",
	]);
	assert.equal(changes({ isShared: false }).length, 3, "an own sending domain keeps its address");
	assert.deepEqual(changes({ isShared: false, archiveHost: "news.example.com" }), [
		"Your website and its links stay on news.example.com",
		"You can change the slug 3 times a day",
	]);
	assert.deepEqual(changes({ isShared: false, sharedDomain: null }).slice(0, 2), [
		"Your website moves to https://app.example.com/archive/notes",
		"Pages at https://app.example.com/archive/field-notes stop working, Read online links in sent issues included. Unsubscribe and tracked links in sent emails keep working.",
	]);
});
