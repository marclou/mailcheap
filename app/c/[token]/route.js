import { after } from "next/server";
import { escapeHtml } from "@/lib/render-email";
import { recordEngagement } from "@/lib/email-events";
import { readClickToken } from "@/lib/tracking";

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

export async function GET(request, { params }) {
	const link = readClickToken((await params).token);
	if (!link) return new Response("Not found", { status: 404 });
	if (!link.isSigned) return continuePage(link.url);

	const userAgent = request.headers.get("user-agent") ?? "";
	after(() =>
		recordEngagement({ messageId: link.messageId, type: "Click", userAgent }).catch((error) =>
			console.error("[tracking] Click not recorded:", error)
		)
	);
	return redirectTo(link.url);
}

// Link checkers often send HEAD first: same answer, never counted as a click.
export async function HEAD(_request, { params }) {
	const link = readClickToken((await params).token);
	if (!link) return new Response(null, { status: 404 });
	return link.isSigned ? redirectTo(link.url) : new Response(null, { status: 200 });
}
