import { getContrast, getReadableText, isDarkColor, mixColors, normalizeHexColor } from "./colors.js";
import { OUTLOOK_FONTS, clampWeight, getFont, getFontFaceCss, getFontStack } from "./theme-fonts.js";

// A newsletter's theme: its look on its website and in its emails. It stores a preset and only what was changed on
// top of it, so a preset can improve without overwriting anyone's choices. Three colors make a palette: the page, the
// text and the accent (buttons, links); every other shade derives from them. Each theme has a light palette and a dark
// one: its website shows each reader the one their device uses, or the one they picked in its footer. Its emails are
// written in light, with the dark palette for the mail apps that follow a reader's dark mode (lib/render-email.js). The
// form for other sites and link previews, which can't follow a reader's mode, keep the mode it's made for.

export const DEFAULT_THEME_ID = "mailcheap";
export const RADIUS_OPTIONS = ["none", "small", "medium", "large", "full"];
export const SHADOW_OPTIONS = ["none", "soft", "lifted", "hard"];
export const SPACING_OPTIONS = ["compact", "comfortable", "spacious"];
// Where emails sit on a screen wider than them, like a computer's. Phones show them full width either way, and the
// website stays as it is.
export const EMAIL_ALIGN_OPTIONS = ["left", "center"];
export const HEADING_WEIGHTS = [400, 500, 600, 700, 800];
export const THEME_COLOR_KEYS = ["background", "text", "accent"];
export const THEME_MODES = ["light", "dark"];
// Each mode's palette changes, in a stored theme and the API. colors, as themes were stored before they had a dark
// palette and as the API still takes them, are the changes to the mode the theme is made for.
export const COLOR_GROUPS = { light: "lightColors", dark: "darkColors" };

// mode: the one it's made for, light unless it says otherwise. tracking: the headings' letter spacing, in em. Not one
// of the choices, it comes with the preset's fonts.
export const THEME_PRESETS = [
	{
		id: "mailcheap",
		name: "MailCheap",
		lightColors: { background: "#ffffff", text: "#0a0a0a", accent: "#171717" },
		darkColors: { background: "#0a0a0a", text: "#fafafa", accent: "#e5e5e5" },
		fonts: { heading: "geist", body: "geist" },
		headingWeight: 600,
		tracking: -0.02,
		radius: "medium",
		shadow: "soft",
		spacing: "comfortable",
		emailAlign: "center",
	},
	{
		id: "broadsheet",
		name: "Broadsheet",
		lightColors: { background: "#f5f0e8", text: "#1a1a1a", accent: "#b8321f" },
		darkColors: { background: "#181512", text: "#ede6da", accent: "#e8553c" },
		fonts: { heading: "instrument-serif", body: "newsreader" },
		headingWeight: 400,
		tracking: -0.01,
		radius: "none",
		shadow: "none",
		spacing: "spacious",
		emailAlign: "center",
	},
	{
		id: "garden",
		name: "Garden",
		lightColors: { background: "#eef1e8", text: "#1f2a22", accent: "#2f6a4a" },
		darkColors: { background: "#101914", text: "#e1eae3", accent: "#6cc290" },
		fonts: { heading: "fraunces", body: "dm-sans" },
		headingWeight: 600,
		tracking: -0.015,
		radius: "large",
		shadow: "soft",
		spacing: "spacious",
		emailAlign: "center",
	},
	{
		id: "midnight",
		name: "Midnight",
		mode: "dark",
		lightColors: { background: "#eef1f6", text: "#0d1017", accent: "#4a770f" },
		darkColors: { background: "#0d1017", text: "#e6e8ee", accent: "#c4f25c" },
		fonts: { heading: "manrope", body: "manrope" },
		headingWeight: 700,
		tracking: -0.025,
		radius: "large",
		shadow: "lifted",
		spacing: "comfortable",
		emailAlign: "center",
	},
	{
		id: "poster",
		name: "Poster",
		lightColors: { background: "#fffaeb", text: "#0b0b0b", accent: "#ffd23f" },
		darkColors: { background: "#14130f", text: "#f7f2e3", accent: "#ffd23f" },
		fonts: { heading: "bricolage-grotesque", body: "archivo" },
		headingWeight: 800,
		tracking: -0.03,
		radius: "none",
		shadow: "hard",
		spacing: "comfortable",
		emailAlign: "center",
	},
	{
		id: "swiss",
		name: "Swiss",
		lightColors: { background: "#ffffff", text: "#111111", accent: "#d92b16" },
		darkColors: { background: "#0e0e0e", text: "#f2f2f2", accent: "#ff4a2e" },
		fonts: { heading: "schibsted-grotesk", body: "schibsted-grotesk" },
		headingWeight: 700,
		tracking: -0.035,
		radius: "none",
		shadow: "none",
		spacing: "compact",
		emailAlign: "center",
	},
	{
		id: "typewriter",
		name: "Typewriter",
		lightColors: { background: "#f7f7f2", text: "#161616", accent: "#2f54eb" },
		darkColors: { background: "#151513", text: "#ebeae3", accent: "#7d9bff" },
		fonts: { heading: "jetbrains-mono", body: "jetbrains-mono" },
		headingWeight: 700,
		tracking: -0.02,
		radius: "small",
		shadow: "none",
		spacing: "compact",
		emailAlign: "center",
	},
	{
		id: "sunset",
		name: "Sunset",
		lightColors: { background: "#fff3ec", text: "#2b1a1e", accent: "#ff5a36" },
		darkColors: { background: "#1b1115", text: "#f7e6e1", accent: "#ff7a57" },
		fonts: { heading: "syne", body: "plus-jakarta-sans" },
		headingWeight: 700,
		tracking: -0.02,
		radius: "full",
		shadow: "lifted",
		spacing: "comfortable",
		emailAlign: "center",
	},
];

export const PRESET_IDS = THEME_PRESETS.map(({ id }) => id);
// MailCheap's own colors in the dashboard's previews of it, which follow the dashboard's light or dark mode.
export const ADAPTIVE_COLORS = { background: "var(--background)", text: "var(--foreground)", accent: "var(--primary)" };

const RADII = {
	none: { site: "0rem", image: "0rem", box: "0rem", email: { image: 0, box: 0, button: 0 } },
	small: { site: "0.25rem", image: "0.25rem", box: "0.375rem", email: { image: 4, box: 6, button: 4 } },
	medium: { site: "0.625rem", image: "0.75rem", box: "1rem", email: { image: 8, box: 12, button: 8 } },
	large: { site: "1rem", image: "1rem", box: "1.25rem", email: { image: 12, box: 16, button: 12 } },
	full: { site: "1.5rem", image: "1.5rem", box: "1.75rem", email: { image: 16, box: 20, button: 999 } },
};

// app/globals.css's radius scale.
const RADIUS_STEPS = [
	["sm", 0.6],
	["md", 0.8],
	["lg", 1],
	["xl", 1.4],
	["2xl", 1.8],
	["3xl", 2.2],
	["4xl", 2.6],
];

const SPACINGS = {
	compact: { leading: 1.65, gap: "1em", email: { padding: "24px 16px", gap: 14, lineHeight: 1.55 } },
	comfortable: { leading: 1.75, gap: "1.25em", email: { padding: "32px 20px", gap: 16, lineHeight: 1.65 } },
	spacious: { leading: 1.85, gap: "1.5em", email: { padding: "40px 24px", gap: 20, lineHeight: 1.75 } },
};

// Built on var(--foreground) and var(--border), so they follow the reader's dark mode where the palette does. Soft is
// the dashboard's own (app/globals.css), which MailCheap's colors inherit with their dark mode.
const SHADOWS = {
	none: ["0 0 0 1px var(--border)", "0 0 0 1px color-mix(in oklab, var(--foreground) 22%, transparent)"],
	soft: {
		light: [
			"0px 0px 0px 1px rgba(0, 0, 0, 0.06), 0px 1px 2px -1px rgba(0, 0, 0, 0.06), 0px 2px 4px 0px rgba(0, 0, 0, 0.04)",
			"0px 0px 0px 1px rgba(0, 0, 0, 0.08), 0px 1px 2px -1px rgba(0, 0, 0, 0.08), 0px 2px 4px 0px rgba(0, 0, 0, 0.06)",
		],
		dark: ["0 0 0 1px rgba(255, 255, 255, 0.08)", "0 0 0 1px rgba(255, 255, 255, 0.13)"],
	},
	lifted: [
		"0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent), 0 12px 28px -12px rgb(0 0 0 / 0.28)",
		"0 0 0 1px color-mix(in oklab, var(--foreground) 12%, transparent), 0 16px 36px -12px rgb(0 0 0 / 0.34)",
	],
	hard: [
		"0 0 0 2px var(--foreground), 4px 4px 0 0 var(--foreground)",
		"0 0 0 2px var(--foreground), 6px 6px 0 0 var(--foreground)",
	],
};

// What emails used before themes, and still use with MailCheap's own colors in light.
const MAILCHEAP_EMAIL_COLORS = {
	background: "#ffffff",
	text: "#27272a",
	heading: "#09090b",
	link: "#18181b",
	muted: "#71717a",
	faint: "#a1a1aa",
	border: "#e4e4e7",
	quote: "#52525b",
	surface: "#f4f4f5",
	button: "#18181b",
	buttonText: "#ffffff",
};
export const SYSTEM_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// The dashboard and the archive load Geist themselves (app/layout.js); emails get the file in public/fonts.
const SITE_GEIST_STACK = '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif';

export function getPreset(id) {
	return THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0];
}

export function getPresetMode(preset) {
	return preset.mode ?? "light";
}

// The stored shape with only valid changes that differ from the preset: an empty change list means the preset as is.
export function normalizeTheme(theme) {
	const preset = getPreset(theme?.preset);
	const normalized = { preset: preset.id };
	for (const mode of THEME_MODES) {
		const group = COLOR_GROUPS[mode];
		const changes = theme?.[group] ?? (mode === getPresetMode(preset) ? theme?.colors : null);
		const colors = {};
		for (const key of THEME_COLOR_KEYS) {
			const color = normalizeHexColor(changes?.[key]);
			if (color && color !== preset[group][key]) colors[key] = color;
		}
		if (Object.keys(colors).length) normalized[group] = colors;
	}
	const fonts = {};
	for (const key of ["heading", "body"]) {
		const font = getFont(theme?.fonts?.[key]);
		if (font && font.id !== preset.fonts[key]) fonts[key] = font.id;
	}
	if (Object.keys(fonts).length) normalized.fonts = fonts;
	const weight = Number(theme?.headingWeight);
	if (HEADING_WEIGHTS.includes(weight) && weight !== preset.headingWeight) normalized.headingWeight = weight;
	for (const [key, options] of [
		["radius", RADIUS_OPTIONS],
		["shadow", SHADOW_OPTIONS],
		["spacing", SPACING_OPTIONS],
		["emailAlign", EMAIL_ALIGN_OPTIONS],
	]) {
		if (options.includes(theme?.[key]) && theme[key] !== preset[key]) normalized[key] = theme[key];
	}
	return normalized;
}

// A change of preset starts from the new preset; other changes land on the saved ones, and null takes one back.
// colors changes the mode the theme is made for, unless that mode's own group comes too.
export function mergeTheme(current, changes) {
	if (!changes) return normalizeTheme(current);
	const isNewPreset = changes.preset && changes.preset !== normalizeTheme(current).preset;
	const base = isNewPreset ? { preset: changes.preset } : normalizeTheme(current);
	const ownGroup = COLOR_GROUPS[getPresetMode(getPreset(base.preset))];
	const groups = { ...(changes.colors !== undefined && { [ownGroup]: changes.colors }), ...changes };
	const merged = { ...base, ...pickScalars(changes) };
	for (const group of [...Object.values(COLOR_GROUPS), "fonts"]) {
		if (groups[group] === null) delete merged[group];
		else if (groups[group]) merged[group] = withoutNulls({ ...base[group], ...groups[group] });
	}
	return normalizeTheme(withoutNulls(merged));
}

function pickScalars(changes) {
	const scalars = {};
	for (const key of ["headingWeight", "radius", "shadow", "spacing", "emailAlign"]) if (key in changes) scalars[key] = changes[key];
	return scalars;
}

function withoutNulls(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

export function isCustomized(theme) {
	return Object.keys(normalizeTheme(theme)).length > 1;
}

// Everything a theme looks like, with its derived shades: modes holds each palette, and colors, palette and scheme
// are the one of the mode it's made for (mode). adaptive: MailCheap's own colors, the dashboard's, which pages inherit.
export function resolveTheme(theme) {
	const stored = normalizeTheme(theme);
	const preset = getPreset(stored.preset);
	const mode = getPresetMode(preset);
	const modes = resolveModes(preset, stored);
	const fonts = { heading: getFont(stored.fonts?.heading ?? preset.fonts.heading), body: getFont(stored.fonts?.body ?? preset.fonts.body) };
	return {
		id: preset.id,
		name: preset.name,
		stored,
		isDefault: Object.keys(stored).length === 1 && preset.id === DEFAULT_THEME_ID,
		isCustomized: Object.keys(stored).length > 1,
		isAdaptive: preset.id === DEFAULT_THEME_ID && !stored.lightColors && !stored.darkColors,
		isFontDefault: preset.id === DEFAULT_THEME_ID && !stored.fonts,
		mode,
		modes,
		...modes[mode],
		fonts,
		headingWeight: clampWeight(fonts.heading, stored.headingWeight ?? preset.headingWeight),
		tracking: preset.tracking,
		radius: stored.radius ?? preset.radius,
		shadow: stored.shadow ?? preset.shadow,
		spacing: stored.spacing ?? preset.spacing,
		emailAlign: stored.emailAlign ?? preset.emailAlign,
	};
}

// An accent changed in one mode alone, like a brand's color, follows into the other, as close to it as that mode's page
// lets it stand out.
function resolveModes(preset, stored) {
	const light = { ...preset.lightColors, ...stored.lightColors };
	const dark = { ...preset.darkColors, ...stored.darkColors };
	if (stored.lightColors?.accent && !stored.darkColors?.accent) dark.accent = standOut(stored.lightColors.accent, dark.background);
	if (stored.darkColors?.accent && !stored.lightColors?.accent) light.accent = standOut(stored.darkColors.accent, light.background);
	return { light: toMode(light), dark: toMode(dark) };
}

function toMode(colors) {
	return { colors, palette: derivePalette(colors), scheme: isDarkColor(colors.background) ? "dark" : "light" };
}

// The color, or the closest to it toward white on a dark page and black on a light one with the 3:1 WCAG asks of a
// control against its background.
function standOut(color, background) {
	const toward = isDarkColor(background) ? "#ffffff" : "#000000";
	for (let step = 0; step <= 10; step += 1) {
		const candidate = mixColors(color, toward, step / 10);
		if (getContrast(candidate, background) >= 3) return candidate;
	}
	return toward;
}

// Cards sit a step lighter than the page, muted surfaces and borders a step toward the text.
function derivePalette({ background, text, accent }) {
	const isDark = isDarkColor(background);
	const card = isDark ? mixColors(background, "#ffffff", 0.05) : mixColors(background, "#ffffff", 0.55);
	const isAccentReadable = getContrast(accent, background) >= 4.5;
	return {
		card,
		muted: mixColors(background, text, isDark ? 0.09 : 0.05),
		mutedText: mixColors(text, background, 0.42),
		border: mixColors(background, text, isDark ? 0.16 : 0.12),
		onAccent: getReadableText(accent),
		link: isAccentReadable ? accent : text,
		linkDecoration: isAccentReadable ? mixColors(accent, background, 0.55) : accent,
		ring: mixColors(accent, background, 0.45),
		bodyText: mixColors(text, background, 0.12),
	};
}

// A resolved theme's palettes as the dashboard's swatches paint them, each in its mode: MailCheap's own colors are the
// dashboard's in either.
export function getSwatchColors(resolved) {
	if (resolved.isAdaptive) return { light: ADAPTIVE_COLORS, dark: ADAPTIVE_COLORS };
	return { light: resolved.modes.light.colors, dark: resolved.modes.dark.colors };
}

export function getThemeSummary(newsletter) {
	const resolved = resolveTheme(newsletter?.theme);
	return { id: resolved.id, name: resolved.name, isCustomized: resolved.isCustomized, colors: resolved.colors };
}

// The theme as the API and MCP give it: the values in effect, and which of them were changed on top of the preset.
// colors: the mode it's made for's, as before it had two.
export function getThemeOutput(theme) {
	const resolved = resolveTheme(theme);
	const { preset, ...changes } = resolved.stored;
	return {
		preset,
		name: resolved.name,
		customized: Object.keys(changes),
		colors: resolved.colors,
		lightColors: resolved.modes.light.colors,
		darkColors: resolved.modes.dark.colors,
		fonts: { heading: resolved.fonts.heading.id, body: resolved.fonts.body.id },
		headingWeight: resolved.headingWeight,
		radius: resolved.radius,
		shadow: resolved.shadow,
		spacing: resolved.spacing,
		emailAlign: resolved.emailAlign,
	};
}

export function getThemeFonts(resolved) {
	if (resolved.isFontDefault) return [];
	return [resolved.fonts.heading, resolved.fonts.body].filter((font) => font.id !== "geist");
}

function getSiteFontStack(font) {
	return font.id === "geist" ? SITE_GEIST_STACK : getFontStack(font);
}

// The CSS custom properties the archive's pages, the issue styles (.prose-issue) and the dashboard's previews read, in
// one mode: the one the theme is made for unless another is asked for. MailCheap's own theme sets none, so its pages
// stay as they always were.
export function getThemeVariables(resolved, mode = resolved.mode) {
	if (resolved.isDefault) return {};
	const preset = getPreset(resolved.id);
	const { colors, palette, scheme } = resolved.modes[mode];
	const variables = {};
	if (!resolved.isAdaptive) {
		const { background, text, accent } = colors;
		const { card, muted, mutedText, border, onAccent, link, linkDecoration, ring } = palette;
		Object.assign(variables, {
			"--background": background,
			"--foreground": text,
			"--card": card,
			"--card-foreground": text,
			"--popover": card,
			"--popover-foreground": text,
			"--primary": accent,
			"--primary-foreground": onAccent,
			"--secondary": muted,
			"--secondary-foreground": text,
			"--muted": muted,
			"--muted-foreground": mutedText,
			"--accent": muted,
			"--accent-foreground": text,
			"--border": border,
			"--input": border,
			"--ring": ring,
			"--theme-link": link,
			"--theme-link-decoration": linkDecoration,
			"--image-backdrop": scheme === "dark" ? "#ffffff" : "transparent",
			"--mark-background": scheme === "dark" ? "color-mix(in oklab, #fff4d1 22%, transparent)" : "#fff4d1",
			"color-scheme": scheme,
		});
	}
	const shadows = resolved.shadow === "soft" ? (resolved.isAdaptive ? null : SHADOWS.soft[scheme]) : SHADOWS[resolved.shadow];
	if (shadows) Object.assign(variables, { "--surface-shadow": shadows[0], "--surface-shadow-hover": shadows[1] });
	if (resolved.radius !== preset.radius || resolved.id !== DEFAULT_THEME_ID) {
		const radius = RADII[resolved.radius];
		Object.assign(variables, { "--radius": radius.site, "--theme-image-radius": radius.image, "--theme-box-radius": radius.box });
		// The root works these out from its own radius, and what inherits is the result: they're set again here.
		for (const [size, factor] of RADIUS_STEPS) variables[`--radius-${size}`] = `calc(var(--radius) * ${factor})`;
	}
	if (!resolved.isFontDefault) {
		variables["--theme-font-heading"] = getSiteFontStack(resolved.fonts.heading);
		variables["--theme-font-body"] = getSiteFontStack(resolved.fonts.body);
	}
	if (resolved.id !== DEFAULT_THEME_ID || resolved.headingWeight !== preset.headingWeight) {
		variables["--theme-heading-weight"] = String(resolved.headingWeight);
		variables["--theme-heading-tracking"] = `${resolved.tracking}em`;
	}
	if (resolved.spacing !== "comfortable") {
		variables["--theme-prose-leading"] = String(SPACINGS[resolved.spacing].leading);
		variables["--theme-prose-gap"] = SPACINGS[resolved.spacing].gap;
	}
	return variables;
}

// The archive's whole document: the dialogs it opens render outside its layout, at the end of the body.
export function getThemeStyleSheet(resolved) {
	return getFontFaceCss(getThemeFonts(resolved)) + getThemeRules(resolved, "body");
}

// The theme over what selector matches: the light palette, then what changes in dark mode, which ProviderTheme marks
// with the dark class on the html element, from the reader's device or what they picked (components/PickerMode.jsx).
export function getThemeRules(resolved, selector) {
	const light = getThemeVariables(resolved, "light");
	const dark = getThemeVariables(resolved, "dark");
	const darkChanges = Object.fromEntries(Object.entries(dark).filter(([name, value]) => light[name] !== value));
	return toRule(selector, light) + toRule(`.dark ${selector}`, darkChanges);
}

function toRule(selector, variables) {
	const declarations = Object.entries(variables).map(([name, value]) => `${name}:${value}`);
	if (variables["--theme-font-body"]) declarations.push("font-family:var(--theme-font-body)");
	return declarations.length ? `${selector}{${declarations.join(";")}}` : "";
}

// What the email renderer needs (lib/render-email.js), in mode's colors, with dark's for the mail apps that follow a
// reader's dark mode. Emails are written in light: Gmail, which reads no dark colors, darkens those itself. MailCheap's
// own theme gives the values emails always had. fontBaseUrl: where the fonts are served from, the app's URL for sent
// emails.
export function getEmailTheme(resolved, fontBaseUrl = "", mode = "light") {
	const spacing = SPACINGS[resolved.spacing].email;
	const radius = RADII[resolved.radius].email;
	const fonts = resolved.isFontDefault
		? { body: SYSTEM_FONT_STACK, heading: null, faces: "", outlookBody: null, outlookHeading: null }
		: {
				body: getFontStack(resolved.fonts.body),
				heading: getFontStack(resolved.fonts.heading),
				faces: getFontFaceCss([resolved.fonts.heading, resolved.fonts.body], fontBaseUrl),
				outlookBody: OUTLOOK_FONTS[resolved.fonts.body.category],
				outlookHeading: OUTLOOK_FONTS[resolved.fonts.heading.category],
			};
	// Headings kept the clients' own bold before themes, and still do with MailCheap's fonts and weight.
	const hasOwnHeadings = resolved.isFontDefault && resolved.headingWeight === getPreset(DEFAULT_THEME_ID).headingWeight;
	return {
		isDefault: resolved.isDefault,
		...getEmailColors(resolved, mode),
		dark: getEmailColors(resolved, "dark"),
		fonts,
		headingWeight: hasOwnHeadings ? null : resolved.headingWeight,
		headingTracking: hasOwnHeadings ? null : `${resolved.tracking}em`,
		...spacing,
		radius,
		align: resolved.emailAlign,
	};
}

function getEmailColors(resolved, mode) {
	return resolved.isAdaptive && mode === "light" ? MAILCHEAP_EMAIL_COLORS : deriveEmailColors(resolved.modes[mode]);
}

function deriveEmailColors({ colors: { background, text, accent }, palette }) {
	return {
		background,
		text: palette.bodyText,
		heading: text,
		link: palette.link,
		muted: mixColors(text, background, 0.45),
		faint: mixColors(text, background, 0.6),
		border: mixColors(background, text, 0.12),
		quote: mixColors(text, background, 0.3),
		surface: mixColors(background, text, 0.05),
		button: accent,
		buttonText: palette.onAccent,
	};
}
