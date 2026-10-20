import { connectDb } from "@/lib/db";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";
import { renderDonePage, renderNoticePage } from "@/lib/signup-form-page";
import { readDoneToken } from "@/lib/signup-form-token";
import { isObjectIdString } from "@/lib/validation";

const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };

// Where the plain HTML signup form lands (app/api/embed/[id]/route.js): confirm, you're in, or what went wrong.
export async function GET(request, { params }) {
	const { id } = await params;
	if (!isObjectIdString(id)) return notFound();
	await connectDb();
	const newsletter = await findNewsletterAnywhere({ _id: id });
	if (!newsletter) return notFound();
	const done = readDoneToken(new URL(request.url).searchParams.get("s"));
	return new Response(renderDonePage({ newsletter, done }), { headers: HEADERS });
}

function notFound() {
	return new Response(renderNoticePage("This signup form doesn't exist."), { status: 404, headers: HEADERS });
}
