import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailProvider, readSendRate } from "../lib/config.js";
import { getResendEventPlan } from "../lib/resend-event-mapping.js";
import { toDomainStatus, toResendFrom } from "../lib/resend-format.js";
import { formatFromAddress, getSendErrorAction } from "../lib/sending-rules.js";
import { signWebhook, verifyWebhook } from "../lib/svix.js";

const SECRET = `whsec_${Buffer.from("a-test-signing-key-for-mailcheap").toString("base64")}`;
const MESSAGE_ID = "6aca8529e4115f8a6130bdbe";

function event(type, data = {}) {
	return {
		type,
		created_at: "2026-10-11T10:00:00.000Z",
		data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", to: ["Reader <Reader@Example.com>"], tags: { message_id: MESSAGE_ID }, ...data },
	};
}

test("Resend is picked by EMAIL_PROVIDER, or by its API key alone", () => {
	assert.equal(getEmailProvider({}), "ses");
	assert.equal(getEmailProvider({ RESEND_API_KEY: "re_x" }), "resend");
	assert.equal(getEmailProvider({ EMAIL_PROVIDER: "ses", RESEND_API_KEY: "re_x" }), "ses");
	assert.equal(getEmailProvider({ EMAIL_PROVIDER: " Resend " }), "resend");
	assert.equal(getEmailProvider({ EMAIL_PROVIDER: "postmark" }), "ses");
});

test("the send rate leaves Resend's default 10 requests/s some headroom and allows raised limits", () => {
	assert.equal(readSendRate({ EMAIL_PROVIDER: "resend" }), 8);
	assert.equal(readSendRate({ EMAIL_PROVIDER: "resend", SEND_RATE_PER_SECOND: "50" }), 50);
	assert.equal(readSendRate({ EMAIL_PROVIDER: "ses", SEND_RATE_PER_SECOND: "50" }), 10);
	assert.equal(readSendRate({ EMAIL_PROVIDER: "ses", SEND_RATE_PER_SECOND: "14" }), 14);
});

test("webhooks verify against the raw body, any listed v1 signature, and a fresh timestamp", () => {
	const body = JSON.stringify(event("email.delivered"));
	const now = Date.parse("2026-10-11T10:00:00Z");
	const timestamp = String(now / 1000);
	const signature = signWebhook({ secret: SECRET, id: "msg_1", timestamp, body });
	const headers = (values) => new Headers({ "svix-id": "msg_1", "svix-timestamp": timestamp, ...values });

	assert.equal(verifyWebhook({ secret: SECRET, headers: headers({ "svix-signature": `v1,${signature}` }), body, now }), true);
	assert.equal(
		verifyWebhook({ secret: SECRET, headers: headers({ "svix-signature": `v1,bm90LWl0 v1,${signature}` }), body, now }),
		true,
		"rotated secrets send several signatures"
	);
	assert.equal(verifyWebhook({ secret: SECRET, headers: headers({ "svix-signature": `v1,${signature}` }), body: `${body} `, now }), false);
	assert.equal(verifyWebhook({ secret: SECRET, headers: headers({ "svix-signature": `v2,${signature}` }), body, now }), false);
	assert.equal(
		verifyWebhook({ secret: SECRET, headers: headers({ "svix-signature": `v1,${signature}` }), body, now: now + 6 * 60_000 }),
		false,
		"replays outside 5 minutes are refused"
	);
	assert.equal(verifyWebhook({ secret: "", headers: headers({ "svix-signature": `v1,${signature}` }), body, now }), false);
});

test("Resend events map to the same plans as SES events", () => {
	const delivered = getResendEventPlan(event("email.delivered"));
	assert.equal(delivered.type, "Delivery");
	assert.equal(delivered.messageId, MESSAGE_ID);
	assert.equal(delivered.providerMessageId, "4ef9a417-02e9-4d39-ad75-9611e0fcc33c");
	assert.equal(delivered.email, "reader@example.com");
	assert.deepEqual(delivered.firsts, [{ field: "deliveredAt", stat: "delivered" }]);
	assert.equal(delivered.status.to, "delivered");

	const hard = getResendEventPlan(event("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "No such user" } }));
	assert.equal(hard.status.to, "bounced");
	assert.deepEqual(hard.suppression.emails, ["reader@example.com"]);
	assert.equal(hard.suppression.reason, "bounce");
	assert.equal(hard.error, "Hard bounce: General, No such user");

	const soft = getResendEventPlan(event("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } }));
	assert.equal(soft.status, null);
	assert.equal(soft.suppression, null);

	const complaint = getResendEventPlan(event("email.complained"));
	assert.equal(complaint.status.to, "complained");
	assert.equal(complaint.suppression.reason, "complaint");

	const suppressed = getResendEventPlan(event("email.suppressed", { suppressed: { type: "OnAccountSuppressionList" } }));
	assert.equal(suppressed.status.to, "failed");
	assert.equal(suppressed.suppression.contactStatus, "bounced");

	const failed = getResendEventPlan(event("email.failed", { failed: { reason: "reached_daily_quota" } }));
	assert.equal(failed.error, "Failed at Resend: reached_daily_quota");
	assert.equal(failed.suppression, null);
});

test("clicks count as opens too, except unsubscribe links, and unknown events are skipped", () => {
	const click = getResendEventPlan(event("email.clicked", { click: { link: "https://example.com/post" } }));
	assert.deepEqual(click.firsts.map(({ field }) => field), ["openedAt", "clickedAt"]);
	const unsubscribe = getResendEventPlan(event("email.clicked", { click: { link: "https://mail.example.com/unsubscribe?token=x" } }));
	assert.equal(unsubscribe.engagement, null);
	assert.equal(getResendEventPlan(event("contact.created")), null);
	assert.equal(getResendEventPlan(null), null);
	assert.equal(getResendEventPlan(event("email.sent", { tags: { message_id: "not-an-id" } })).messageId, null);
});

test("Resend errors retry, pause or fail like SES ones", () => {
	const resendError = (name, message = "") => Object.assign(new Error(message), { name });
	assert.equal(getSendErrorAction(resendError("rate_limit_exceeded")), "retry");
	assert.equal(getSendErrorAction(resendError("application_error")), "retry");
	assert.equal(getSendErrorAction(resendError("daily_quota_exceeded")), "pause");
	assert.equal(getSendErrorAction(resendError("restricted_api_key")), "pause");
	assert.equal(getSendErrorAction(resendError("validation_error", "The example.com domain is not verified. Please, add and verify your domain.")), "pause");
	assert.equal(getSendErrorAction(resendError("validation_error", "Invalid `to` field.")), "fail");
});

test("Resend domains read in the domains page's words, with full record names", () => {
	const domain = toDomainStatus({
		name: "mail.example.com",
		status: "verified",
		records: [
			{ record: "SPF", name: "send", type: "MX", status: "verified", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
			{ record: "SPF", name: "send", type: "TXT", status: "pending", value: "\"v=spf1 include:amazonses.com ~all\"" },
			{ record: "DKIM", name: "resend._domainkey", type: "TXT", status: "verified", value: "p=MIGf" },
		],
	});
	assert.equal(domain.verified, true);
	assert.equal(domain.dkimStatus, "SUCCESS");
	assert.equal(domain.mailFromDomain, "send.mail.example.com");
	assert.equal(domain.mailFromStatus, "PENDING");
	assert.deepEqual(domain.records[0], { type: "MX", name: "send.mail.example.com", value: "10 feedback-smtp.us-east-1.amazonses.com" });
	assert.equal(domain.records[2].name, "resend._domainkey.mail.example.com");
});

test("sender names reach Resend unencoded", () => {
	assert.equal(toResendFrom(formatFromAddress({ fromName: "Jane Doe", fromEmail: "hi@example.com" })), '"Jane Doe" <hi@example.com>');
	assert.equal(toResendFrom(formatFromAddress({ fromName: "Zoë Müller", fromEmail: "hi@example.com" })), '"Zoë Müller" <hi@example.com>');
	assert.equal(toResendFrom("hi@example.com"), "hi@example.com");
});
