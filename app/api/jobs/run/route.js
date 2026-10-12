import { NextResponse } from "next/server";
import { isLocalQueue, isValidRunnerAuth } from "@/lib/job-rules";
import { runDueJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Called every few seconds by the server's own job ticker (JOB_QUEUE=local), with a token derived
// from SESSION_SECRET. Runs the due jobs for up to 50 seconds.
export async function POST(request) {
	if (!isLocalQueue()) return NextResponse.json({ error: "Not found" }, { status: 404 });
	if (!isValidRunnerAuth(request.headers.get("authorization"))) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const summary = await runDueJobs({ budgetMs: 50_000 });
	if (summary.done || summary.retried || summary.failed) console.info(`[jobs] ${JSON.stringify(summary)}`);
	return NextResponse.json(summary);
}
