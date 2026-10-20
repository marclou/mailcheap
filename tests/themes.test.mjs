import assert from "node:assert/strict";
import { test } from "node:test";
import { getShareCardUrl } from "../lib/archive-seo.js";
import { getContrast, normalizeHexColor } from "../lib/colors.js";
import { THEME_FONTS, getFontFaceCss } from "../lib/theme-fonts.js";
import {
	THEME_PRESETS,
	getEmailTheme,
	getThemeOutput,
	getThemeStyleSheet,
	getThemeSummary,
	getThemeVariables,
	isCustomized,
	mergeTheme,
	normalizeTheme,
	resolveTheme,
} from "../lib/themes.js";

test("a newsletter without a theme has MailCheap's, which changes nothing on its pages", () => {
	const resolved = resolveTheme(undefined);
	assert.equal(resolved.id, "mailcheap");
	assert.equal(resolved.isDefault, true);
	assert.equal(resolved.isAdaptive, true);
	assert.deepEqual(getThemeVariables(resolved), {});
	assert.equal(getThemeStyleSheet(resolved), "");
});

test("only valid changes that differ from the preset are kept, colors in one form", () => {
	const theme = normalizeTheme({
		preset: "broadsheet",
		colors: { background: "#F5F0E8", text: "#123", accent: "red" },
		fonts: { heading: "comic-sans", body: "dm-sans" },
		headingWeight: 450,
		radius: "large",
		shadow: "none",
		spacing: "galactic",
	});
	assert.deepEqual(theme, { preset: "broadsheet", colors: { text: "#112233" }, fonts: { body: "dm-sans" }, radius: "large" });
	assert.equal(normalizeTheme({ preset: "unknown" }).preset, "mailcheap");
	assert.equal(normalizeHexColor("abc"), "#aabbcc");
	assert.equal(normalizeHexColor("#12345"), null);
});

test("another preset starts over, the same one keeps its changes, and null takes one back", () => {
	const current = { preset: "garden", colors: { accent: "#ff0000" }, radius: "none" };
	assert.deepEqual(mergeTheme(current, { preset: "swiss" }), { preset: "swiss" });
	assert.deepEqual(mergeTheme(current, { preset: "swiss", spacing: "spacious" }), { preset: "swiss", spacing: "spacious" });
	assert.deepEqual(mergeTheme(current, { colors: { text: "#000000" } }), { preset: "garden", colors: { accent: "#ff0000", text: "#000000" }, radius: "none" });
	assert.deepEqual(mergeTheme(current, { colors: { accent: null }, radius: null }), { preset: "garden" });
	assert.deepEqual(mergeTheme(current, undefined), current);
	assert.equal(isCustomized(current), true);
	assert.equal(isCustomized({ preset: "garden", radius: "large" }), false);
});

test("every preset reads well: text on its page, labels on its buttons, links or their underline", () => {
	for (const preset of THEME_PRESETS) {
		const { colors, palette } = resolveTheme({ preset: preset.id });
		assert.ok(getContrast(colors.text, colors.background) >= 7, `${preset.id} text`);
		assert.ok(getContrast(palette.onAccent, colors.accent) >= 4.5, `${preset.id} button label`);
		assert.ok(getContrast(palette.link, colors.background) >= 4.5, `${preset.id} links`);
		assert.ok(getContrast(palette.mutedText, colors.background) >= 3, `${preset.id} muted text`);
	}
});

test("a yellow accent too light for text paints buttons and underlines, links stay in the text color", () => {
	const { palette, colors } = resolveTheme({ preset: "poster" });
	assert.equal(palette.link, colors.text);
	assert.equal(palette.linkDecoration, colors.accent);
	assert.equal(palette.onAccent, "#0a0a0a");
});

test("a dark palette is the same for every reader, MailCheap's colors follow their dark mode", () => {
	const midnight = getThemeVariables(resolveTheme({ preset: "midnight" }));
	assert.equal(midnight["--background"], "#0d1017");
	assert.equal(midnight["color-scheme"], "dark");
	assert.equal(midnight["--image-backdrop"], "#ffffff");
	const accentOnly = getThemeVariables(resolveTheme({ preset: "mailcheap", radius: "none" }));
	assert.equal(accentOnly["--background"], undefined);
	assert.equal(accentOnly["--radius"], "0rem");
	const recolored = getThemeVariables(resolveTheme({ preset: "mailcheap", colors: { accent: "#2563eb" } }));
	assert.equal(recolored["--primary"], "#2563eb");
	assert.equal(recolored["color-scheme"], "light");
});

test("a theme's page gets its fonts, Geist excepted since every page loads it", () => {
	const sheet = getThemeStyleSheet(resolveTheme({ preset: "broadsheet" }));
	assert.match(sheet, /@font-face\{font-family:'MC Instrument Serif';font-style:normal;font-weight:400;/);
	assert.match(sheet, /src:url\(\/fonts\/newsreader-latin\.woff2\)/);
	assert.match(sheet, /body\{[^}]*--theme-font-heading:'MC Instrument Serif',Georgia/);
	assert.match(sheet, /font-family:var\(--theme-font-body\)\}$/);
	assert.doesNotMatch(getThemeStyleSheet(resolveTheme({ preset: "mailcheap", colors: { accent: "#2563eb" } })), /@font-face/);
	assert.equal(getFontFaceCss([THEME_FONTS[0], THEME_FONTS[0]]).split("@font-face").length - 1, 2, "one face per subset");
});

test("the API gives the values in effect and what was changed", () => {
	assert.deepEqual(getThemeOutput({ preset: "sunset", fonts: { body: "manrope" } }), {
		preset: "sunset",
		name: "Sunset",
		customized: ["fonts"],
		colors: { background: "#fff3ec", text: "#2b1a1e", accent: "#ff5a36" },
		fonts: { heading: "syne", body: "manrope" },
		headingWeight: 700,
		radius: "full",
		shadow: "lifted",
		spacing: "comfortable",
	});
	assert.deepEqual(getThemeSummary({ theme: { preset: "swiss", radius: "large" } }), {
		id: "swiss",
		name: "Swiss",
		isCustomized: true,
		colors: { background: "#ffffff", text: "#111111", accent: "#d92b16" },
	});
});

test("share cards keep their address with MailCheap's colors, and a palette names a new one", () => {
	const issue = { archiveSlug: "hello" };
	assert.equal(getShareCardUrl({ slug: "notes" }, issue, "https://app.test"), "https://app.test/archive/notes/og?p=hello");
	assert.equal(
		getShareCardUrl({ slug: "notes", theme: { preset: "mailcheap", radius: "none" } }, null, "https://app.test"),
		"https://app.test/archive/notes/og"
	);
	assert.equal(
		getShareCardUrl({ slug: "notes", theme: { preset: "garden" } }, issue, "https://app.test"),
		"https://app.test/archive/notes/og?p=hello&t=eef1e81f2a222f6a4a"
	);
});

test("a heading font without the chosen weight uses its closest", () => {
	assert.equal(resolveTheme({ preset: "broadsheet", headingWeight: 800 }).headingWeight, 400);
	assert.equal(resolveTheme({ preset: "swiss", fonts: { heading: "syne" }, headingWeight: 800 }).headingWeight, 800);
});

test("emails keep MailCheap's colors and system fonts, and themes get theirs with Outlook's own", () => {
	const plain = getEmailTheme(resolveTheme(null));
	assert.equal(plain.isDefault, true);
	assert.equal(plain.text, "#27272a");
	assert.equal(plain.fonts.faces, "");
	assert.equal(plain.headingWeight, null);
	const garden = getEmailTheme(resolveTheme({ preset: "garden" }), "https://mail.example.com");
	assert.equal(garden.background, "#eef1e8");
	assert.equal(garden.button, "#2f6a4a");
	assert.equal(garden.buttonText, "#ffffff");
	assert.equal(garden.radius.button, 12);
	assert.match(garden.fonts.body, /^'MC DM Sans',/);
	assert.match(garden.fonts.faces, /url\(https:\/\/mail\.example\.com\/fonts\/fraunces-latin\.woff2\)/);
	assert.equal(garden.fonts.outlookHeading, "Georgia,serif");
});
