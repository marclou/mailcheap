import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { PUBLISHED_STATUSES } from "@/lib/archive-data";
import { getDb } from "@/lib/db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { campaigns } from "@/lib/schema";
import { isIdString } from "@/lib/validation";

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|axios|go-http/i;
const RATE_LIMIT = { name: "views", limit: 30, window: "10 m" };

function noContent() {
	return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// Archive pages send one beacon per issue per browser and day; this only counts the ones from people.
export async function POST(request) {
	const userAgent = request.headers.get("user-agent") ?? "";
	const { id } = await request.json().catch(() => ({}));
	if (!isIdString(id) || !userAgent || BOT_PATTERN.test(userAgent)) return noContent();
	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) return noContent();

	await getDb()
		.update(campaigns)
		.set({ webViews: sql`${campaigns.webViews} + 1` })
		.where(and(eq(campaigns._id, id), isNotNull(campaigns.archiveSlug), inArray(campaigns.status, PUBLISHED_STATUSES)));
	return noContent();
}
