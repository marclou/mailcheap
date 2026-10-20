import { preload } from "react-dom";
import { getFontPath } from "@/lib/theme-fonts";
import { getThemeFonts, getThemeStyleSheet, resolveTheme } from "@/lib/themes";

// A newsletter's theme over the whole page its subscribers see: the archive, an issue, the confirmation page. The
// body carries it, since dialogs render outside the page's layout.
export default function StyleTheme({ theme }) {
	const resolved = resolveTheme(theme);
	for (const font of getThemeFonts(resolved)) {
		preload(getFontPath(font), { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
	}
	const styleSheet = getThemeStyleSheet(resolved);
	return styleSheet ? <style dangerouslySetInnerHTML={{ __html: styleSheet }} /> : null;
}
