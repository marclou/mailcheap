import { and, eq } from "drizzle-orm";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getDb } from "@/lib/db";
import { findNewsletter } from "@/lib/records";
import { campaigns, newsletters } from "@/lib/schema";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Archive domains rewrite /p/slug in proxy.js; on the app's domain the link doesn't name the newsletter.
export async function GET(request, { params }) {
	const { slug } = await params;
	if (!SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404 });

	const [campaign] = await getDb()
		.select({ newsletterId: campaigns.newsletterId })
		.from(campaigns)
		.where(eq(campaigns.archiveSlug, slug));
	const newsletter =
		campaign &&
		(await findNewsletter(
			and(eq(newsletters._id, campaign.newsletterId), eq(newsletters.archiveEnabled, true)),
			["slug"]
		));
	if (!newsletter) return new Response("Not found", { status: 404 });

	return Response.redirect(new URL(getArchiveUrls(newsletter).post(slug), request.url), 307);
}
