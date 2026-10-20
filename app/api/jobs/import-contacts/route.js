import { NextResponse } from "next/server";
import { runImport } from "@/lib/import-jobs";
import { withQStashSignature } from "@/lib/qstash-route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Handled outcomes answer 200 so QStash doesn't retry them; a thrown error (database down, a chunk failing before its
// last try) is retried. The log has ids and counts, never a row.
async function handleImport(request) {
	const body = await request.json().catch(() => null);
	const job = { accountId: body?.accountId, importId: body?.importId, index: body?.index };
	const result = await runImport(job);
	const { next: _next, ...outcome } = result;
	console.info(`[import] ${JSON.stringify({ importId: job.importId, index: job.index, ...outcome })}`);
	return NextResponse.json(outcome);
}

export const POST = withQStashSignature(handleImport);
