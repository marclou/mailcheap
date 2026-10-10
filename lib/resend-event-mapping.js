import {
	BEFORE_BOUNCE,
	BEFORE_COMPLAINT,
	BEFORE_DELIVERY,
	engagementOf,
	isUnsubscribeLink,
	readTag,
	toDate,
} from "./ses-event-mapping.js";
import { isPlainObject, normalizeAddress } from "./validation.js";

// Resend webhook events in the same plan shape as SES events (lib/ses-event-mapping.js), so one handler
// applies both. Types reuse SES's names: lib/email-events.js stores Bounce, Complaint, Reject and
// DeliveryDelay events.
const TYPES = new Map([
	["email.sent", "Send"],
	["email.delivered", "Delivery"],
	["email.delivery_delayed", "DeliveryDelay"],
	["email.bounced", "Bounce"],
	["email.complained", "Complaint"],
	["email.opened", "Open"],
	["email.clicked", "Click"],
	["email.failed", "Reject"],
	["email.suppressed", "Reject"],
]);

const SUPPRESS_BOUNCED = { reason: "bounce", contactStatus: "bounced", contactStatusFrom: ["active", "dormant", "unsubscribed"] };

// Pure: turns one Resend webhook body into the updates handleResendEvent applies.
export function getResendEventPlan(event) {
	const type = TYPES.get(event?.type);
	if (!type) return null;

	const data = isPlainObject(event.data) ? event.data : {};
	const email = normalizeAddress(Array.isArray(data.to) ? data.to[0] : data.to);
	const plan = {
		type,
		providerMessageId: typeof data.email_id === "string" && data.email_id ? data.email_id : null,
		messageId: readTag(data.tags, "message_id"),
		email,
		occurredAt: toDate(event.created_at) ?? toDate(data.created_at) ?? new Date(),
		firsts: [],
		status: null,
		error: null,
		engagement: null,
		suppression: null,
		data: event,
	};

	if (type === "Delivery") {
		plan.firsts = [{ field: "deliveredAt", stat: "delivered" }];
		plan.status = { to: "delivered", from: BEFORE_DELIVERY };
	}

	if (type === "Bounce") {
		const bounce = isPlainObject(data.bounce) ? data.bounce : {};
		const isHard = bounce.type === "Permanent";
		plan.error = `${isHard ? "Hard" : "Soft"} bounce: ${[bounce.subType, bounce.message].filter(Boolean).join(", ") || "unknown"}`;
		if (isHard) {
			plan.firsts = [{ field: "bouncedAt", stat: "bounced" }];
			plan.status = { to: "bounced", from: BEFORE_BOUNCE };
			plan.suppression = {
				...SUPPRESS_BOUNCED,
				emails: email ? [email] : [],
				detail: `${bounce.type}/${bounce.subType ?? "General"}`,
			};
		}
	}

	if (type === "Complaint") {
		plan.firsts = [{ field: "complainedAt", stat: "complained" }];
		plan.status = { to: "complained", from: BEFORE_COMPLAINT };
		plan.suppression = {
			emails: email ? [email] : [],
			reason: "complaint",
			detail: "abuse",
			contactStatus: "complained",
			contactStatusFrom: ["active", "dormant", "unsubscribed", "bounced"],
		};
	}

	// Mailcheap tracks opens and clicks itself. If Resend's tracking is on too, the first one still
	// counts once: each counter only moves on its first timestamp.
	const link = isPlainObject(data.click) ? data.click.link : null;
	if (type === "Open" || (type === "Click" && !isUnsubscribeLink(link))) {
		Object.assign(plan, engagementOf(type, plan.occurredAt));
	}

	if (event.type === "email.failed") {
		const reason = isPlainObject(data.failed) ? data.failed.reason : null;
		plan.status = { to: "failed", from: ["queued", "sent"], stat: "failed" };
		plan.error = `Failed at Resend: ${reason ?? "unknown"}`;
	}

	// Resend refused the address because it's on its own suppression list: an earlier hard bounce or
	// complaint at Resend. Mailcheap stops sending to it too.
	if (event.type === "email.suppressed") {
		const suppressed = isPlainObject(data.suppressed) ? data.suppressed : {};
		plan.status = { to: "failed", from: ["queued", "sent"], stat: "failed" };
		plan.error = `Suppressed by Resend: ${suppressed.message ?? suppressed.type ?? "unknown"}`;
		plan.suppression = { ...SUPPRESS_BOUNCED, emails: email ? [email] : [], detail: `Resend/${suppressed.type ?? "Suppressed"}` };
	}

	return plan;
}
