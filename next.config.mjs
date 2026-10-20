import { existsSync } from "node:fs";
import { withBotId } from "botid/next/config";

// No script-src: Next.js's inline scripts would need per-request nonces, which archive pages can't have
// while they're cached (ISR). script-src-attr still blocks inline event handlers everywhere.
const CONTENT_SECURITY_POLICY = [
	"frame-ancestors 'none'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"script-src-attr 'none'",
].join("; ");

// Uploads served from the S3 bucket's CDN, read at build time like the rest of this file.
const IMAGES_CDN_URL = process.env.IMAGES_CDN_URL;
const IMAGES_CDN_HOST = IMAGES_CDN_URL && URL.canParse(IMAGES_CDN_URL) ? new URL(IMAGES_CDN_URL).hostname : null;

const SECURITY_HEADERS = [
	{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
	{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	// The origin only, MailCheap's own pages included: a URL like a contacts search can hold a subscriber's email,
	// and the page it leads to can send its referrer to analytics.
	{ key: "Referrer-Policy", value: "strict-origin" },
];

// The signup form for other sites (app/embed) is made to be framed by them: the same headers, any site as its frame's
// parent, and no X-Frame-Options.
const EMBED_HEADERS = [
	{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY.replace("frame-ancestors 'none'", "frame-ancestors *") },
	...SECURITY_HEADERS.filter(({ key }) => key !== "Content-Security-Policy" && key !== "X-Frame-Options"),
];

// MailCheap Cloud's marketing site extends the shared pages through these two modules. Where its files exist they
// take the defaults' place; the open source has none of them (tests/setup/hooks.mjs resolves the same way).
const SITE_EXTENSIONS = Object.entries({
	"@/lib/site-extensions": "./lib/marketing/site-extensions.js",
	"@/components/SiteExtensions": "./components/marketing/SiteExtensions.jsx",
}).filter(([, target]) => existsSync(new URL(target, import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
	poweredByHeader: false,
	turbopack: { resolveAlias: Object.fromEntries(SITE_EXTENSIONS) },
	// Read from disk by its route, so the build can't see it's needed.
	outputFileTracingIncludes: { "/embed/botid": ["./node_modules/botid/dist/client/core/index.mjs"] },
	images: {
		remotePatterns: [
			{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
			...(IMAGES_CDN_HOST ? [{ protocol: "https", hostname: IMAGES_CDN_HOST }] : []),
		],
	},
	async headers() {
		return [
			{ source: "/:path((?!embed/).*)", headers: SECURITY_HEADERS },
			{ source: "/embed/:path*", headers: EMBED_HEADERS },
			{
				source: "/embed.js",
				headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
			},
			// Theme fonts load in emails and on newsletters' own hosts: browsers only take a font from another origin
			// with CORS.
			{
				source: "/fonts/:path*",
				headers: [
					{ key: "Access-Control-Allow-Origin", value: "*" },
					{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" },
				],
			},
		];
	},
};

// Vercel BotID's script and its calls go through MailCheap's own paths, rewritten to Vercel, with frame headers of their own
// after the ones above (lib/bot-check.js). Only on Vercel, where its check runs.
export default process.env.VERCEL ? withBotId(nextConfig) : nextConfig;
