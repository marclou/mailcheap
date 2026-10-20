import { scoped } from "@/lib/account-scope";
import { ERROR_CODES, hasActiveSubscription } from "@/lib/account-state";
import { contactSearchFilter } from "@/lib/contacts";
import { getCsvHeader, toCsvRow } from "@/lib/contacts-csv";
import { connectDb } from "@/lib/db";
import { verifyExportToken } from "@/lib/export-token";
import { findSegmentListFilter } from "@/lib/segment-queries";
import Account from "@/models/Account";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const ROWS_PER_CHUNK = 500;

function fail(status, code, message) {
	return Response.json({ error: { code, message } }, { status });
}

// The file behind an export_contacts link: the signed token names the account and the filters.
export async function GET(request) {
	const link = verifyExportToken(new URL(request.url).searchParams.get("token"));
	if (!link) return fail(401, "unauthorized", "This download link is invalid or expired: export again");

	await connectDb();
	const account = await Account.findById(link.accountId).lean();
	if (!hasActiveSubscription(account)) return fail(402, ERROR_CODES.subscriptionRequired, "The account has no active plan");
	const newsletters = new Map(
		(await Newsletter.find(scoped(account)).select({ slug: 1 }).lean()).map(({ _id, slug }) => [String(_id), slug])
	);
	const segmentFilter = link.segmentId ? await findSegmentListFilter(account, link.segmentId) : null;
	if (link.segmentId && !segmentFilter) return fail(404, "not_found", "The segment was deleted: export again");
	const filter = {
		...segmentFilter,
		...contactSearchFilter(account, { newsletterId: link.newsletterId, query: link.query, tag: link.tag }),
		...(link.status && { status: link.status }),
	};
	const cursor = Contact.find(filter).sort({ subscribedAt: -1, _id: -1 }).lean().cursor();
	const encoder = new TextEncoder();
	let isStarted = false;

	const stream = new ReadableStream({
		async pull(controller) {
			let chunk = isStarted ? "" : getCsvHeader(account.contactFields);
			isStarted = true;
			for (let count = 0; count < ROWS_PER_CHUNK; count += 1) {
				const contact = await cursor.next();
				if (!contact) {
					if (chunk) controller.enqueue(encoder.encode(chunk));
					controller.close();
					await cursor.close();
					return;
				}
				chunk += toCsvRow(contact, newsletters, account.contactFields);
			}
			controller.enqueue(encoder.encode(chunk));
		},
		cancel: () => cursor.close(),
	});
	const date = new Date().toISOString().slice(0, 10);
	return new Response(stream, {
		headers: {
			"content-type": "text/csv; charset=utf-8",
			"content-disposition": `attachment; filename="contacts-${date}.csv"`,
			"cache-control": "no-store",
		},
	});
}
