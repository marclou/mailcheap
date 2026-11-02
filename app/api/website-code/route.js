import { getArchiveNewsletter } from "@/lib/archive-data";
import { getAppHost, getSharedDomain } from "@/lib/config";
import { resolveArchiveHost } from "@/lib/host-routing";
import { getOwnDomain } from "@/lib/website-analytics";

function noCode() {
	return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// A newsletter's own code for its website's pages (lib/website-code.js), answered on its own domain alone, from the host
// the request came to: never on its address on the shared domain, nor while its website is offline. Cached by the
// browser only, so no shared cache ever hands one host's answer to another.
export async function GET(request) {
	const host = request.headers.get("host");
	const hostname = String(host ?? "")
		.toLowerCase()
		.split(":")[0];
	const { slug } = await resolveArchiveHost(host);
	if (!slug) return noCode();
	const newsletter = await getArchiveNewsletter(slug);
	const ownDomain = newsletter && getOwnDomain(newsletter, { sharedDomain: getSharedDomain(), appHost: getAppHost() });
	if (!newsletter?.customCode || !ownDomain || ownDomain !== hostname) return noCode();
	return Response.json({ code: newsletter.customCode }, { headers: { "Cache-Control": "private, max-age=60" } });
}
