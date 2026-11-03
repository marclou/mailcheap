import { connectDb } from "@/lib/db";
import { countPageView } from "@/lib/page-views";
import { WEB_FILTER } from "@/lib/publish-to";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|axios|go-http/i;
const MAX_BODY_LENGTH = 1_000;
// A visitor's views, theirs of one page, and one page's: a script adds a few views a day to a page from an address, as
// the readers of a household or an office would, and no flood from many addresses outgrows the limit on the page.
const VIEWS_PER_VISITOR = { name: "views", limit: 30, window: "10 m" };
const VIEWS_PER_PAGE_VISITOR = { name: "page-views-visitor", limit: 3, window: "1 d" };
const VIEWS_PER_PAGE = { name: "page-views", limit: 10_000, window: "1 h" };

function noContent() {
	return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// Archive pages send one beacon per issue per browser and day; this only counts the ones from people, in the issue's
// total and in the hour they come in, for its report's chart. Only an issue on the website can be counted, whatever
// its account. The answer is the same whatever happened.
export async function POST(request) {
	const userAgent = request.headers.get("user-agent") ?? "";
	if (!userAgent || BOT_PATTERN.test(userAgent)) return noContent();
	if (!request.headers.get("content-type")?.startsWith("application/json")) return noContent();
	const text = await request.text();
	if (text.length > MAX_BODY_LENGTH) return noContent();
	const id = readId(text);
	if (!isObjectIdString(id)) return noContent();
	const ip = getClientIp(request.headers);
	if (await isRateLimited({ ...VIEWS_PER_VISITOR, key: ip })) return noContent();
	if (await isRateLimited({ ...VIEWS_PER_PAGE_VISITOR, key: `${ip}:${id}` })) return noContent();
	if (await isRateLimited({ ...VIEWS_PER_PAGE, key: id })) return noContent();

	await connectDb();
	const campaign = await Campaign.findOneAndUpdate(
		{ _id: id, archiveSlug: { $type: "string" }, ...WEB_FILTER },
		{ $inc: { webViews: 1 } },
		{ projection: { accountId: 1 } }
	)
		.setOptions({ crossAccount: true })
		.lean();
	if (campaign) await countPageView(campaign);
	return noContent();
}

function readId(text) {
	try {
		return JSON.parse(text)?.id;
	} catch {
		return null;
	}
}
