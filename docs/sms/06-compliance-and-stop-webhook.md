# Step 6: Telecom Compliance and STOP Webhook

Telecom marketing is governed by strict legal frameworks (TCPA in the United States, GDPR in Europe, and carrier-level CTIA guidelines). This guide outlines how MailCheap guarantees compliance and handles automated opt-outs.

---

## 1. Compliance Requirements

### A. Independent Opt-In (GDPR & TCPA)
- An email subscription checkbox **cannot** bundle SMS consent.
- Subscriber forms must feature an independent, unticked checkbox:
  `[ ] I agree to receive SMS updates from [Newsletter Name]. Msg & data rates may apply.`
- When capturing phone numbers, the subscriber's IP address, timestamp, and referral host are recorded in `Contact.smsConsent`.

### B. Mandatory Opt-Out Instructions
Every promotional SMS must contain an unsubscribe mention, such as:
- English: `Reply STOP to opt out`
- French: `STOP au XXXXX`

### C. Quiet Hours
Sending commercial text messages during night hours (typically 9:00 PM to 8:00 AM in the recipient's local time zone) is legally prohibited under US TCPA rules and European regulations. Timezone metadata derived from phone country prefixes is used to schedule or hold deliveries until daytime windows.

---

## 2. Automated Opt-Out Webhook (`app/api/sms/webhook/route.js`)

When a recipient replies with standard opt-out keywords (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `QUIT`, `ARRET`), carriers report the event to an AWS SNS Topic. MailCheap processes these inbound webhook notifications to update records immediately.

```javascript
// app/api/sms/webhook/route.js
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

export async function POST(request) {
	const body = await request.json();

	// AWS SNS subscription confirmation handshake
	if (body.Type === "SubscriptionConfirmation" && body.SubscribeURL) {
		await fetch(body.SubscribeURL);
		return NextResponse.json({ confirmed: true });
	}

	// Inbound message notification
	if (body.Type === "Notification") {
		const message = typeof body.Message === "string" ? JSON.parse(body.Message) : body.Message;
		const { originationPhoneNumber: phone, messageBody } = message;

		if (!phone) return NextResponse.json({ ok: true });

		const keyword = (messageBody || "").trim().toUpperCase();
		const isStopKeyword = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ARRET"].includes(keyword);

		if (isStopKeyword) {
			await connectDb();

			// 1. Mark all contacts associated with this phone as unsubscribed
			const contacts = await Contact.find({ phone, smsStatus: "active" });

			for (const contact of contacts) {
				await Contact.updateOne(
					{ _id: contact._id },
					{
						$set: {
							smsStatus: "unsubscribed",
							smsUnsubscribedAt: new Date(),
						},
					}
				);

				// 2. Add to the suppression list to guard against future re-imports
				await Suppression.updateOne(
					{ newsletterId: contact.newsletterId, phone, targetType: "phone" },
					{
						$setOnInsert: {
							newsletterId: contact.newsletterId,
							phone,
							targetType: "phone",
							reason: "stop",
							at: new Date(),
						},
					},
					{ upsert: true }
				);
			}
		}
	}

	return NextResponse.json({ received: true });
}
```

---

## 3. Suppression List Enforcement

During campaign dispatch, any contact whose phone number matches an entry in `Suppression` where `targetType === "phone"` is filtered out before calling AWS SNS, preventing unintended carrier spam penalties.
