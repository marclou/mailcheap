import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app", import.meta.url));

// The app's pages, by path: each app/**/page.js without its route groups. Pages with a dynamic segment are left out, since
// a link written in text can't know their id.
export async function listAppPages() {
	const rawFiles = await readdir(APP, { recursive: true });
	const files = rawFiles.map((file) => file.replaceAll("\\", "/"));
	return new Set(
		files
			.filter((file) => /(^|\/)page\.js$/.test(file))
			.map((file) => `/${file.split("/").slice(0, -1).filter((part) => !/^\(.+\)$/.test(part)).join("/")}`)
			.filter((path) => !path.includes("["))
	);
}
