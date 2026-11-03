import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NEWSLETTER_COOKIE } from "@/lib/newsletters";
import { saveSelectedNewsletter } from "@/lib/selected-newsletter";
import { toSafeNextPath } from "@/lib/validation";

// Opens one of the account's newsletters: its settings, or the page in ?next=. A campaign of another newsletter
// comes through here first, so the menu and the page show the same newsletter. Only a page load switches: in
// production Next.js prefetches a link as soon as it's on screen, like an import's notification in the bell or each
// newsletter's Edit sender on the Domains page, and switching then would move every tab to that newsletter. Its
// prefetches, and its in-app navigations to another newsletter, get nothing back, which makes it load the page: the
// menu and the rest of the dashboard then show the newsletter it switched to, not only the page.
export async function GET(request, { params }) {
	const { id } = await params;
	const isRouterFetch = request.headers.has("rsc");
	if (isPrefetch(request) || (isRouterFetch && (await cookies()).get(NEWSLETTER_COOKIE)?.value !== id)) {
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	}
	if (!(await saveSelectedNewsletter(id))) notFound();
	const next = new URL(request.url).searchParams.get("next");
	redirect(next ? toSafeNextPath(next) : "/newsletters");
}

// Next.js marks its prefetches; browsers mark theirs with Sec-Purpose, or Purpose in older ones.
function isPrefetch(request) {
	const { headers } = request;
	return headers.has("next-router-prefetch") || /prefetch/i.test(`${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`);
}
