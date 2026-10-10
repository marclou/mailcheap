import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { campaignIncrements } from "@/lib/rows";
import { campaigns, contacts, messages } from "@/lib/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

const NO_STORE = { "Cache-Control": "no-store" };
// Bounced and complained contacts stay as they are: those statuses also block sending.
const SUBSCRIBED_STATUSES = ["active", "dormant"];
const RECENT_CAMPAIGNS = 5;
// Gmail and Yahoo send one-click requests from shared mail servers, so keep this generous.
const RATE_LIMIT = { name: "unsubscribe", limit: 60, window: "1 m" };

// Links don't carry the campaign, so the unsubscribe counts for the latest campaign sent to them.
async function creditLatestCampaign({ contactId, newsletterId }) {
	const db = getDb();
	const recent = await db
		.select({ _id: campaigns._id })
		.from(campaigns)
		.where(and(eq(campaigns.newsletterId, newsletterId), isNotNull(campaigns.startedAt)))
		.orderBy(desc(campaigns.startedAt))
		.limit(RECENT_CAMPAIGNS);
	for (const { _id } of recent) {
		const sent = await db
			.select({ _id: messages._id })
			.from(messages)
			.where(
				and(
					eq(messages.kind, "campaign"),
					eq(messages.campaignId, _id),
					eq(messages.contactId, contactId),
					isNotNull(messages.sentAt)
				)
			)
			.limit(1);
		if (sent.length === 0) continue;
		await db.update(campaigns).set(campaignIncrements({ "stats.unsubscribed": 1 })).where(eq(campaigns._id, _id));
		return;
	}
}

async function unsubscribe({ contactId, newsletterId }) {
	const [previous] = await getDb()
		.update(contacts)
		.set({ status: "unsubscribed", unsubscribedAt: new Date() })
		.where(
			and(eq(contacts._id, contactId), eq(contacts.newsletterId, newsletterId), inArray(contacts.status, SUBSCRIBED_STATUSES))
		)
		.returning({ _id: contacts._id });
	if (!previous) return;

	console.log(`[unsubscribe] Contact ${contactId} unsubscribed from newsletter ${newsletterId}`);
	await creditLatestCampaign({ contactId, newsletterId }).catch((error) =>
		console.error("[unsubscribe] Could not credit the campaign:", error.message)
	);
}

function redirectToPage(request, params) {
	const url = new URL("/unsubscribe", request.url);
	for (const [key, value] of Object.entries(params)) {
		if (value) url.searchParams.set(key, value);
	}
	const response = NextResponse.redirect(url, 303);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

// Some mail apps open the List-Unsubscribe URL in a browser: never change anything on GET.
export function GET(request) {
	return redirectToPage(request, { token: new URL(request.url).searchParams.get("token") });
}

// RFC 8058 one-click endpoint. The confirmation page form posts here too, with source=page.
export async function POST(request) {
	const token = new URL(request.url).searchParams.get("token");
	const form = await request.formData().catch(() => null);
	const isPageForm = form?.get("source") === "page";

	function respond(status, pageStatus) {
		if (!isPageForm) return new NextResponse(null, { status, headers: NO_STORE });
		return redirectToPage(request, {
			token: pageStatus === "invalid" ? null : token,
			status: pageStatus,
		});
	}

	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) return respond(429, "error");

	const reference = verifyUnsubscribeToken(token);
	if (!reference) return respond(400, "invalid");

	try {
		await unsubscribe(reference);
		return respond(200, "done");
	} catch (error) {
		console.error("[unsubscribe] Failed:", error);
		return respond(500, "error");
	}
}
