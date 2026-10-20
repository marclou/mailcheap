import { after } from "next/server";
import { isBlocked } from "@/lib/account-state";
import { findTrackedMessage, recordEngagement } from "@/lib/email-events";
import { escapeHtml } from "@/lib/render-email";
import { readClickToken } from "@/lib/tracking";

// A blocked account's links stop lending this domain to its emails: no redirect, no destination. Nothing keeps the
// answer, in browsers or at the CDN, so unblocking the account brings its links back on the next click.
const DISABLED = {
	status: 403,
	headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
};

// The public site's look, with its fonts' fallbacks: a route's own HTML doesn't get the site's fonts.
const DISABLED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>This link is disabled</title><style>
:root{--site:#fafafa;--ink:#0a0a0a;--muted:#737373;--dot:rgb(10 10 10/14%);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--site:#0d0d0d;--ink:#fafafa;--muted:#a1a1a1;--dot:rgb(250 250 250/14%)}}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:0 20px;box-sizing:border-box;background:var(--site);color:var(--ink);font-family:Geist,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(circle at 1px 1px,var(--dot) 1px,transparent 0) 0 0/22px 22px;-webkit-mask-image:radial-gradient(ellipse 50% 40% at 50% 45%,#000 20%,transparent 70%);mask-image:radial-gradient(ellipse 50% 40% at 50% 45%,#000 20%,transparent 70%)}
main{max-width:24rem;padding-bottom:8vh;text-align:center}
h1{margin:0;font:480 2rem/1.05 Newsreader,"Iowan Old Style",Georgia,serif;letter-spacing:-0.03em;text-wrap:balance}
p{margin:12px 0 0;font-size:15px;line-height:24px;color:var(--muted);text-wrap:pretty}
@media (min-width:640px){h1{font-size:2.5rem}}
</style></head><body><main><h1>This link is disabled</h1><p>The sender's account is suspended.</p></main></body></html>`;

function redirectTo(url) {
	return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

// An unsigned link still reaches its page, but only through a click: redirecting automatically
// would let anyone send visitors anywhere through this domain.
function continuePage(url) {
	const href = escapeHtml(url);
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Continue</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#27272a;"><main style="max-width:32rem;margin:20vh auto;padding:0 20px;"><p>This link goes to:</p><p><a href="${href}" rel="noopener noreferrer nofollow" style="color:#18181b;word-break:break-all;">${href}</a></p></main></body></html>`;
	return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// A link whose message or account is gone redirects as it did before blocks were checked, and so does one whose
// lookup fails: the check never takes working links down.
async function findLinkMessage(messageId) {
	try {
		return await findTrackedMessage(messageId);
	} catch (error) {
		console.error("[tracking] Link not checked:", error);
		return null;
	}
}

export async function GET(request, { params }) {
	const link = readClickToken((await params).token);
	if (!link) return new Response("Not found", { status: 404 });
	if (!link.isSigned) return continuePage(link.url);

	const message = await findLinkMessage(link.messageId);
	if (isBlocked(message?.account)) return new Response(DISABLED_PAGE, DISABLED);

	const userAgent = request.headers.get("user-agent") ?? "";
	after(() =>
		recordEngagement({ message, type: "Click", userAgent, url: link.url }).catch((error) =>
			console.error("[tracking] Click not recorded:", error)
		)
	);
	return redirectTo(link.url);
}

// Link checkers often send HEAD first: same answer, never counted as a click.
export async function HEAD(_request, { params }) {
	const link = readClickToken((await params).token);
	if (!link) return new Response(null, { status: 404 });
	if (!link.isSigned) return new Response(null, { status: 200 });
	const message = await findLinkMessage(link.messageId);
	return isBlocked(message?.account) ? new Response(null, DISABLED) : redirectTo(link.url);
}
