import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SECTION_FIELDS,
	SETTINGS_SECTIONS,
	getFieldPath,
	isSectionPagePath,
	readSettingsForm,
} from "../lib/newsletter-sections.js";
import { getDesignSummary, getSettingsSummary } from "../lib/settings-summary.js";

// Every field the settings pages send, as FormNewsletter names them.
function fullForm(section) {
	const form = new FormData();
	const fields = {
		id: "n1",
		name: "Field notes",
		slug: "field-notes",
		imageUrl: "https://cdn.example.com/logo.png",
		fromName: "Jane",
		fromEmail: "jane@example.com",
		replyTo: "reply@example.com",
		postalAddress: "1 Main St, Paris",
		archiveEnabled: "on",
		description: "One idea a week.",
		authorBio: "I write.",
		authorImageUrl: "https://cdn.example.com/jane.png",
		socialLinks: "https://x.com/jane\nhttps://youtube.com/@jane",
		requireConfirmation: "on",
		cleanupEnabled: "on",
		cleanupIssues: "8",
		cleanupDays: "",
		welcomeEnabled: "on",
		welcomeSubject: "Welcome",
		welcomePreviewText: "",
		welcomeMarkdown: "Hi",
		confirmationSubject: "Confirm",
		confirmationPreviewText: "",
		confirmationMarkdown: "Click",
	};
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	if (section) form.set("section", section);
	return form;
}

test("a section's page sends its own fields only, so saving it leaves the other sections as they are", () => {
	assert.deepEqual(readSettingsForm(fullForm("general")), {
		name: "Field notes",
		slug: "field-notes",
		imageUrl: "https://cdn.example.com/logo.png",
	});
	assert.deepEqual(readSettingsForm(fullForm("sender")), {
		fromName: "Jane",
		fromEmail: "jane@example.com",
		replyTo: "reply@example.com",
		postalAddress: "1 Main St, Paris",
	});
	assert.deepEqual(readSettingsForm(fullForm("cleanup")), { cleanup: { enabled: true, issues: 8, days: null } });
	assert.deepEqual(readSettingsForm(fullForm("website")), {
		archiveEnabled: true,
		description: "One idea a week.",
		author: { bio: "I write.", imageUrl: "https://cdn.example.com/jane.png" },
		socialLinks: ["https://x.com/jane", "https://youtube.com/@jane"],
	});
	// Double opt-in and the welcome email, on here, also turn the other off.
	const linked = { signups: ["welcome"], welcome: ["requireConfirmation"] };
	for (const { id } of SETTINGS_SECTIONS) {
		assert.deepEqual(Object.keys(readSettingsForm(fullForm(id))).sort(), [...SECTION_FIELDS[id], ...(linked[id] ?? [])].sort(), id);
	}
});

test("double opt-in turned on turns the welcome email off in the same save, and the reverse", () => {
	assert.deepEqual(readSettingsForm(fullForm("signups")).welcome, { enabled: false });
	assert.equal(readSettingsForm(fullForm("welcome")).requireConfirmation, false);

	const welcomeOff = fullForm("welcome");
	welcomeOff.delete("welcomeEnabled");
	assert.equal("requireConfirmation" in readSettingsForm(welcomeOff), false, "a welcome email turned off leaves double opt-in");
	const signupsOff = fullForm("signups");
	signupsOff.delete("requireConfirmation");
	assert.equal("welcome" in readSettingsForm(signupsOff), false, "double opt-in turned off leaves the welcome email");
});

test("a switch only counts on its own page: off there, untouched elsewhere", () => {
	const website = fullForm("website");
	website.delete("archiveEnabled");
	assert.equal(readSettingsForm(website).archiveEnabled, false);

	const general = fullForm("general");
	for (const key of ["archiveEnabled", "requireConfirmation", "cleanupEnabled", "welcomeEnabled"]) general.delete(key);
	assert.deepEqual(Object.keys(readSettingsForm(general)), ["name", "slug", "imageUrl"]);
});

test("a collapsed email section sends nothing of it, so what it saved stays", () => {
	const signupsOff = fullForm("signups");
	signupsOff.delete("requireConfirmation");
	for (const key of ["confirmationSubject", "confirmationPreviewText", "confirmationMarkdown"]) signupsOff.delete(key);
	assert.deepEqual(readSettingsForm(signupsOff), { requireConfirmation: false });

	const welcomeCollapsed = fullForm("welcome");
	for (const key of ["welcomeEnabled", "welcomeSubject", "welcomePreviewText", "welcomeMarkdown"]) welcomeCollapsed.delete(key);
	assert.deepEqual(readSettingsForm(welcomeCollapsed), {});

	assert.deepEqual(readSettingsForm(fullForm("welcome")), {
		welcome: { enabled: true, subject: "Welcome", previewText: "", markdown: "Hi" },
		requireConfirmation: false,
	});
});

test("without a section the form sends every field, as the one-page settings did; a section with no fields here sends none", () => {
	const settings = readSettingsForm(fullForm());
	assert.equal(settings.name, "Field notes");
	assert.equal(settings.postalAddress, "1 Main St, Paris");
	assert.equal(settings.cleanup.enabled, true);
	assert.equal(settings.welcome.subject, "Welcome");
	assert.equal(settings.welcome.enabled, false, "double opt-in on keeps the welcome email off");

	for (const section of ["design", "unknown"]) assert.deepEqual(readSettingsForm(fullForm(section)), {}, section);
});

test("links to a field of the one-page settings open its section's page, and settings pages are known by path", () => {
	assert.equal(getFieldPath("postal-address"), "/newsletters/sender#postal-address");
	assert.equal(getFieldPath("unknown"), null);
	assert.equal(getFieldPath(""), null);
	for (const path of ["/newsletters/general", "/newsletters/website", "/newsletters/design"]) assert.equal(isSectionPagePath(path), true, path);
	for (const path of ["/newsletters", "/newsletters/new", "/newsletters/6a1b2c3d4e5f60718293a4b5", "/newsletters/sender/x"]) {
		assert.equal(isSectionPagePath(path), false, path);
	}
});

const newsletter = {
	name: "Field notes",
	slug: "field-notes",
	fromEmail: "hello@field-notes.mailcheap.ai",
	postalAddress: "1 Main St, Paris",
	requireConfirmation: true,
	welcome: { enabled: true },
	cleanup: { enabled: true, issues: 8 },
	archiveEnabled: true,
};
const context = { sharedDomain: "mailcheap.ai", appUrl: "https://mailcheap.ai", hasSentIssue: true, hasPlan: true };

test("the overview says where each section stands", () => {
	assert.deepEqual(getSettingsSummary({ newsletter, ...context }), {
		general: { text: "Field notes · field-notes", tone: "none" },
		sender: { text: "hello@field-notes.mailcheap.ai", tone: "none" },
		signups: { text: "Double opt-in on", tone: "on" },
		welcome: { text: "Replaced by the confirmation email", tone: "none" },
		cleanup: { text: "On · after 8 ignored issues", tone: "on" },
		website: { text: "Live · field-notes.mailcheap.ai", tone: "on" },
		form: { text: "Off", tone: "off" },
	});

	const plain = { ...newsletter, requireConfirmation: false, welcome: { enabled: false }, cleanup: { enabled: false }, archiveEnabled: false };
	const summary = getSettingsSummary({ newsletter: plain, ...context });
	assert.deepEqual(summary.signups, { text: "Double opt-in off", tone: "off" });
	assert.deepEqual(summary.welcome, { text: "Off", tone: "off" });
	assert.deepEqual(summary.cleanup, { text: "Off", tone: "off" });
	assert.deepEqual(summary.website, { text: "Off", tone: "off" });

	const cleanupDefaults = getSettingsSummary({ newsletter: { ...newsletter, cleanup: { enabled: true } }, ...context });
	assert.equal(cleanupDefaults.cleanup.text, "On · after 6 ignored issues", "the default count without one saved");
});

test("the form for the owner's site says whether it's on, on which sites, and when it waits for a plan", () => {
	const withForm = (signupForm) => ({ ...newsletter, signupForm });
	assert.deepEqual(getSettingsSummary({ newsletter: withForm({ enabled: true }), ...context }).form, { text: "On · any site", tone: "on" });
	assert.deepEqual(getSettingsSummary({ newsletter: withForm({ enabled: true, allowedDomains: ["example.com"] }), ...context }).form, {
		text: "On · example.com",
		tone: "on",
	});
	assert.equal(
		getSettingsSummary({ newsletter: withForm({ enabled: true, allowedDomains: ["example.com", "blog.dev", "shop.io"] }), ...context }).form.text,
		"On · example.com +2"
	);
	assert.deepEqual(getSettingsSummary({ newsletter: withForm({ enabled: true }), ...context, hasPlan: false }).form, {
		text: "Needs a plan",
		tone: "warning",
	});
	assert.deepEqual(getSettingsSummary({ newsletter: withForm({ enabled: false }), ...context, hasPlan: false }).form, { text: "Off", tone: "off" });
});

test("the welcome email shows paused while the month's emails are used up", () => {
	const welcoming = { ...newsletter, requireConfirmation: false };
	assert.deepEqual(getSettingsSummary({ newsletter: welcoming, ...context }).welcome, { text: "On", tone: "on" });
	assert.deepEqual(getSettingsSummary({ newsletter: welcoming, ...context, isWelcomePaused: true }).welcome, { text: "Paused", tone: "warning" });
});

test("the sender asks for a look without a postal address or with an unverified domain", () => {
	const noAddress = { ...newsletter, postalAddress: "", postalAddressCleared: true };
	assert.deepEqual(getSettingsSummary({ newsletter: noAddress, ...context }).sender, { text: "Add a postal address to send", tone: "warning" });
	assert.equal(
		getSettingsSummary({ newsletter: { ...newsletter, postalAddress: "" }, ...context, defaultPostalAddress: "MailCheap, 1 Rue" }).sender.tone,
		"none",
		"the server's default address counts"
	);

	const own = { ...newsletter, fromEmail: "jane@own.dev" };
	const domains = [{ domain: "own.dev", verified: false }];
	assert.deepEqual(getSettingsSummary({ newsletter: own, ...context, domains }).sender, { text: "own.dev isn't verified yet", tone: "warning" });
	assert.deepEqual(getSettingsSummary({ newsletter: own, ...context, domains: [{ domain: "own.dev", verified: true }] }).sender, {
		text: "jane@own.dev",
		tone: "none",
	});
});

test("the website waits for its first issue and for a plan, and shows its own subdomain once live", () => {
	assert.deepEqual(getSettingsSummary({ newsletter, ...context, hasSentIssue: false }).website, {
		text: "Goes live after your first issue",
		tone: "none",
	});
	assert.deepEqual(getSettingsSummary({ newsletter, ...context, hasPlan: false }).website, { text: "Needs a plan", tone: "warning" });
	assert.equal(
		getSettingsSummary({ newsletter: { ...newsletter, archiveHost: "news.own.dev" }, ...context }).website.text,
		"Live · news.own.dev"
	);
});

test("the design card names the theme and shows its colors", () => {
	const colors = { background: "#ffffff", text: "#18181b", accent: "#e11d48" };
	assert.deepEqual(getDesignSummary({ name: "MailCheap", isCustomized: false, colors }), {
		text: "MailCheap",
		tone: "none",
		swatches: ["#ffffff", "#18181b", "#e11d48"],
	});
	assert.equal(getDesignSummary({ name: "Paper", isCustomized: true, colors }).text, "Paper · Customized");
});
