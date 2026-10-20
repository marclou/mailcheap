import { buildSearchIndex } from "@/lib/search-index";

// The help center's and the docs' search index (lib/search-index.js), built with the site and loaded by the search
// dialog when it first opens.
export const dynamic = "force-static";

export async function GET() {
	return Response.json(await buildSearchIndex());
}
