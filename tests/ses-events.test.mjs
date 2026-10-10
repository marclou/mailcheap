import assert from "node:assert/strict";
import { test } from "node:test";
import { getSesEventPlan } from "../lib/ses-event-mapping.js";

const messageId = "64f1a2b3c4d5e6f7a8b9c0d1";
const mail = {
	timestamp: "2026-10-04T10:00:00.000Z",
	messageId: "0100019000000abc-11112222-3333-4444-5555-666677778888-000000",
	destination: ["Reader@Example.com"],
	headers: [{ name: "List-Unsubscribe", value: "<https://mail.example.com/api/unsubscribe>" }],
	tags: { message_id: [messageId], kind: ["campaign"], "ses:configuration-set": ["mailcheap"] },
};

function sesEvent(eventType, detail = {}, overrides = {}) {
	const detailKey = {
		Send: "send",
		Delivery: "delivery",
		Bounce: "bounce",
		Complaint: "complaint",
		Open: "open",
		Click: "click",
		Reject: "reject",
		DeliveryDelay: "deliveryDelay",
	}[eventType];
	return { eventType, mail, [detailKey]: detail, ...overrides };
}

const OPEN = { field: "openedAt", stat: "opened", contactStat: "opens" };
const CLICK = { field: "clickedAt", stat: "clicked", contactStat: "clicks" };

test("deliveries set deliveredAt once and only move sent messages forward", () => {
	const plan = getSesEventPlan(
		sesEvent("Delivery", { timestamp: "2026-10-04T10:00:05.000Z", recipients: ["reader@example.com"] })
	);
	assert.equal(plan.type, "Delivery");
	assert.equal(plan.providerMessageId, mail.messageId);
	assert.equal(plan.messageId, messageId);
	assert.equal(plan.email, "reader@example.com");
	assert.deepEqual(plan.occurredAt, new Date("2026-10-04T10:00:05.000Z"));
	assert.deepEqual(plan.firsts, [{ field: "deliveredAt", stat: "delivered" }]);
	assert.deepEqual(plan.status, { to: "delivered", from: ["queued", "sent", "failed"] });
	assert.equal(plan.suppression, null);
	assert.equal(plan.engagement, null);
});

test("stored event data drops the raw mail headers", () => {
	const { data } = getSesEventPlan(sesEvent("Delivery"));
	assert.equal(data.mail.headers, undefined);
	assert.deepEqual(data.mail.tags, mail.tags);
	assert.equal(mail.headers.length, 1);
});

test("hard bounces suppress the bounced address and mark contacts bounced", () => {
	const plan = getSesEventPlan(
		sesEvent("Bounce", {
			bounceType: "Permanent",
			bounceSubType: "General",
			bouncedRecipients: [
				{ emailAddress: "Reader <READER@example.com>", diagnosticCode: "smtp; 550 5.1.1 unknown" },
			],
			timestamp: "2026-10-04T10:00:03.000Z",
		})
	);
	assert.deepEqual(plan.firsts, [{ field: "bouncedAt", stat: "bounced" }]);
	assert.deepEqual(plan.status, { to: "bounced", from: ["queued", "sent", "failed", "delivered"] });
	assert.deepEqual(plan.suppression, {
		emails: ["reader@example.com"],
		reason: "bounce",
		detail: "Permanent/General",
		contactStatus: "bounced",
		contactStatusFrom: ["active", "dormant", "unsubscribed"],
	});
	assert.equal(plan.error, "Hard bounce: General, smtp; 550 5.1.1 unknown");
});

test("soft bounces only record the reason", () => {
	for (const bounceType of ["Transient", "Undetermined"]) {
		const plan = getSesEventPlan(
			sesEvent("Bounce", {
				bounceType,
				bounceSubType: "MailboxFull",
				bouncedRecipients: [{ emailAddress: "reader@example.com" }],
			})
		);
		assert.deepEqual(plan.firsts, []);
		assert.equal(plan.status, null);
		assert.equal(plan.suppression, null);
		assert.equal(plan.error, "Soft bounce: MailboxFull");
	}
});

test("complaints suppress the address and outrank an earlier bounce", () => {
	const plan = getSesEventPlan(
		sesEvent("Complaint", {
			complainedRecipients: [{ emailAddress: "reader@example.com" }],
			complaintFeedbackType: "abuse",
			timestamp: "2026-10-04T12:00:00.000Z",
		})
	);
	assert.deepEqual(plan.firsts, [{ field: "complainedAt", stat: "complained" }]);
	assert.equal(plan.status.to, "complained");
	assert.ok(plan.status.from.includes("bounced"));
	assert.equal(plan.suppression.reason, "complaint");
	assert.equal(plan.suppression.detail, "abuse");
	assert.equal(plan.suppression.contactStatus, "complained");
	assert.ok(plan.suppression.contactStatusFrom.includes("bounced"));
	assert.ok(!plan.suppression.contactStatusFrom.includes("complained"));

	const withoutRecipients = getSesEventPlan(sesEvent("Complaint", {}));
	assert.deepEqual(withoutRecipients.suppression.emails, ["reader@example.com"]);
});

test("not-spam feedback is not a complaint", () => {
	const plan = getSesEventPlan(
		sesEvent("Complaint", {
			complainedRecipients: [{ emailAddress: "reader@example.com" }],
			complaintFeedbackType: "not-spam",
		})
	);
	assert.deepEqual(plan.firsts, []);
	assert.equal(plan.status, null);
	assert.equal(plan.suppression, null);
});

test("opens update engagement and count once per message", () => {
	const plan = getSesEventPlan(sesEvent("Open", { timestamp: "2026-10-04T11:00:00.000Z" }));
	assert.deepEqual(plan.firsts, [OPEN]);
	assert.deepEqual(plan.engagement, { lastOpenAt: new Date("2026-10-04T11:00:00.000Z") });
	assert.equal(plan.status, null);
});

test("a click also counts as an open, since images may be blocked", () => {
	const plan = getSesEventPlan(
		sesEvent("Click", { timestamp: "2026-10-04T11:05:00.000Z", link: "https://example.com/post" })
	);
	const clickedAt = new Date("2026-10-04T11:05:00.000Z");
	assert.deepEqual(plan.firsts, [OPEN, CLICK]);
	assert.deepEqual(plan.engagement, { lastOpenAt: clickedAt, lastClickAt: clickedAt });
});

test("clicks on unsubscribe links are not engagement", () => {
	for (const link of [
		"https://mail.example.com/unsubscribe?token=abc.def",
		"https://mail.example.com/api/unsubscribe?token=abc.def",
	]) {
		const plan = getSesEventPlan(sesEvent("Click", { link }));
		assert.deepEqual(plan.firsts, []);
		assert.equal(plan.engagement, null);
	}
	const article = getSesEventPlan(sesEvent("Click", { link: "https://example.com/unsubscribe-guide" }));
	assert.deepEqual(article.firsts, [OPEN, CLICK]);
});

test("rejects and rendering failures mark the message failed", () => {
	const reject = getSesEventPlan(sesEvent("Reject", { reason: "Bad content" }));
	assert.deepEqual(reject.status, { to: "failed", from: ["queued", "sent"], stat: "failed" });
	assert.equal(reject.error, "Rejected by SES: Bad content");
	assert.deepEqual(reject.occurredAt, new Date(mail.timestamp));

	const rendering = getSesEventPlan({
		eventType: "Rendering Failure",
		mail,
		failure: { errorMessage: "Attribute 'name' is not present", templateName: "welcome" },
	});
	assert.equal(rendering.type, "RenderingFailure");
	assert.equal(rendering.status.to, "failed");
	assert.equal(rendering.error, "Rendering failed: Attribute 'name' is not present");
});

test("send and delivery delay events are only recorded", () => {
	for (const event of [sesEvent("Send"), sesEvent("DeliveryDelay", { delayType: "MailboxFull" })]) {
		const plan = getSesEventPlan(event);
		assert.deepEqual(plan.firsts, []);
		assert.equal(plan.status, null);
		assert.equal(plan.error, null);
		assert.equal(plan.suppression, null);
	}
});

test("identity notifications (notificationType) map like event publishing", () => {
	const plan = getSesEventPlan({
		notificationType: "Bounce",
		mail,
		bounce: {
			bounceType: "Permanent",
			bounceSubType: "NoEmail",
			bouncedRecipients: [{ emailAddress: "reader@example.com" }],
		},
	});
	assert.equal(plan.type, "Bounce");
	assert.equal(plan.suppression.detail, "Permanent/NoEmail");
});

test("message ids from tags must be own, valid ObjectId strings", () => {
	const withTags = (tags) => getSesEventPlan(sesEvent("Open", {}, { mail: { ...mail, tags } }));
	assert.equal(withTags({ message_id: ["../../etc/passwd"] }).messageId, null);
	assert.equal(withTags({ message_id: [{ $ne: null }] }).messageId, null);
	assert.equal(withTags(Object.create({ message_id: [messageId] })).messageId, null);
	assert.equal(withTags(undefined).messageId, null);
	assert.equal(withTags({ message_id: [messageId.toUpperCase()] }).messageId, messageId);
});

test("missing or invalid timestamps fall back to the current time", () => {
	const before = Date.now();
	const plan = getSesEventPlan(
		sesEvent("Open", { timestamp: "nope" }, { mail: { ...mail, timestamp: "garbage" } })
	);
	assert.ok(plan.occurredAt.getTime() >= before);

	const withoutMail = getSesEventPlan({ eventType: "Open", open: {} });
	assert.equal(withoutMail.providerMessageId, null);
	assert.equal(withoutMail.email, null);
});

test("unknown or malformed events are ignored", () => {
	const ignored = [
		null,
		undefined,
		"Bounce",
		42,
		[],
		{},
		{ eventType: "Subscription", mail },
		{ eventType: "constructor", mail },
		{ eventType: "__proto__", mail },
		{ notificationType: "AmazonSnsSubscriptionSucceeded" },
	];
	for (const value of ignored) assert.equal(getSesEventPlan(value), null, JSON.stringify(value));
});
