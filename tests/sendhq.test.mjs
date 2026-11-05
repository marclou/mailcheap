import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { getEmailProviderId } from "../lib/config.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { SEND_OUTCOMES } from "../lib/email-provider/outcomes.js";
import { normalizeSendhqEvent, verifySendhqSignature } from "../lib/email-provider/sendhq-events.js";
import { getMessageClass, getSendhqSendError, toDomainStatus } from "../lib/email-provider/sendhq-rules.js";
import { getSendErrorAction } from "../lib/sending-rules.js";
import { signSendhqWebhook } from "./helpers/sendhq.mjs";

test("SendHQ is only ever picked by EMAIL_PROVIDER", () => {
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: "sendhq" }), "sendhq");
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: " SendHQ " }), "sendhq");
	assert.equal(getEmailProviderId({ SENDHQ_API_KEY: "sk_key" }), "ses");
});

test("campaigns and last-chance emails go out as marketing, everything else as transactional", () => {
	assert.equal(getMessageClass("campaign"), "marketing");
	assert.equal(getMessageClass("last-chance"), "marketing");
	for (const kind of ["welcome", "confirmation", "test"]) assert.equal(getMessageClass(kind), "transactional", kind);
});

test("a SendHQ domain shows its three DKIM CNAMEs, statuses in SES's words, and no return path record to publish", () => {
	const record = (token, verified) => ({ type: "CNAME", name: `${token}._domainkey.News.Example.co.uk.`, value: `${token}.dkim.amazonses.com`, purpose: "dkim", verified });
	const pending = toDomainStatus({
		id: "dom_1",
		name: "news.example.co.uk",
		status: "pending",
		records: [record("a", true), record("b", false), record("c", false), { type: "TXT", name: "_dmarc.news.example.co.uk", value: "v=DMARC1; p=none", purpose: "dmarc" }],
	});
	assert.equal(pending.verified, false);
	assert.equal(pending.dkimStatus, "PENDING");
	assert.equal(pending.mailFromStatus, "PENDING");
	assert.deepEqual(pending.records, [
		{ purpose: "dkim", type: "CNAME", name: "a._domainkey.news.example.co.uk", value: "a.dkim.amazonses.com" },
		{ purpose: "dkim", type: "CNAME", name: "b._domainkey.news.example.co.uk", value: "b.dkim.amazonses.com" },
		{ purpose: "dkim", type: "CNAME", name: "c._domainkey.news.example.co.uk", value: "c.dkim.amazonses.com" },
	]);
	const verified = toDomainStatus({ id: "dom_1", name: "example.com", status: "verified", records: [] });
	assert.equal(verified.verified, true);
	assert.equal(verified.dkimStatus, "SUCCESS");
	assert.equal(verified.mailFromStatus, "SUCCESS", "the return path is SendHQ's own, ready with the domain");
});

test("SendHQ's errors become outcomes: retry what didn't certainly fail, pause what the workspace or domain must fix", () => {
	const error = (status, detail = "", extra = {}) => getSendhqSendError({ status, detail, message: `SendHQ send: ${status ?? "no answer"} (${detail})`, ...extra });
	const action = (...args) => getSendErrorAction(error(...args));

	assert.equal(action(null), "retry", "no answer: the Idempotency-Key makes it safe");
	assert.equal(action(502, "Bad gateway"), "retry");
	const ladder = error(429, "This account is too new to send this volume of email. Your limit increases automatically as your account builds a sending history.");
	assert.equal(ladder.outcome, SEND_OUTCOMES.throttled);
	assert.equal(ladder.retryAfter, 3600);
	assert.equal(error(429, "Too many requests", { retryAfter: 20 }).retryAfter, 20, "SendHQ's retry-after wins");
	assert.equal(error(429, "The 100-recipient integration trial has been used. Activate a paid plan to continue.").outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(error(402, "The integration trial can deliver only to your account email").outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(error(401, "Invalid API key").outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(error(403, "Marketing sends are not enabled for this sender domain").outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(error(403, "The sender domain is not verified").outcome, SEND_OUTCOMES.domainUnverified);
	assert.equal(error(403, "The sender domain is not owned by this workspace").outcome, SEND_OUTCOMES.domainUnverified);
	assert.equal(action(423, "Sending is paused to protect deliverability: bounce rate"), "pause");
	assert.equal(action(409, "Idempotency key reused with a different request body"), "fail", "the first one may have gone");
	assert.equal(action(400, "'to' is required"), "fail");

	const listed = error(422, "Blocked: recipient(s) on the suppression list: reader@example.org. Remove them via the dashboard to override.");
	assert.equal(getSendErrorAction(listed), "fail", "the workspace's list is every account's, not this one's");
	assert.doesNotMatch(listed.message, /reader@example\.org/);
	assert.equal(action(422, "Blocked: recipient(s) unsubscribed from this workspace or domain: reader@example.org."), "fail");
});

function event(type, data = {}) {
	return { type, created_at: "2026-10-29T12:00:00.000Z", data: { email_id: "em_1", from: "Jane <hello@example.com>", to: ["Reader@Example.org"], subject: "Issue", ...data } };
}

test("SendHQ's events take the shape every provider's do, named by SendHQ's email id and never by an account", () => {
	const delivered = normalizeSendhqEvent(event("email.delivered", { recipients: ["Reader@Example.org"] }), "msg_1");
	assert.equal(delivered.type, "delivered");
	assert.equal(delivered.recordAs, "delivered");
	assert.equal(delivered.accountId, null);
	assert.equal(delivered.messageId, null);
	assert.equal(delivered.providerMessageId, "em_1");
	assert.equal(delivered.providerEventId, "msg_1");
	assert.equal(delivered.email, "reader@example.org");
	assert.equal(delivered.occurredAt.toISOString(), "2026-10-29T12:00:00.000Z");

	const bounce = (bounceType, subType, diagnostic) => event("email.bounced", { recipient: "reader@example.org", bounce: { type: bounceType, sub_type: subType, diagnostic, suppressed: bounceType === "Permanent" } });
	const hard = getEventPlan(normalizeSendhqEvent(bounce("Permanent", "NoEmail", "550 5.1.1 No such user")));
	assert.equal(hard.status.to, "bounced");
	assert.equal(hard.suppression.detail, "Permanent/NoEmail");
	assert.ok(hard.globalSuppression, "an address that doesn't exist goes on the never-email list");
	assert.equal(getEventPlan(normalizeSendhqEvent(bounce("Permanent", "General", "550 Mailbox full"))).globalSuppression, null);
	assert.equal(getEventPlan(normalizeSendhqEvent(bounce("Transient", "MailboxFull"))).suppression, null);
	const shared = getEventPlan(normalizeSendhqEvent(bounce("Permanent", "OnAccountSuppressionList")));
	assert.equal(shared.status.to, "failed");
	assert.equal(shared.suppression, null, "the provider's shared list isn't the account's");

	const complaint = getEventPlan(normalizeSendhqEvent(event("email.complained", { recipient: "reader@example.org", complaint: { feedback_type: "abuse" } })));
	assert.equal(complaint.suppression.reason, "complaint");
	assert.equal(getEventPlan(normalizeSendhqEvent(event("email.complained", { complaint: { feedback_type: "not-spam" } }))).suppression, null);
	const delayed = getEventPlan(normalizeSendhqEvent(event("email.delivery_delayed", { delay: { type: "TransientCommunicationFailure", diagnostic: "421 4.7.28 Gmail has detected an unusual rate of mail" } })));
	assert.match(delayed.rateLimit, /4\.7\.28/);
	assert.match(getEventPlan(normalizeSendhqEvent(event("email.failed", { reason: "Rejected by the mail provider" }))).error, /Rejected by the mail provider/);

	assert.equal(normalizeSendhqEvent(event("email.opened")), null, "MailCheap counts opens and clicks itself");
	assert.equal(normalizeSendhqEvent(event("email.received")), null);
	assert.equal(normalizeSendhqEvent({ type: "email.delivered" }), null);
});

test("a SendHQ webhook is signed the Standard Webhooks way, within 5 minutes, with any of a rotation's signatures", () => {
	const body = JSON.stringify(event("email.delivered"));
	const secret = `whsec_${crypto.randomBytes(24).toString("base64")}`;
	const headers = signSendhqWebhook(body, { secret, id: "msg_1" });
	const check = (overrides = {}) =>
		verifySendhqSignature({ body: Buffer.from(body), id: headers["webhook-id"], timestamp: headers["webhook-timestamp"], signature: headers["webhook-signature"], secret, ...overrides });

	assert.equal(check(), true);
	assert.equal(check({ signature: `v1,${"A".repeat(44)} ${headers["webhook-signature"]}` }), true, "one of several");
	assert.equal(check({ id: "msg_2" }), false, "the id is signed");
	assert.equal(check({ body: Buffer.from(`${body} `) }), false);
	assert.equal(check({ secret: `whsec_${crypto.randomBytes(24).toString("base64")}` }), false);
	assert.equal(check({ now: Date.now() + 6 * 60_000 }), false, "a replay");
	assert.equal(check({ signature: headers["webhook-signature"].replace("v1,", "v2,") }), false);
	assert.equal(check({ secret: "" }), false);
});
