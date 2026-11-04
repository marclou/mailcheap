import { mixColors } from "./colors.js";
import { resolveTheme } from "./themes.js";

const COLORS = { foreground: "#0a0a0a", muted: "#737373", border: "#e5e5e5" };
// MailCheap's own colors in dark mode, as the dashboard's (app/globals.css).
const DARK_COLORS = { background: "#0a0a0a", foreground: "#fafafa", muted: "#a1a1a1", border: "#262626" };

// What an issue's card shows, for the dashboard's previews of it: its page's title and description, the newsletter's
// name and logo, the date and the website's address, in the newsletter's theme.
export function getIssueCard({ newsletter, title, description, slug, date, domain }) {
	const theme = resolveTheme(newsletter.theme);
	return {
		title,
		description,
		name: newsletter.name,
		logo: newsletter.imageUrl || null,
		footer: date,
		domain,
		colors: getShareCardColors(theme),
		background: getIssueBackground(slug, theme),
		isIssue: true,
	};
}

// The colors of the card MailCheap draws for link previews and the website's cards (components/ImageShareCard.jsx), in
// one of a theme's modes, the one it's made for unless another is asked for: the website shows readers the card of
// theirs. MailCheap's own colors are black on white, or the dashboard's dark ones.
export function getShareCardColors(theme, mode = theme.mode) {
	if (theme.isAdaptive) return mode === "dark" ? DARK_COLORS : { background: "#ffffff", ...COLORS };
	const { colors, palette } = theme.modes[mode];
	return { background: colors.background, foreground: colors.text, muted: palette.mutedText, border: palette.border };
}

// Each issue gets its own soft tint, so archive cards stand out from the page and a row of them
// doesn't look like one card repeated. A newsletter theme's palette tints toward its accent instead.
export function getIssueBackground(slug, theme, mode = theme.mode) {
	let hue = 0;
	for (const character of String(slug ?? "")) hue = (hue * 31 + character.codePointAt(0)) % 360;
	if (theme.isAdaptive) {
		return mode === "dark"
			? `linear-gradient(135deg, hsl(${hue}, 30%, 13%), hsl(${(hue + 45) % 360}, 35%, 20%))`
			: `linear-gradient(135deg, hsl(${hue}, 85%, 96%), hsl(${(hue + 45) % 360}, 75%, 89%))`;
	}
	const { background, accent } = theme.modes[mode].colors;
	const step = (hue % 4) * 0.05;
	return `linear-gradient(135deg, ${mixColors(background, accent, 0.06 + step)}, ${mixColors(background, accent, 0.26 + step)})`;
}
