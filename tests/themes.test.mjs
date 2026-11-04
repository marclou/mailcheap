import assert from "node:assert/strict";
import { test } from "node:test";
import { getShareCardUrl } from "../lib/archive-seo.js";
import { getContrast, normalizeHexColor } from "../lib/colors.js";
import { getIssueBackground, getShareCardColors } from "../lib/share-card.js";
import { THEME_FONTS, getFontFaceCss } from "../lib/theme-fonts.js";
import {
	THEME_MODES,
	THEME_PRESETS,
	getEmailTheme,
	getSwatchColors,
	getThemeOutput,
	getThemeRules,
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
	assert.deepEqual(theme, { preset: "broadsheet", lightColors: { text: "#112233" }, fonts: { body: "dm-sans" }, radius: "large" });
	assert.equal(normalizeTheme({ preset: "unknown" }).preset, "mailcheap");
	assert.equal(normalizeHexColor("abc"), "#aabbcc");
	assert.equal(normalizeHexColor("#12345"), null);
});

test("another preset starts over, the same one keeps its changes, and null takes one back", () => {
	const current = { preset: "garden", lightColors: { accent: "#ff0000" }, radius: "none" };
	assert.deepEqual(mergeTheme(current, { preset: "swiss" }), { preset: "swiss" });
	assert.deepEqual(mergeTheme(current, { preset: "swiss", spacing: "spacious" }), { preset: "swiss", spacing: "spacious" });
	assert.deepEqual(mergeTheme(current, { lightColors: { text: "#000000" } }), {
		preset: "garden",
		lightColors: { accent: "#ff0000", text: "#000000" },
		radius: "none",
	});
	assert.deepEqual(mergeTheme(current, { darkColors: { background: "#000000" } }), {
		preset: "garden",
		lightColors: { accent: "#ff0000" },
		darkColors: { background: "#000000" },
		radius: "none",
	});
	assert.deepEqual(mergeTheme(current, { lightColors: { accent: null }, radius: null }), { preset: "garden" });
	assert.deepEqual(mergeTheme(current, undefined), current);
	assert.equal(isCustomized(current), true);
	assert.equal(isCustomized({ preset: "garden", radius: "large" }), false);
});

test("every preset reads well in both modes: text on its page, labels on its buttons, links or their underline", () => {
	for (const preset of THEME_PRESETS) {
		for (const mode of THEME_MODES) {
			const { colors, palette, scheme } = resolveTheme({ preset: preset.id }).modes[mode];
			const name = `${preset.id} ${mode}`;
			assert.equal(scheme, mode, `${name}: its page is ${mode}`);
			assert.ok(getContrast(colors.text, colors.background) >= 7, `${name} text`);
			assert.ok(getContrast(palette.onAccent, colors.accent) >= 4.5, `${name} button label`);
			assert.ok(getContrast(palette.link, colors.background) >= 4.5, `${name} links`);
			assert.ok(getContrast(palette.mutedText, colors.background) >= 3, `${name} muted text`);
		}
	}
});

test("a yellow accent too light for text paints buttons and underlines, links stay in the text color", () => {
	const { palette, colors } = resolveTheme({ preset: "poster" });
	assert.equal(palette.link, colors.text);
	assert.equal(palette.linkDecoration, colors.accent);
	assert.equal(palette.onAccent, "#0a0a0a");
});

test("Midnight is made for dark mode, with a light palette too, and MailCheap's own colors are the dashboard's", () => {
	const midnight = resolveTheme({ preset: "midnight" });
	assert.equal(midnight.mode, "dark");
	assert.equal(resolveTheme({ preset: "garden" }).mode, "light");
	const own = getThemeVariables(midnight);
	assert.equal(own["--background"], "#0d1017");
	assert.equal(own["color-scheme"], "dark");
	assert.equal(own["--image-backdrop"], "#ffffff");
	const light = getThemeVariables(midnight, "light");
	assert.equal(light["--background"], "#eef1f6");
	assert.equal(light["color-scheme"], "light");
	assert.equal(light["--image-backdrop"], "transparent");
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
	assert.match(sheet, /body\{[^}]*font-family:var\(--theme-font-body\)\}/);
	assert.doesNotMatch(getThemeStyleSheet(resolveTheme({ preset: "mailcheap", colors: { accent: "#2563eb" } })), /@font-face/);
	assert.equal(getFontFaceCss([THEME_FONTS[0], THEME_FONTS[0]]).split("@font-face").length - 1, 2, "one face per subset");
});

test("the API gives the values in effect and what was changed", () => {
	assert.deepEqual(getThemeOutput({ preset: "sunset", fonts: { body: "manrope" } }), {
		preset: "sunset",
		name: "Sunset",
		customized: ["fonts"],
		colors: { background: "#fff3ec", text: "#2b1a1e", accent: "#ff5a36" },
		lightColors: { background: "#fff3ec", text: "#2b1a1e", accent: "#ff5a36" },
		darkColors: { background: "#1b1115", text: "#f7e6e1", accent: "#ff7a57" },
		fonts: { heading: "syne", body: "manrope" },
		headingWeight: 700,
		radius: "full",
		shadow: "lifted",
		spacing: "comfortable",
		emailAlign: "center",
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
	assert.equal(
		getShareCardUrl({ slug: "notes", theme: { preset: "garden" } }, issue, "https://app.test", "light"),
		"https://app.test/archive/notes/og?p=hello&t=eef1e81f2a222f6a4a",
		"the website's light card is the link previews' one"
	);
	assert.equal(
		getShareCardUrl({ slug: "notes", theme: { preset: "garden" } }, issue, "https://app.test", "dark"),
		"https://app.test/archive/notes/og?p=hello&m=dark&t=101914e1eae36cc290"
	);
	assert.equal(
		getShareCardUrl({ slug: "notes", theme: { preset: "midnight" } }, issue, "https://app.test", "light"),
		"https://app.test/archive/notes/og?p=hello&m=light&t=eef1f60d10174a770f"
	);
	assert.equal(getShareCardUrl({ slug: "notes" }, issue, "https://app.test", "dark"), "https://app.test/archive/notes/og?p=hello&m=dark");
});

test("a card in either mode has that mode's colors, MailCheap's own included", () => {
	const garden = resolveTheme({ preset: "garden" });
	assert.equal(getShareCardColors(garden).background, "#eef1e8");
	assert.equal(getShareCardColors(garden, "dark").background, "#101914");
	assert.equal(getShareCardColors(resolveTheme({ preset: "midnight" })).background, "#0d1017", "link previews keep Midnight dark");
	const mailcheap = resolveTheme(null);
	assert.equal(getShareCardColors(mailcheap).background, "#ffffff");
	assert.equal(getShareCardColors(mailcheap, "dark").background, "#0a0a0a");
	assert.notEqual(getIssueBackground("hello", mailcheap, "dark"), getIssueBackground("hello", mailcheap));
	assert.match(getIssueBackground("hello", garden, "dark"), /^linear-gradient\(135deg, #1/);
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

test("emails are in a theme's light colors, with its dark ones for mail apps in dark mode", () => {
	const midnight = getEmailTheme(resolveTheme({ preset: "midnight" }));
	assert.equal(midnight.background, "#eef1f6", "Midnight's too, though it's made for dark");
	assert.equal(midnight.dark.background, "#0d1017");
	assert.equal(midnight.dark.button, "#c4f25c");
	assert.equal(getEmailTheme(resolveTheme({ preset: "midnight" }), "", "dark").background, "#0d1017");
	const garden = getEmailTheme(resolveTheme({ preset: "garden", darkColors: { background: "#000000" } }));
	assert.equal(garden.background, "#eef1e8");
	assert.equal(garden.dark.background, "#000000");
	const plain = getEmailTheme(resolveTheme(null));
	assert.equal(plain.background, "#ffffff", "MailCheap's own colors in light");
	assert.equal(plain.dark.background, "#0a0a0a");
});

test("emails can sit on the left, a choice like the others that the website never shows", () => {
	const left = { preset: "garden", emailAlign: "left" };
	assert.deepEqual(normalizeTheme(left), left);
	assert.deepEqual(normalizeTheme({ preset: "garden", emailAlign: "center" }), { preset: "garden" }, "the preset's own");
	assert.deepEqual(normalizeTheme({ preset: "garden", emailAlign: "right" }), { preset: "garden" });
	assert.deepEqual(mergeTheme(left, { emailAlign: null }), { preset: "garden" });
	assert.deepEqual(mergeTheme(left, { preset: "swiss" }), { preset: "swiss" }, "another preset starts over");
	assert.deepEqual(getThemeOutput(left).customized, ["emailAlign"]);
	assert.equal(getEmailTheme(resolveTheme(null)).align, "center");
	assert.equal(getEmailTheme(resolveTheme(left)).align, "left");
	assert.equal(getThemeStyleSheet(resolveTheme({ preset: "mailcheap", emailAlign: "left" })), "", "MailCheap's pages stay as they always were");
	assert.equal(getThemeStyleSheet(resolveTheme(left)), getThemeStyleSheet(resolveTheme({ preset: "garden" })));
});

test("colors saved before themes had a dark palette, or sent as the API takes them, are the mode the theme is made for", () => {
	assert.deepEqual(normalizeTheme({ preset: "garden", colors: { accent: "#ff0000" } }), { preset: "garden", lightColors: { accent: "#ff0000" } });
	assert.deepEqual(normalizeTheme({ preset: "midnight", colors: { background: "#000000" } }), { preset: "midnight", darkColors: { background: "#000000" } });
	assert.deepEqual(
		normalizeTheme({ preset: "garden", colors: { accent: "#ff0000" }, lightColors: { text: "#000000" } }),
		{ preset: "garden", lightColors: { text: "#000000" } },
		"a mode's own group wins"
	);
	const midnight = { preset: "midnight", darkColors: { accent: "#ff4f9a" } };
	assert.deepEqual(mergeTheme(midnight, { colors: { text: "#ffffff" } }), { preset: "midnight", darkColors: { accent: "#ff4f9a", text: "#ffffff" } });
	assert.deepEqual(mergeTheme(midnight, { colors: { text: "#ffffff" }, darkColors: { text: "#eeeeee" } }), {
		preset: "midnight",
		darkColors: { accent: "#ff4f9a", text: "#eeeeee" },
	});
	assert.deepEqual(mergeTheme(midnight, { preset: "garden", colors: { accent: "#123456" } }), { preset: "garden", lightColors: { accent: "#123456" } });
	assert.deepEqual(getThemeOutput({ preset: "midnight", colors: { accent: "#ff4f9a" } }).customized, ["darkColors"]);
	assert.equal(getThemeOutput({ preset: "midnight" }).colors.background, "#0d1017", "the API's colors stay the mode it's made for");
});

test("an accent changed in one mode alone follows into the other, made to stand out on that mode's page", () => {
	const navy = resolveTheme({ preset: "garden", lightColors: { accent: "#1d3557" } });
	assert.equal(navy.modes.light.colors.accent, "#1d3557");
	assert.notEqual(navy.modes.dark.colors.accent, "#1d3557", "too dark for Garden's dark page");
	assert.ok(getContrast(navy.modes.dark.colors.accent, navy.modes.dark.colors.background) >= 3);
	assert.equal(resolveTheme({ preset: "garden", lightColors: { accent: "#ffb703" } }).modes.dark.colors.accent, "#ffb703", "bright enough already");
	const both = resolveTheme({ preset: "garden", lightColors: { accent: "#1d3557" }, darkColors: { accent: "#ff0000" } });
	assert.equal(both.modes.dark.colors.accent, "#ff0000", "a dark accent of its own stays");
	const fromDark = resolveTheme({ preset: "midnight", darkColors: { accent: "#ffe600" } });
	assert.ok(getContrast(fromDark.modes.light.colors.accent, fromDark.modes.light.colors.background) >= 3, "darkened for the light page");
});

test("a website's stylesheet has the light palette, then what changes in dark mode", () => {
	const garden = getThemeStyleSheet(resolveTheme({ preset: "garden" }));
	assert.match(garden, /body\{--background:#eef1e8;--foreground:#1f2a22;/);
	assert.match(garden, /\.dark body\{--background:#101914;--foreground:#e1eae3;/);
	assert.match(garden, /\.dark body\{[^}]*color-scheme:dark/);
	assert.doesNotMatch(garden.split(".dark body")[1], /--radius|--theme-font/, "dark mode changes colors only");
	assert.doesNotMatch(getThemeStyleSheet(resolveTheme({ preset: "mailcheap", radius: "none" })), /\.dark/, "MailCheap's own colors follow the page");
	const branded = getThemeStyleSheet(resolveTheme({ preset: "mailcheap", lightColors: { accent: "#2563eb" } }));
	assert.match(branded, /body\{--background:#ffffff;[^}]*--primary:#2563eb;/);
	assert.match(branded, /\.dark body\{--background:#0a0a0a;/);
	assert.doesNotMatch(branded.split(".dark body")[1], /--primary:/, "the brand blue stands out on the dark page as it is");
	const rules = getThemeRules(resolveTheme({ preset: "poster" }), '[data-theme-scope="a1"]');
	assert.match(rules, /^\[data-theme-scope="a1"\]\{--background:#fffaeb;/);
	assert.match(rules, /\.dark \[data-theme-scope="a1"\]\{--background:#14130f;/);
});

test("a stored theme can't put CSS or markup of its own in a page: only hex colors and known choices reach its rules", () => {
	const hostile = {
		preset: "garden",
		lightColors: { background: "red;}body{display:none" },
		darkColors: { accent: "#fff}</style><script>alert(1)</script>" },
		colors: { text: "url(https://example.com/x)" },
		fonts: { heading: "x;}body{" },
		radius: "none;}",
		shadow: "</style>",
		emailAlign: 'left" onclick="alert(1)',
	};
	assert.deepEqual(normalizeTheme(hostile), { preset: "garden" });
	const resolved = resolveTheme(hostile);
	const css = getThemeStyleSheet(resolved) + getThemeRules(resolved, '[data-theme-scope="a1"]');
	assert.doesNotMatch(css, /display:none|<\/style>|<script|example\.com|body\{body/);
});

test("the dashboard's swatches paint each mode's colors, MailCheap's own being the dashboard's", () => {
	assert.deepEqual(getSwatchColors(resolveTheme({ preset: "swiss" })), {
		light: { background: "#ffffff", text: "#111111", accent: "#d92b16" },
		dark: { background: "#0e0e0e", text: "#f2f2f2", accent: "#ff4a2e" },
	});
	const mailcheap = getSwatchColors(resolveTheme(null));
	assert.equal(mailcheap.light.background, "var(--background)");
	assert.equal(mailcheap.dark.accent, "var(--primary)");
});
