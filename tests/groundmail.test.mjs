import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailProviderId } from "../lib/config.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { normalizeGroundmailEvent, verifyGroundmailSignature } from "../lib/email-provider/groundmail-events.js";
import { buildEmail, getSendError, getTags, getTenantExternalId, readVerifyChecks, toAddress, toDomainStatus } from "../lib/email-provider/groundmail-rules.js";
import { SEND_OUTCOMES } from "../lib/email-provider/outcomes.js";
import { getSendErrorAction } from "../lib/sending-rules.js";
import { GROUNDMAIL, signGroundmailEvent } from "./helpers/groundmail.mjs";

const ACCOUNT_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const message = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", accountId: ACCOUNT_ID, kind: "campaign", campaignId: "84f1a2b3c4d5e6f7a8b9c0d3" };

test("EMAIL_PROVIDER=groundmail picks Groundmail; nothing else does", () => {
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: "groundmail" }), "groundmail");
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: " Groundmail ", POSTSHIBA_API_KEY: "ps_key" }), "groundmail");
	assert.equal(getEmailProviderId({ GROUNDMAIL_API_KEY: "gm_key" }), "ses", "a key alone doesn't switch providers");
	assert.equal(getTenantExternalId(ACCOUNT_ID), `mc-${ACCOUNT_ID}`);
});

const detail = {
	domain: { id: "d_1", name: "mail.example.com", status: "pending" },
	records: [
		{ type: "TXT", host: "_groundmail.mail.example.com", value: "groundmail-verify=abc", purpose: "Domain ownership" },
		{ type: "TXT", host: "gm1._domainkey.mail.example.com", value: "v=DKIM1; p=MIIB", purpose: "DKIM" },
		{ type: "CNAME", host: "rp.mail.example.com", value: "rp.groundmail.dev", purpose: "Return path" },
		{ type: "TXT", host: "mail.example.com", value: "v=spf1 include:spf.groundmail.dev ~all", purpose: "SPF" },
		{ type: "TXT", host: "_dmarc.mail.example.com", value: "v=DMARC1; p=none;", purpose: "DMARC" },
		{ type: "CNAME", host: "ps.mail.example.com", value: "track.groundmail.dev", purpose: "Open/click tracking" },
	],
};

test("Groundmail domains show their four records in the Domains page's groups, with statuses in its words", () => {
	assert.deepEqual(toDomainStatus(detail), {
		verified: false,
		dkimStatus: "PENDING",
		mailFromStatus: "PENDING",
		records: [
			{ purpose: "dkim", type: "TXT", name: "_groundmail.mail.example.com", value: "groundmail-verify=abc" },
			{ purpose: "dkim", type: "TXT", name: "gm1._domainkey.mail.example.com", value: "v=DKIM1; p=MIIB" },
			{ purpose: "mail-from", type: "CNAME", name: "rp.mail.example.com", value: "rp.groundmail.dev" },
			{ purpose: "mail-from", type: "TXT", name: "mail.example.com", value: "v=spf1 include:spf.groundmail.dev ~all" },
		],
		lastError: null,
	});
	const verified = toDomainStatus({ ...detail, domain: { ...detail.domain, status: "verified" } }, { lastError: "old" });
	assert.deepEqual([verified.verified, verified.dkimStatus, verified.mailFromStatus, verified.lastError], [true, "SUCCESS", "SUCCESS", null]);
	assert.equal(toDomainStatus({ ...detail, domain: { ...detail.domain, status: "failed" } }).dkimStatus, "FAILED");

	// A verify that found DNS incomplete: each group is found once all of its records are.
	const checks = { ownership: true, dkim: true, spf: false, return_path: true, dmarc: false };
	const partial = toDomainStatus(detail, { checks, lastError: "missing SPF include:spf.groundmail.dev" });
	assert.deepEqual([partial.verified, partial.dkimStatus, partial.mailFromStatus, partial.lastError], [false, "SUCCESS", "PENDING", "missing SPF include:spf.groundmail.dev"]);
	assert.deepEqual(readVerifyChecks({ checks, mail_server_signing: { dkim_ok: false, return_path_ok: true } }), { ...checks, dkim: false }, "the mail server has the last word on DKIM");
	assert.equal(readVerifyChecks({}), null);
	assert.deepEqual(toDomainStatus({ domain: null, records: null }).records, []);
});

test("the sender's name goes apart from the address, decoded", () => {
	assert.deepEqual(toAddress('"Field Notes" <hello@field-notes.example.com>'), { email: "hello@field-notes.example.com", name: "Field Notes" });
	const encoded = `=?UTF-8?B?${Buffer.from("Café Notes", "utf8").toString("base64")}?= <hi@example.com>`;
	assert.deepEqual(toAddress(encoded), { email: "hi@example.com", name: "Café Notes" });
	assert.equal(toAddress("<hi@example.com>"), "hi@example.com");
	assert.equal(toAddress("hi@example.com"), "hi@example.com");
});

test("a newsletter email is category newsletter, in the account's tenant, with MailCheap's headers and tags", () => {
	const email = {
		from: '"Jane" <hello@news.example.com>',
		to: "reader@example.org",
		replyTo: "jane@example.com",
		subject: "Issue 12 — café",
		html: "<p>Hi</p>",
		text: "Hi",
		headers: { "List-Unsubscribe": "<https://news.example.com/api/unsubscribe?token=t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
		unsubscribeUrl: "https://news.example.com/unsubscribe?token=t",
		bytes: 9,
	};
	assert.deepEqual(buildEmail({ email, category: "newsletter", tags: getTags(message), tenant: `mc-${ACCOUNT_ID}` }), {
		from: { email: "hello@news.example.com", name: "Jane" },
		to: "reader@example.org",
		reply_to: "jane@example.com",
		subject: "Issue 12 — café",
		html: "<p>Hi</p>",
		text: "Hi",
		headers: email.headers,
		tags: [
			{ name: "account_id", value: ACCOUNT_ID },
			{ name: "message_id", value: message._id },
			{ name: "kind", value: "campaign" },
			{ name: "campaign_id", value: message.campaignId },
		],
		category: "newsletter",
		tenant: `mc-${ACCOUNT_ID}`,
	});
	const platform = buildEmail({ email: { from: "MailCheap <login@mail.example.com>", to: "me@example.com", subject: "Code", text: "123" }, category: "transactional" });
	assert.deepEqual(platform, { from: { email: "login@mail.example.com", name: "MailCheap" }, to: "me@example.com", subject: "Code", text: "123", category: "transactional" });
	assert.deepEqual(getTags({ ...message, kind: "welcome", campaignId: undefined }).map(({ name }) => name), ["account_id", "message_id", "kind"]);
});

function groundmailError(status, code, fields = {}) {
	return { status, providerCode: code, detail: fields.message ?? "", details: fields.details ?? null, body: fields.body ?? null, retryAfter: fields.retryAfter ?? null, message: `Groundmail POST /emails: ${status} ${code}` };
}

test("send errors become outcomes: limits retry, refusals of the setup pause, suppressions skip the address", () => {
	const now = new Date("2026-10-19T22:30:00Z");
	const outcome = (error) => getSendError(error, now).outcome;

	const ramp = getSendError(groundmailError(429, "daily_ramp_limit", { details: { tenant: `mc-${ACCOUNT_ID}`, resets_at: "2026-10-20T00:00:00.000Z" } }), now);
	assert.deepEqual([ramp.outcome, ramp.retryAfter], [SEND_OUTCOMES.throttled, 90 * 60 + 60], "after the reset at midnight UTC");
	assert.equal(getSendError(groundmailError(429, "rate_limited", { retryAfter: 7 }), now).retryAfter, 7, "Retry-After first");
	assert.equal(getSendError(groundmailError(429, "rate_limited"), now).retryAfter, 60);

	const notEnabled = getSendError(groundmailError(403, "newsletter_not_enabled"), now);
	assert.deepEqual([notEnabled.outcome, notEnabled.message], [SEND_OUTCOMES.approvalPending, "Groundmail hasn't enabled newsletter sending for this account yet (newsletter_not_enabled)"]);
	assert.equal(getSendErrorAction(notEnabled), "pause");

	const paused = getSendError(groundmailError(403, "forbidden", { details: { tenant: `mc-${ACCOUNT_ID}`, tenant_status: "paused" } }), now);
	assert.deepEqual([paused.outcome, paused.hold], [SEND_OUTCOMES.tenantPaused, "held"]);
	assert.equal(outcome(groundmailError(403, "forbidden", { message: "From domain 'news.example.com' is not verified for this API key. Verify it in Groundmail first." })), SEND_OUTCOMES.domainUnverified);
	assert.equal(outcome(groundmailError(403, "forbidden", { message: "Add a payment method", body: { error: { upgrade_url: "/settings/billing" } } })), SEND_OUTCOMES.approvalPending);
	assert.equal(outcome(groundmailError(403, "forbidden", { message: "Sending is restricted on this account" })), SEND_OUTCOMES.misconfigured);
	assert.equal(outcome(groundmailError(403, "domain_not_allowed")), SEND_OUTCOMES.domainUnverified);
	for (const [status, code] of [[401, "unauthorized"], [403, "insufficient_scope"], [403, "tenants_not_enabled"], [404, "not_found"], [429, "plan_limit"]]) {
		assert.equal(outcome(groundmailError(status, code)), SEND_OUTCOMES.misconfigured, code);
	}

	const suppressed = getSendError(groundmailError(422, "validation_error", { details: { suppressed: ["reader@example.org"] } }), now);
	assert.deepEqual([suppressed.outcome, suppressed.message], [SEND_OUTCOMES.suppressed, "Groundmail suppresses this address for the account"]);
	assert.equal(getSendErrorAction(suppressed), "suppress");
	assert.equal(outcome(groundmailError(422, "validation_error", { details: { held_back: [{ email: "x@nowhere.example", reason: "no_mail_server" }] } })), SEND_OUTCOMES.suppressed);
	assert.equal(outcome(groundmailError(400, "validation_error")), SEND_OUTCOMES.failed);

	assert.equal(outcome(groundmailError(409, "idempotency_conflict", { message: "A request with this Idempotency-Key is already in progress" })), SEND_OUTCOMES.throttled);
	assert.equal(outcome(groundmailError(409, "idempotency_conflict", { message: "Idempotency-Key was reused with a different request body" })), SEND_OUTCOMES.failed);
	for (const status of [500, 502, 503]) assert.equal(outcome(groundmailError(status, status === 500 ? "internal_error" : "upstream_error")), SEND_OUTCOMES.unavailable, status);
	assert.equal(outcome(groundmailError(504, "upstream_error")), SEND_OUTCOMES.failed, "a 504 may have sent it: never twice");
	assert.equal(outcome({ status: null, providerCode: null, message: "Groundmail POST /emails: timed out" }), SEND_OUTCOMES.unavailable, "the Idempotency-Key makes the retry safe");
});

test("a signature is t= and v1=, the hex HMAC of the timestamp and the exact body, at most 5 minutes old", () => {
	const event = { type: "email.delivered", created_at: "2026-10-19T12:00:00.000Z", data: { email_id: "msg_1" } };
	const now = Date.now();
	const { body, header } = signGroundmailEvent(event);
	const secret = GROUNDMAIL.webhookSecret;
	assert.equal(verifyGroundmailSignature({ body, header, secret, now }), true);
	assert.equal(verifyGroundmailSignature({ body: Buffer.from(body), header, secret, now }), true, "raw bytes too");
	assert.equal(verifyGroundmailSignature({ body, header: header.replace(",", ", "), secret, now }), true, "spaces after commas");

	assert.equal(verifyGroundmailSignature({ body, header, secret: "whsec_another", now }), false, "bad secret");
	assert.equal(verifyGroundmailSignature({ body: body.replace("delivered", "bounced"), header, secret, now }), false, "changed body");
	assert.equal(verifyGroundmailSignature({ body, header: header.replace(/t=\d+/, (t) => `t=${Number(t.slice(2)) + 1}`), secret, now }), false, "the timestamp is signed");
	assert.equal(verifyGroundmailSignature({ body, header: header.split(",")[1], secret, now }), false, "no timestamp");
	assert.equal(verifyGroundmailSignature({ body, header: "t=1,v1=not-hex", secret, now }), false);
	assert.equal(verifyGroundmailSignature({ body, header, secret: "", now }), false, "no secret, no trust");
	assert.equal(verifyGroundmailSignature({ body, header: null, secret, now }), false);

	const stale = signGroundmailEvent(event, { timestamp: Math.floor(now / 1000) - 301 });
	assert.equal(verifyGroundmailSignature({ ...stale, secret, now }), false, "stale");
	const future = signGroundmailEvent(event, { timestamp: Math.floor(now / 1000) + 301 });
	assert.equal(verifyGroundmailSignature({ ...future, secret, now }), false, "from the future");
});

function groundmailEvent(type, data = {}) {
	return {
		type,
		created_at: "2026-10-19T12:00:00.000Z",
		data: { email_id: "msg_abc", to: ["Reader@Example.org"], from: "hello@news.example.com", subject: "Issue", status: type.split(".")[1], bounce_reason: null, bounce_type: null, tenant: `mc-${ACCOUNT_ID}`, ...data },
	};
}

test("Groundmail's events take the one event shape, named by Groundmail's id and the account's tenant", () => {
	const delivered = normalizeGroundmailEvent(groundmailEvent("email.delivered"));
	assert.equal(delivered.type, "delivered");
	assert.equal(delivered.recordAs, "delivered");
	assert.equal(delivered.providerMessageId, "msg_abc");
	assert.equal(delivered.providerEventId, "msg_abc:delivered");
	assert.equal(delivered.accountId, ACCOUNT_ID);
	assert.equal(delivered.tenant, `mc-${ACCOUNT_ID}`);
	assert.equal(delivered.email, "reader@example.org");
	assert.deepEqual(delivered.occurredAt, new Date("2026-10-19T12:00:00.000Z"));
	assert.deepEqual(getEventPlan(delivered).status, { to: "delivered", from: ["queued", "sent", "failed"] });
	assert.equal(normalizeGroundmailEvent(groundmailEvent("email.delivered", { tenant: undefined })).accountId, null, "an account without a tenant");
	assert.equal(normalizeGroundmailEvent(groundmailEvent("email.delivered", { tenant: "cust_8412" })).accountId, null, "another sender's tenant");
	assert.equal(delivered.messageId, null, "no tags");

	const MESSAGE_ID = "6512bd43d9caa6e02c990b0b";
	const tags = [
		{ name: "account_id", value: ACCOUNT_ID },
		{ name: "message_id", value: MESSAGE_ID },
		{ name: "kind", value: "campaign" },
	];
	const tagged = normalizeGroundmailEvent(groundmailEvent("email.delivered", { tags }));
	assert.deepEqual([tagged.messageId, tagged.accountId, tagged.providerMessageId], [MESSAGE_ID, ACCOUNT_ID, "msg_abc"], "the message_id tag names the message");
	assert.equal(normalizeGroundmailEvent(groundmailEvent("email.delivered", { tags, tenant: undefined })).accountId, ACCOUNT_ID, "without a tenant, the account_id tag");
	const otherAccount = [{ name: "account_id", value: "6512bd43d9caa6e02c990b0c" }];
	assert.equal(normalizeGroundmailEvent(groundmailEvent("email.delivered", { tags: otherAccount })).accountId, null, "a tag that disagrees with the tenant");
	assert.equal(normalizeGroundmailEvent(groundmailEvent("email.delivered", { tags: [{ name: "message_id", value: "not-an-id" }] })).messageId, null);

	const hard = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.bounced", { bounce_type: "hard", bounce_reason: "550 5.1.1 user unknown" })));
	assert.equal(hard.error, "Hard bounce: 550 5.1.1 user unknown");
	assert.deepEqual(hard.suppression, { emails: ["reader@example.org"], reason: "bounce", detail: "bounced/hard", contactStatus: "bounced", contactStatusFrom: ["active", "dormant", "unsubscribed"] });
	assert.deepEqual(hard.globalSuppression, { emails: ["reader@example.org"], reason: "bounce", detail: "bounced/hard" }, "5.1.1: the mailbox doesn't exist");
	const disabled = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.bounced", { bounce_type: "hard", bounce_reason: "550 5.2.1 mailbox disabled" })));
	assert.deepEqual([disabled.suppression.reason, disabled.globalSuppression], ["bounce", null], "suppressed for the account only");
	const simulated = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.bounced", { bounce_type: "hard", bounce_reason: "550 5.1.1 User unknown (simulated hard bounce)", test: true })));
	assert.deepEqual([simulated.suppression.reason, simulated.globalSuppression], ["bounce", null], "a simulated bounce stays off the shared list");

	const block = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.bounced", { bounce_type: "block", bounce_reason: "550 5.7.1 rejected due to local policy" })));
	assert.deepEqual([block.suppression, block.status, block.error], [null, null, "Soft bounce: 550 5.7.1 rejected due to local policy"], "a block isn't the address's fault");
	assert.equal(getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.bounced", { bounce_type: "something-new" }))).suppression.reason, "bounce", "an unknown type counts as hard");

	const complaint = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.complained")));
	assert.deepEqual([complaint.suppression.reason, complaint.suppression.detail, complaint.type], ["complaint", "complaint", "complained"]);

	const failedHard = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.failed", { bounce_type: "hard", bounce_reason: "550 5.1.1 no such user" })));
	assert.equal(failedHard.suppression.reason, "bounce", "a permanent failure to a bad address is a hard bounce");
	const failed = getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.failed", { bounce_reason: "content rejected" })));
	assert.deepEqual([failed.status.to, failed.error, failed.suppression], ["failed", "Failed at Groundmail: content rejected", null]);

	assert.equal(getEventPlan(normalizeGroundmailEvent(groundmailEvent("email.delivery_delayed"))).status, null);
	const unsubscribed = normalizeGroundmailEvent({ type: "contact.unsubscribed", created_at: "2026-10-19T12:00:00.000Z", data: { email: "Reader@Example.org", scope: "all", email_id: "msg_abc" } });
	assert.deepEqual([unsubscribed.type, unsubscribed.email, unsubscribed.providerMessageId], ["unsubscribe", "reader@example.org", "msg_abc"]);
	assert.equal(getEventPlan(unsubscribed).unsubscribe, true);

	for (const type of ["email.opened", "email.clicked", "email.suppressed", "email.held", "email.scheduled", "email.received", "automation.started"]) {
		assert.equal(normalizeGroundmailEvent(groundmailEvent(type)), null, `${type}: MailCheap tracks its own, or it's answered already`);
	}
	assert.equal(normalizeGroundmailEvent({ type: "email.delivered" }), null);
	assert.equal(normalizeGroundmailEvent(null), null);
});
