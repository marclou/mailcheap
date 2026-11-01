import { getAppUrl } from "@/lib/config";

// The dashboard and the newsletter setup, the admin, the APIs, apps' consent and tracked links. / stays open: on
// MailCheap Cloud, signed-out visitors get the landing page there. Sign-in stays open too: MailCheap Cloud's is
// indexed, and crawlers read a self-hosted server's noindex. Archive hosts get their own robots.txt (proxy.js).
const PRIVATE_PATHS = [
	"/account",
	"/admin",
	"/api/",
	"/api-keys",
	"/billing",
	"/campaigns",
	"/contacts",
	"/domains",
	"/mcp",
	"/newsletters",
	"/oauth/",
	"/restore",
	"/welcome",
	"/c/",
	"/o/",
];

export default function robots() {
	return {
		rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
		sitemap: `${getAppUrl()}/sitemap.xml`,
	};
}
