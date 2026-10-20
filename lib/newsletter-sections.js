// The newsletter's settings: an overview at /newsletters, then a page for each section, /newsletters/<section>.
export const SETTINGS_PATH = "/newsletters";

// The pages of FormNewsletter's sections, in the overview's order. Design has its own page.
export const SETTINGS_SECTIONS = [
	{ id: "general", label: "General" },
	{ id: "sender", label: "Sender" },
	{ id: "signups", label: "Confirm signups" },
	{ id: "welcome", label: "Welcome email" },
	{ id: "cleanup", label: "List cleanup" },
	{ id: "website", label: "Website" },
];
export const DESIGN_SECTION = { id: "design", label: "Design" };
// The signup form for the owner's own site (lib/signup-form.js), on its own page like Design.
export const FORM_SECTION = { id: "form", label: "Form for your site" };

// What saving a section's page sends (readSettingsForm): its own fields, so it never blanks the other sections. Each
// switch only counts on its own page, where the form has it.
export const SECTION_FIELDS = {
	general: ["name", "slug", "imageUrl"],
	sender: ["fromName", "fromEmail", "replyTo", "postalAddress"],
	signups: ["requireConfirmation", "confirmation"],
	welcome: ["welcome"],
	cleanup: ["cleanup"],
	website: ["archiveEnabled", "description", "author", "socialLinks"],
};

// Links into the one-page settings that came before named a field: /newsletters#postal-address.
const FIELD_SECTIONS = { "postal-address": "sender" };

const SECTION_PAGE_PATTERN = new RegExp(
	`^${SETTINGS_PATH}/(${[...SETTINGS_SECTIONS, FORM_SECTION, DESIGN_SECTION].map(({ id }) => id).join("|")})$`
);

export function getSectionPath(id) {
	return `${SETTINGS_PATH}/${id}`;
}

export function getSection(id) {
	return SETTINGS_SECTIONS.find((section) => section.id === id) ?? null;
}

export function isSectionPagePath(pathname) {
	return SECTION_PAGE_PATTERN.test(pathname);
}

// The section's page, scrolled to the field. Null for a field no section has.
export function getFieldPath(field) {
	const section = FIELD_SECTIONS[field];
	return section ? `${getSectionPath(section)}#${field}` : null;
}

// New subscribers get the confirmation email or the welcome email: a page that turns one on turns the other off in the
// same save, once it has said so (update_newsletter refuses a change that would leave both on).
const LINKED_SWITCHES = {
	signups: ({ requireConfirmation }) => (requireConfirmation ? { welcome: { enabled: false } } : {}),
	welcome: ({ welcome }) => (welcome?.enabled ? { requireConfirmation: false } : {}),
};

// What a settings form sends: its section's fields, every field without a section, and none for a section that has no
// fields here. A collapsed email section sends no fields, and what it had saved stays as it is. Without a section, as on
// the one-page settings, double opt-in on keeps the welcome email off.
export function readSettingsForm(formData) {
	const settings = readAllSettings(formData);
	const section = String(formData.get("section") ?? "");
	if (!section) return settings.requireConfirmation ? { ...settings, welcome: { ...settings.welcome, enabled: false } } : settings;
	const fields = SECTION_FIELDS[section] ?? [];
	const own = Object.fromEntries(fields.filter((key) => key in settings).map((key) => [key, settings[key]]));
	return { ...own, ...LINKED_SWITCHES[section]?.(own) };
}

function readAllSettings(formData) {
	return {
		name: readText(formData, "name"),
		slug: readText(formData, "slug"),
		imageUrl: readText(formData, "imageUrl"),
		fromName: readText(formData, "fromName"),
		fromEmail: readText(formData, "fromEmail"),
		replyTo: readText(formData, "replyTo"),
		postalAddress: readText(formData, "postalAddress"),
		archiveEnabled: formData.get("archiveEnabled") === "on",
		description: readText(formData, "description"),
		author: { bio: readText(formData, "authorBio"), imageUrl: readText(formData, "authorImageUrl") },
		socialLinks: readText(formData, "socialLinks").split(/[\s,]+/).filter(Boolean),
		requireConfirmation: formData.get("requireConfirmation") === "on",
		cleanup: {
			enabled: formData.get("cleanupEnabled") === "on",
			issues: readNumber(formData, "cleanupIssues"),
			days: readNumber(formData, "cleanupDays"),
		},
		...(formData.has("welcomeSubject") && {
			welcome: {
				enabled: formData.get("welcomeEnabled") === "on",
				subject: readText(formData, "welcomeSubject"),
				previewText: readText(formData, "welcomePreviewText"),
				markdown: String(formData.get("welcomeMarkdown") ?? ""),
			},
		}),
		...(formData.has("confirmationSubject") && {
			confirmation: {
				subject: readText(formData, "confirmationSubject"),
				previewText: readText(formData, "confirmationPreviewText"),
				markdown: String(formData.get("confirmationMarkdown") ?? ""),
			},
		}),
	};
}

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// Empty stays unset, so the newsletter's default applies.
function readNumber(formData, key) {
	const text = readText(formData, key);
	return text ? Number(text) : null;
}
