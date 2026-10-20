import { readFile } from "node:fs/promises";
import path from "node:path";
import { isBotIdEnabled } from "@/lib/bot-check";

// Vercel BotID's browser code for the signup form's frame (lib/signup-form-page.js), which loads on other sites without
// the app's bundles. Read from the installed package, so it changes with it.
const SOURCE_PATH = path.join(process.cwd(), "node_modules/botid/dist/client/core/index.mjs");
let source;

export async function GET() {
	if (!isBotIdEnabled()) return new Response(null, { status: 404 });
	source ??= await readFile(SOURCE_PATH, "utf8");
	return new Response(source, {
		headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
	});
}
