# Step 4: Dispatch Pipeline, AWS SNS Client, and Queue Workers

This guide explains how MailCheap queues and sends SMS campaigns via Upstash QStash and Amazon SNS, with rate limiting, segment calculations, and carrier throughput controls.

---

## 1. AWS SNS Client Wrapper (`lib/sns.js`)

Mirroring `lib/ses.js`, all direct calls to AWS SNS are contained in `lib/sns.js`. This isolates outside network I/O and enables tests to stub the client cleanly (`tests/stubs/sns.mjs`).

```javascript
// lib/sns.js
import "server-only";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { getSmsCredentials, getSmsDefaultSenderId, getSmsRegion } from "@/lib/config";

const READ_TIMEOUT_MS = 5000;
let client;

function getClient() {
	const credentials = getSmsCredentials();
	if (!credentials) throw new Error("AWS SNS is not configured (missing credentials)");
	client ??= new SNSClient({
		region: getSmsRegion(),
		credentials,
	});
	return client;
}

// Dispatches a single SMS message via AWS SNS
export async function publishSms({ phoneNumber, message, senderId, messageType = "Promotional" }) {
	const targetSenderId = senderId || getSmsDefaultSenderId();
	const attributes = {
		"AWS.SNS.SMS.SMSType": {
			DataType: "String",
			StringValue: messageType,
		},
	};

	if (targetSenderId) {
		attributes["AWS.SNS.SMS.SenderID"] = {
			DataType: "String",
			StringValue: targetSenderId,
		};
	}

	const command = new PublishCommand({
		PhoneNumber: phoneNumber,
		Message: message,
		MessageAttributes: attributes,
	});

	const response = await getClient().send(command, {
		abortSignal: AbortSignal.timeout(READ_TIMEOUT_MS),
	});

	return { messageId: response.MessageId };
}
```

---

## 2. SMS Utilities and Segment Calculation (`lib/sms-utils.js`)

Telecommunication carriers bill SMS by **segments**. Character encoding dictates the segment boundary:

- **GSM-7**: Basic Latin characters, numbers, and standard punctuation.
  - 1 segment: up to 160 characters.
  - Multi-segment: 153 characters per segment (7 characters reserved for concatenation headers).
- **UCS-2 (UTF-16)**: Activated whenever a non-GSM character is included (e.g. certain accents, emojis).
  - 1 segment: up to 70 characters.
  - Multi-segment: 67 characters per segment.

```javascript
// lib/sms-utils.js
import { parsePhoneNumberWithError } from "libphonenumber-js";

// Basic GSM 03.38 7-bit character set
const GSM_7_REGEX = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~\]|€]*$/;

export function analyzeSmsContent(text = "") {
	const isGsm7 = GSM_7_REGEX.test(text);
	const length = text.length;

	if (isGsm7) {
		const segments = length <= 160 ? (length > 0 ? 1 : 0) : Math.ceil(length / 153);
		const maxInCurrent = segments <= 1 ? 160 : segments * 153;
		return {
			encoding: "GSM-7",
			length,
			segments,
			remainingInSegment: maxInCurrent - length,
			isUcs2: false,
		};
	}

	// UCS-2 encoding
	const segments = length <= 70 ? (length > 0 ? 1 : 0) : Math.ceil(length / 67);
	const maxInCurrent = segments <= 1 ? 70 : segments * 67;
	return {
		encoding: "UCS-2",
		length,
		segments,
		remainingInSegment: maxInCurrent - length,
		isUcs2: true,
	};
}

export function formatE164(rawPhone, defaultCountry = "US") {
	try {
		const parsed = parsePhoneNumberWithError(String(rawPhone).trim(), defaultCountry);
		if (!parsed.isValid()) return null;
		return {
			e164: parsed.number,
			country: parsed.country,
		};
	} catch {
		return null;
	}
}
```

---

## 3. Worker and Rate-Limiting (`lib/sms-send.js`)

Unlike email dispatchers that can submit hundreds of messages concurrently, telecom operators enforce strict throughput limits (typically 1 to 10 messages per second per sender).

### Batch Dispatch Loop
```javascript
// lib/sms-send.js
import "server-only";
import { scoped } from "@/lib/account-scope";
import { publishSms } from "@/lib/sns";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

const MESSAGES_PER_SECOND = 5;
const DELAY_BETWEEN_MESSAGES_MS = Math.floor(1000 / MESSAGES_PER_SECOND);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processSmsBatch({ account, campaignId, contactIds }) {
	const campaign = await Campaign.findOne(scoped(account, { _id: campaignId }));
	if (!campaign || campaign.status !== "sending") return;

	const recipients = await Contact.find(
		scoped(account, {
			_id: { $in: contactIds },
			smsStatus: "active",
			phone: { $exists: true, $ne: null },
		})
	);

	// Filter out suppressed numbers
	const suppressed = new Set(
		(await Suppression.find({ phone: { $in: recipients.map((r) => r.phone) } }).select({ phone: 1 })).map((s) => s.phone)
	);

	for (const recipient of recipients) {
		if (suppressed.has(recipient.phone)) continue;

		// Personalized body with merge tags
		const personalizedBody = campaign.smsText.replace(/\{\{\s*first_name\s*\}\}/gi, recipient.firstName || "");

		try {
			await publishSms({
				phoneNumber: recipient.phone,
				message: personalizedBody,
			});

			await Contact.updateOne({ _id: recipient._id }, { $set: { lastSmsSentAt: new Date() } });
		} catch (error) {
			console.error(`Failed to dispatch SMS to ${recipient.phone}:`, error.message);
		}

		await sleep(DELAY_BETWEEN_MESSAGES_MS);
	}
}
```

---

## 4. Upstash QStash Job (`app/api/jobs/sms-batch/route.js`)

Following MailCheap's existing background execution pattern, campaign dispatches are chopped into batches and delivered through QStash endpoints signed with `QSTASH_CURRENT_SIGNING_KEY`.

```javascript
// app/api/jobs/sms-batch/route.js
import { NextResponse } from "next/server";
import { processSmsBatch } from "@/lib/sms-send";
import { verifyQStashSignature } from "@/lib/qstash";

export async function POST(request) {
	const isValid = await verifyQStashSignature(request);
	if (!isValid) return new Response("Unauthorized", { status: 401 });

	const payload = await request.json();
	await processSmsBatch(payload);

	return NextResponse.json({ ok: true });
}
```
