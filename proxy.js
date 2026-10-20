import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import { getArchiveHostUrl } from "@/lib/archive-hosts";
import { isCloud } from "@/lib/config";
import { resolveArchiveHost } from "@/lib/host-routing";
import { siteExtensions } from "@/lib/site-extensions";

// No route can live under an underscore folder, so this always renders the not-found page with a 404.
const NOT_FOUND_PATH = "/_not-on-this-server";
// Vercel BotID's script and its calls (lib/bot-check.js), which next.config rewrites to Vercel. They pass on every host and
// without a session, or every form it checks would look sent by a bot.
const BOTID_PATH_PREFIX = "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/";

// Reachable without a session: recipients, mail providers, AWS, Stripe, QStash, Vercel Cron, API-key
// and OAuth clients (REST and MCP, OAuth discovery), the docs, the help center, their search index and
// uptime checks. The consent page checks the session itself, so a signed-out visitor goes to sign-in with
// the app's request.
const PUBLIC_PATHS = [
	/^\/api\/health$/,
	/^\/favicon\.ico$/,
	/^\/(robots\.txt|sitemap\.xml|site\.webmanifest)$/,
	/^\/opengraph-image(-\w+)?$/,
	/^\/signin$/,
	/^\/oauth\/consent$/,
	/^\/\.well-known\/(oauth-protected-resource(\/mcp)?|oauth-authorization-server|openid-configuration)$/,
	/^\/docs(\/.*)?$/,
	/^\/help(\/.*)?$/,
	/^\/search-index\.json$/,
	/^\/llms(-full)?\.txt$/,
	/^\/mcp$/,
	/^\/api\/mcp$/,
	/^\/api\/auth\//,
	/^\/unsubscribe$/,
	/^\/confirm$/,
	/^\/keep$/,
	/^\/o\//,
	/^\/c\//,
	/^\/p\//,
	/^\/archive\//,
	/^\/api\/unsubscribe$/,
	/^\/api\/views$/,
	/^\/embed\.js$/,
	/^\/embed\/[^/]+(\/done)?$/,
	/^\/api\/embed\/[^/]+$/,
	/^\/api\/v1\//,
	/^\/api\/webhooks\//,
	/^\/api\/jobs\//,
	/^\/api\/cron\//,
];

// A newsletter's host carries its archive and the links in its emails, never the dashboard, not even its login page.
const ARCHIVE_HOST_PATHS = [
	/^\/unsubscribe$/,
	/^\/api\/unsubscribe$/,
	/^\/api\/views$/,
	/^\/confirm$/,
	/^\/keep$/,
	/^\/o\//,
	/^\/c\//,
];
const ISSUE_PATH_PATTERN = /^\/p\/([a-z0-9][a-z0-9-]{0,119})\/?$/;
const AUTHOR_PATH_PATTERN = /^\/authors\/([a-z0-9][a-z0-9-]{0,59})\/?$/;
// Generated share images stay on the app domain, where social cards point: they're only PNGs.
const ARCHIVE_IMAGE_PATH_PATTERN = /^\/archive\/[^/]+\/og$/;

function rewriteTo(request, pathname) {
	const url = request.nextUrl.clone();
	url.pathname = pathname;
	return NextResponse.rewrite(url);
}

export async function proxy(request) {
	const { pathname } = request.nextUrl;
	if (pathname.startsWith(BOTID_PATH_PREFIX)) return NextResponse.next();

	const { isArchiveHost, slug: archiveSlug } = await resolveArchiveHost(request.headers.get("host"));
	if (isArchiveHost) {
		if (ARCHIVE_HOST_PATHS.some((pattern) => pattern.test(pathname))) return NextResponse.next();
		if (!archiveSlug) return new NextResponse("Not found", { status: 404 });
		if (pathname === "/") return rewriteTo(request, `/archive/${archiveSlug}`);
		if (pathname === "/sitemap.xml") return rewriteTo(request, `/archive/${archiveSlug}/sitemap`);
		if (pathname === "/robots.txt") return rewriteTo(request, `/archive/${archiveSlug}/robots`);
		const issueSlug = ISSUE_PATH_PATTERN.exec(pathname)?.[1];
		if (issueSlug) return rewriteTo(request, `/archive/${archiveSlug}/p/${issueSlug}`);
		const authorSlug = AUTHOR_PATH_PATTERN.exec(pathname)?.[1];
		if (authorSlug) return rewriteTo(request, `/archive/${archiveSlug}/authors/${authorSlug}`);
		return new NextResponse("Not found", { status: 404 });
	}

	// Issues carry HTML from the API and the editor. They're read on the newsletter's host, so that HTML never
	// shares the dashboard's origin. Without SHARED_DOMAIN (local dev) every archive stays under /archive, where
	// the sanitizer, the frame's sandbox and the CSP guard it.
	if (pathname.startsWith("/archive/") && process.env.NODE_ENV === "production" && !ARCHIVE_IMAGE_PATH_PATTERN.test(pathname)) {
		const archiveUrl = getArchiveHostUrl(pathname, request.nextUrl.search);
		if (archiveUrl) return NextResponse.redirect(archiveUrl, 308);
	}

	// Only whether a session cookie is there: pages, actions and routes check the session itself.
	const hasSession = Boolean(getSessionCookie(request));
	// MailCheap Cloud's marketing site (site extensions): its landing page shows at / to signed-out visitors, rendered
	// at landingPath, which never shows in the address bar. A self-hosted server has none of its pages.
	const { landingPath, publicPages, isPublicPath } = siteExtensions;
	if (isCloud()) {
		if (pathname === "/" && landingPath) return hasSession ? NextResponse.next() : rewriteTo(request, landingPath);
		if (pathname === landingPath) return NextResponse.redirect(new URL("/", request.url), 308);
		if (publicPages.includes(pathname) || isPublicPath(pathname)) return NextResponse.next();
	} else if (pathname === landingPath || (pathname !== "/" && publicPages.includes(pathname))) {
		return rewriteTo(request, NOT_FOUND_PATH);
	}
	if (PUBLIC_PATHS.some((pattern) => pattern.test(pathname))) return NextResponse.next();
	if (hasSession) return NextResponse.next();
	if (pathname === "/") return NextResponse.redirect(new URL("/signin", request.url));

	if (pathname.startsWith("/api/")) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const signin = new URL("/signin", request.url);
	signin.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
	return NextResponse.redirect(signin);
}

// favicon.ico goes through the proxy so archive domains answer 404 and browsers keep the newsletter's logo. Theme fonts
// (public/fonts) load on every host, archives included.
export const config = {
	matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|svg|jpg|webp|woff2)$).*)"],
};
