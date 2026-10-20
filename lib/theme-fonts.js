// The fonts newsletter themes choose from, served from public/fonts (variable weights, latin and latin-ext subsets,
// OFL: public/fonts/OFL.txt). Their faces are named "MC <name>", so they never mix with a copy installed on the
// reader's computer or with the dashboard's own Geist. Mail clients without web fonts, like Gmail, use the
// category's fallbacks.

export const FONT_SUBSETS = {
	latin:
		"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
	"latin-ext":
		"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
};

const FALLBACKS = {
	sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
	serif: "Georgia,'Times New Roman',Times,serif",
	mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace",
};

// Outlook on Windows drops the whole stack for Times New Roman when its first font is a web font: it's given one of
// these instead, in a block only it reads.
export const OUTLOOK_FONTS = { sans: "Arial,sans-serif", serif: "Georgia,serif", mono: "'Courier New',monospace" };

// weights: the range the file covers. italic: the file has true italics; without, browsers slant the upright.
export const THEME_FONTS = [
	{ id: "geist", name: "Geist", category: "sans", weights: [100, 900] },
	{ id: "dm-sans", name: "DM Sans", category: "sans", weights: [100, 1000] },
	{ id: "manrope", name: "Manrope", category: "sans", weights: [200, 800] },
	{ id: "plus-jakarta-sans", name: "Plus Jakarta Sans", category: "sans", weights: [200, 800] },
	{ id: "archivo", name: "Archivo", category: "sans", weights: [100, 900] },
	{ id: "schibsted-grotesk", name: "Schibsted Grotesk", category: "sans", weights: [400, 900] },
	{ id: "bricolage-grotesque", name: "Bricolage Grotesque", category: "sans", weights: [200, 800] },
	{ id: "syne", name: "Syne", category: "sans", weights: [400, 800] },
	{ id: "newsreader", name: "Newsreader", category: "serif", weights: [200, 800], italic: true },
	{ id: "fraunces", name: "Fraunces", category: "serif", weights: [100, 900] },
	{ id: "instrument-serif", name: "Instrument Serif", category: "serif", weights: [400, 400], italic: true },
	{ id: "jetbrains-mono", name: "JetBrains Mono", category: "mono", weights: [100, 800] },
];

export const FONT_IDS = THEME_FONTS.map(({ id }) => id);

export function getFont(id) {
	return THEME_FONTS.find((font) => font.id === id) ?? null;
}

// The closest weight the font has.
export function clampWeight(font, weight) {
	const [min, max] = font.weights;
	return Math.min(max, Math.max(min, weight));
}

export function getFontStack(font) {
	return `'MC ${font.name}',${FALLBACKS[font.category]}`;
}

// baseUrl: empty for pages on the server's own host; emails need the app's URL, since they're read anywhere.
export function getFontFaceCss(fonts, baseUrl = "") {
	const unique = [...new Map(fonts.filter(Boolean).map((font) => [font.id, font])).values()];
	return unique
		.flatMap((font) =>
			(font.italic ? ["normal", "italic"] : ["normal"]).flatMap((style) =>
				Object.entries(FONT_SUBSETS).map(
					([subset, range]) =>
						`@font-face{font-family:'MC ${font.name}';font-style:${style};font-weight:${[...new Set(font.weights)].join(" ")};font-display:swap;src:url(${baseUrl}${getFontPath(font, subset, style)}) format('woff2');unicode-range:${range}}`
				)
			)
		)
		.join("");
}

export function getFontPath(font, subset = "latin", style = "normal") {
	return `/fonts/${font.id}${style === "italic" ? "-italic" : ""}-${subset}.woff2`;
}
