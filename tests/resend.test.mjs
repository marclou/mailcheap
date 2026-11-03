import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailProviderId } from "../lib/config.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { SEND_OUTCOMES } from "../lib/email-provider/outcomes.js";
import { normalizeResendEvent } from "../lib/email-provider/resend-events.js";
import { getResendSendError, toDomainStatus } from "../lib/email-provider/resend-rules.js";
import { getSendErrorAction } from "../lib/sending-rules.js";

const ACCOUNT_ID = "64b000000000000000000001";
const MESSAGE_ID = "64b000000000000000000002";

test("Resend is only ever picked by EMAIL_PROVIDER: its key also sends MailCheap's own emails", () => {
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: "resend" }), "resend");
	assert.equal(getEmailProviderId({ RESEND_API_KEY: "re_key" }), "ses");
});

test("a Resend domain's records get full names in the domain's zone, statuses in SES's words and the MX's priority", () => {
	const status = toDomainStatus({
		name: "news.example.co.uk",
		status: "pending",
		records: [
			{ record: "DKIM", type: "TXT", name: "resend._domainkey.news", value: "p=key", status: "verified" },
			{ record: "SPF", type: "MX", name: "send.news", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "verified" },
			{ record: "SPF", type: "TXT", name: "send.news", value: "v=spf1 include:amazonses.com ~all", status: "temporary_failure" },
			{ record: "Tracking", type: "CNAME", name: "links.news", value: "links.resend.com", status: "pending" },
		],
	});
	assert.equal(status.verified, false);
	assert.equal(status.dkimStatus, "SUCCESS");
	assert.equal(status.mailFromStatus, "TEMPORARY_FAILURE");
	assert.deepEqual(status.records, [
		{ purpose: "dkim", type: "TXT", name: "resend._domainkey.news.example.co.uk", value: "p=key" },
		{ purpose: "mail-from", type: "MX", name: "send.news.example.co.uk", value: "10 feedback-smtp.eu-west-1.amazonses.com" },
		{ purpose: "mail-from", type: "TXT", name: "send.news.example.co.uk", value: "v=spf1 include:amazonses.com ~all" },
	]);
	assert.equal(toDomainStatus({ name: "example.com", status: "verified", records: [] }).verified, true);
});

test("Resend's errors become outcomes: retry what didn't certainly fail, pause what the team or domain must fix", () => {
	const action = (error, headers) => getSendErrorAction(getResendSendError(error, headers));
	const limited = getResendSendError({ name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" }, { "retry-after": "3" });
	assert.equal(limited.outcome, SEND_OUTCOMES.throttled);
	assert.equal(limited.retryAfter, 3);
	assert.equal(getResendSendError({ name: "daily_quota_exceeded", statusCode: 429, message: "Daily quota" }).retryAfter, 3600);
	assert.equal(action({ name: "application_error", statusCode: null, message: "Unable to fetch data" }), "retry", "the Idempotency-Key makes it safe");
	assert.equal(action({ name: "internal_server_error", statusCode: 500, message: "Oops" }), "retry");
	assert.equal(action({ name: "validation_error", statusCode: 403, message: "The example.com domain is not verified. Please, add and verify your domain" }), "pause");
	assert.equal(getResendSendError({ name: "invalid_api_key", statusCode: 403, message: "API key is invalid" }).outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(getResendSendError({ name: "monthly_quota_exceeded", statusCode: 429, message: "Monthly quota" }).outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(action({ name: "invalid_idempotent_request", statusCode: 409, message: "Same key, other payload" }), "fail", "the first one may have gone");
	assert.equal(action({ name: "validation_error", statusCode: 422, message: "Invalid `to` field" }), "fail");
});

function event(type, data = {}) {
	return {
		type,
		created_at: "2026-10-28T12:00:00.000Z",
		data: { email_id: "re-email-1", to: ["Reader@Example.org"], tags: { account_id: ACCOUNT_ID, message_id: MESSAGE_ID, kind: "campaign" }, ...data },
	};
}

test("Resend's events take the shape every provider's do, with the account and email from the tags", () => {
	const delivered = normalizeResendEvent(event("email.delivered"), "msg_1");
	assert.equal(delivered.type, "delivered");
	assert.equal(delivered.recordAs, "delivered");
	assert.equal(delivered.accountId, ACCOUNT_ID);
	assert.equal(delivered.messageId, MESSAGE_ID);
	assert.equal(delivered.providerMessageId, "re-email-1");
	assert.equal(delivered.providerEventId, "msg_1");
	assert.equal(delivered.email, "reader@example.org");
	assert.equal(delivered.occurredAt.toISOString(), "2026-10-28T12:00:00.000Z");

	const hard = getEventPlan(normalizeResendEvent(event("email.bounced", { bounce: { type: "Permanent", subType: "NoEmail", message: "No such user" } })));
	assert.equal(hard.status.to, "bounced");
	assert.equal(hard.suppression.detail, "Permanent/NoEmail");
	assert.ok(hard.globalSuppression, "an address that doesn't exist goes on the never-email list");
	const full = getEventPlan(normalizeResendEvent(event("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "Mailbox full" } })));
	assert.equal(full.globalSuppression, null);
	assert.equal(getEventPlan(normalizeResendEvent(event("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } }))).suppression, null);

	assert.equal(getEventPlan(normalizeResendEvent(event("email.complained"))).suppression.reason, "complaint");
	assert.equal(normalizeResendEvent(event("email.delivery_delayed")).type, "deferred");
	const suppressed = getEventPlan(normalizeResendEvent(event("email.suppressed", { suppressed: { type: "OnAccountSuppressionList", message: "Bounced before" } })));
	assert.equal(suppressed.status.to, "failed");
	assert.equal(suppressed.suppression, null, "the team's list isn't the account's");
	assert.match(getEventPlan(normalizeResendEvent(event("email.failed", { failed: { reason: "reached_daily_quota" } }))).error, /reached_daily_quota/);
	assert.equal(normalizeResendEvent(event("email.opened")), null, "MailCheap counts opens and clicks itself");
	assert.equal(normalizeResendEvent(event("domain.updated")), null);
	assert.equal(normalizeResendEvent({ ...event("email.delivered"), data: { ...event("email.delivered").data, tags: { account_id: "not-an-id" } } }).accountId, null);
});
