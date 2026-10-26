import "server-only";
import { formatE164 } from "@/lib/sms-utils";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ARRET"];

export function isStopKeyword(text = "") {
	const normalized = String(text ?? "").trim().toUpperCase();
	return STOP_KEYWORDS.includes(normalized);
}

// Unsubscribes a phone number across newsletters and records it in the suppression list.
export async function handleSmsOptOut({ phone, reason = "stop" }) {
	const parsed = formatE164(phone);
	const targetPhone = parsed ? parsed.e164 : phone?.trim();
	if (!targetPhone) return { updated: 0 };

	const contacts = await Contact.find({ phone: targetPhone, smsStatus: "active" }).select({ _id: 1, accountId: 1 }).lean();
	const now = new Date();

	for (const contact of contacts) {
		await Contact.updateOne(
			{ _id: contact._id },
			{
				$set: {
					smsStatus: "unsubscribed",
					smsUnsubscribedAt: now,
				},
			}
		);

		await Suppression.updateOne(
			{ accountId: contact.accountId, phone: targetPhone, targetType: "phone" },
			{
				$setOnInsert: {
					accountId: contact.accountId,
					phone: targetPhone,
					targetType: "phone",
					reason,
					at: now,
				},
			},
			{ upsert: true }
		);
	}

	return { updated: contacts.length, targetPhone };
}

// Processes an incoming AWS SNS event for SMS (inbound two-way reply or delivery report).
export async function handleSmsEvent(event) {
	if (!event || typeof event !== "object") return { handled: false };

	// 1. Two-way SMS inbound message (subscriber replied to a message)
	const inboundPhone = event.originationPhoneNumber || event.sourcePhoneNumber;
	const messageBody = event.messageBody;

	if (inboundPhone && messageBody) {
		if (isStopKeyword(messageBody)) {
			await handleSmsOptOut({ phone: inboundPhone, reason: "stop" });
			return { handled: true, action: "opt-out", phone: inboundPhone };
		}
		return { handled: true, action: "inbound-reply", phone: inboundPhone };
	}

	// 2. Delivery status receipt (carrier failure / bounce)
	const deliveryStatus = event.status || event.delivery?.status;
	const destinationPhone = event.destinationPhoneNumber || event.delivery?.destination;

	if (destinationPhone && ["FAILED", "REJECTED", "UNDELIVERED"].includes(String(deliveryStatus).toUpperCase())) {
		await handleSmsOptOut({ phone: destinationPhone, reason: "bounce" });
		return { handled: true, action: "bounce", phone: destinationPhone };
	}

	return { handled: false };
}
