import { NextResponse } from "next/server";
import { isSendingEnabled } from "@/lib/config";
import { withQStashSignature } from "@/lib/qstash-route";
import { publishBatchRetry, sendMessageBatch } from "@/lib/sending";
import { MAX_BATCH_MESSAGES } from "@/lib/sending-rules";
import { isObjectIdString } from "@/lib/validation";
import { scheduleBounceRead } from "@/lib/workspace-bounces";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleBatch(request) {
	if (!isSendingEnabled()) return NextResponse.json({ error: "Sending is off" }, { status: 409 });

	const body = await request.json().catch(() => null);
	const messageIds = body?.messageIds;
	const isValid =
		isObjectIdString(body?.accountId) &&
		Array.isArray(messageIds) &&
		messageIds.length > 0 &&
		messageIds.length <= MAX_BATCH_MESSAGES &&
		messageIds.every(isObjectIdString);
	if (!isValid) {
		return NextResponse.json(
			{ error: `Send an accountId and 1 to ${MAX_BATCH_MESSAGES} message ids` },
			{ status: 400 }
		);
	}

	const result = await sendMessageBatch({ accountId: body.accountId, messageIds });
	if (result.sent > 0) await scheduleBounceRead();
	// A provider that says when it has room again (a cluster's hourly cap) gets the batch back then, past
	// QStash's own few retries. Otherwise QStash retries non-2xx responses, which is what a throttled batch needs.
	if (result.retry && result.retryAfter) {
		const isRepublished = await publishBatchRetry({ accountId: body.accountId, messageIds }, result.retryAfter).then(
			() => true,
			(error) => console.error(`[send-batch] Could not republish the batch: ${error.message}`)
		);
		if (isRepublished) return NextResponse.json({ ...result, republished: true });
	}
	return NextResponse.json(result, { status: result.retry ? 503 : 200 });
}

export const POST = withQStashSignature(handleBatch);
