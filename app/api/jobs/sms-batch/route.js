import { NextResponse } from "next/server";
import { isSendingEnabled } from "@/lib/config";
import { withQStashSignature } from "@/lib/qstash-route";
import { SMS_BATCH_SIZE, processSmsBatch } from "@/lib/sms-send";
import { isObjectIdString } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleSmsBatch(request) {
	if (!isSendingEnabled()) {
		return NextResponse.json({ error: "Sending is off" }, { status: 409 });
	}

	const body = await request.json().catch(() => null);
	const { accountId, campaignId, contactIds } = body ?? {};

	const isValid =
		isObjectIdString(accountId) &&
		isObjectIdString(campaignId) &&
		Array.isArray(contactIds) &&
		contactIds.length > 0 &&
		contactIds.length <= SMS_BATCH_SIZE &&
		contactIds.every(isObjectIdString);

	if (!isValid) {
		return NextResponse.json(
			{ error: `Send an accountId, campaignId, and up to ${SMS_BATCH_SIZE} contact IDs` },
			{ status: 400 }
		);
	}

	const result = await processSmsBatch({ accountId, campaignId, contactIds });
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleSmsBatch);
