import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { getEmailProviderId, getWorkspaceDailyLimit, getWorkspaceMailbox } from "../lib/config.js";
import { getDomainSetup } from "../lib/domain-records.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { SEND_OUTCOMES } from "../lib/email-provider/outcomes.js";
import {
	REF_HEADER,
	createMessageRef,
	getDkimHost,
	getRetryAfter,
	hasDkimKey,
	isConnectionError,
	parseBounce,
	toSendError,
} from "../lib/email-provider/workspace-rules.js";
import { getSendErrorAction } from "../lib/sending-rules.js";

process.env.BETTER_AUTH_SECRET = "test-secret-for-workspace-rules-0123456789";

const ACCOUNT = "64f1a2b3c4d5e6f7a8b9c0d1";
const MESSAGE = "74f1a2b3c4d5e6f7a8b9c0d2";

// The email as Gmail's SMTP server gets it: nodemailer writes the headers, folded where it folds them.
async function buildEmail(ref = createMessageRef({ accountId: ACCOUNT, messageId: MESSAGE })) {
	const { message } = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
		from: '"Jane" <hello@example.com>',
		to: "reader@example.org",
		subject: "Issue",
		text: "Hello",
		html: "<p>Hello</p>",
		headers: { "List-Unsubscribe": "<https://example.com/unsubscribe?token=abc>", "Feedback-ID": "c:mc-a:campaign:mailcheap", [REF_HEADER]: ref },
	});
	return message.toString();
}

// A delivery status notification as Gmail writes it: what happened in words, the status fields, then the email itself.
function buildBounce(original, { action = "failed", status = "5.1.1", diagnostic = "smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please try\r\n 550-5.1.1 double-checking the recipient's email address for typos or\r\n 550 5.1.1 unnecessary spaces. - gsmtp", id = "6553a1b2.050a0220.1234.5678.GMR@mx.google.com" } = {}) {
	return [
		"Delivered-To: hello@example.com",
		"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
		"To: hello@example.com",
		"Subject: Delivery Status Notification (Failure)",
		`Message-ID: <${id}>`,
		'Content-Type: multipart/report; boundary="000000000000aaa"; report-type=delivery-status',
		"",
		"--000000000000aaa",
		'Content-Type: text/plain; charset="UTF-8"',
		"",
		"Your message wasn't delivered to reader@example.org.",
		"",
		"--000000000000aaa",
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; googlemail.com",
		"X-Original-Message-ID: <original@example.com>",
		"",
		"Final-Recipient: rfc822; Reader@example.org",
		`Action: ${action}`,
		`Status: ${status}`,
		`Diagnostic-Code: ${diagnostic}`,
		"",
		"--000000000000aaa",
		"Content-Type: message/rfc822",
		"",
		original,
		"--000000000000aaa--",
	].join("\r\n");
}

test("a Google Workspace mailbox is the provider once its app password is set, behind PostShiba and before SES", () => {
	assert.equal(getEmailProviderId({ WORKSPACE_APP_PASSWORD: "abcd" }), "workspace");
	assert.equal(getEmailProviderId({ WORKSPACE_APP_PASSWORD: "abcd", POSTSHIBA_API_KEY: "ps_key" }), "postshiba");
	assert.equal(getEmailProviderId({ WORKSPACE_APP_PASSWORD: "abcd", EMAIL_PROVIDER: "ses" }), "ses");
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: "Workspace" }), "workspace");

	assert.deepEqual(getWorkspaceMailbox({ WORKSPACE_EMAIL: " News@Example.com ", WORKSPACE_APP_PASSWORD: "abcd efgh ijkl mnop" }), { user: "news@example.com", pass: "abcdefghijklmnop" });
	assert.equal(getWorkspaceMailbox({ WORKSPACE_EMAIL: "news@example.com" }), null);
	assert.equal(getWorkspaceMailbox({ WORKSPACE_APP_PASSWORD: "abcd" }), null);

	assert.equal(getWorkspaceDailyLimit({}), 1500, "under Google's 2,000, which the mailbox's own emails count in too");
	assert.equal(getWorkspaceDailyLimit({ WORKSPACE_DAILY_LIMIT: "400" }), 400);
	for (const value of ["0", "-5", "many", "999999"]) assert.equal(getWorkspaceDailyLimit({ WORKSPACE_DAILY_LIMIT: value }), 1500, value);
});

test("a bounce names the email it's about through the signed header that email carried", async () => {
	const bounce = parseBounce(buildBounce(await buildEmail()));
	assert.deepEqual(bounce, {
		accountId: ACCOUNT,
		messageId: MESSAGE,
		id: "6553a1b2.050a0220.1234.5678.GMR@mx.google.com",
		recipient: "reader@example.org",
		type: "bounce",
		bounce: "hard",
		undeliverable: true,
		reason: "5.1.1 550-5.1.1 The email account that you tried to reach does not exist. Please try 550-5.1.1 double-checking the recipient's email address for typos or 550 5.1.1 unnecessary spaces. - gsmtp",
		detail: "bounce/5.1.1",
	});
	assert.equal(bounce.email, undefined, "the address is the email's own (lib/workspace-bounces.js), never the notification's");
	assert.equal(parseBounce(buildBounce(await buildEmail()).replace("Final-Recipient: rfc822; Reader@example.org", "X-Failed-Recipients: reader@example.org")).recipient, "reader@example.org");

	const plan = getEventPlan({ ...bounce, email: "reader@example.org" });
	assert.equal(plan.suppression.contactStatus, "bounced");
	assert.deepEqual(plan.globalSuppression, { emails: ["reader@example.org"], reason: "bounce", detail: "bounce/5.1.1" });
});

test("only an email MailCheap sent is a bounce: no header, a changed one or another server's key is nothing", async () => {
	const ref = createMessageRef({ accountId: ACCOUNT, messageId: MESSAGE });
	const [account, message, signature] = ref.split(".");
	assert.match(ref, /^[a-f0-9]{24}\.[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/);
	assert.throws(() => createMessageRef({ accountId: "nope", messageId: MESSAGE }), /Invalid message reference/);

	const other = "84f1a2b3c4d5e6f7a8b9c0d3";
	for (const forged of [`${account}.${other}.${signature}`, `${other}.${message}.${signature}`, `${account}.${message}.${"A".repeat(43)}`]) {
		assert.equal(parseBounce(buildBounce(await buildEmail(forged))), null, forged);
	}
	assert.equal(parseBounce(buildBounce("From: someone@example.org\r\nSubject: Not ours\r\n\r\nHello")), null);
	assert.equal(parseBounce(""), null);
	assert.equal(parseBounce(null), null);

	const signed = buildBounce(await buildEmail());
	process.env.BETTER_AUTH_SECRET = "another-secret-for-workspace-rules-0123456789";
	try {
		assert.equal(parseBounce(signed), null);
	} finally {
		process.env.BETTER_AUTH_SECRET = "test-secret-for-workspace-rules-0123456789";
	}
});

test("an address that doesn't exist is a hard bounce; a full mailbox or a refusal leaves the contact as it is", async () => {
	const original = await buildEmail();
	const parse = (fields) => parseBounce(buildBounce(original, fields));

	const full = parse({ status: "5.2.2", diagnostic: "smtp; 552-5.2.2 The recipient's inbox is out of storage space." });
	assert.deepEqual([full.bounce, full.undeliverable, full.detail], ["soft", false, "bounce/5.2.2"]);
	assert.equal(getEventPlan({ ...full, email: "reader@example.org" }).suppression, null);

	const disabled = parse({ status: "5.2.1", diagnostic: "smtp; 550 5.2.1 The email account that you tried to reach is disabled." });
	assert.deepEqual([disabled.bounce, disabled.undeliverable], ["hard", false], "suppressed for the account, not for every account");

	const worded = parse({ status: "5.0.0", diagnostic: "smtp; 550 Requested action not taken: user unknown" });
	assert.equal(worded.bounce, "hard", "a server that only says it in words");

	const unsolicited = parse({ status: "5.7.1", diagnostic: "smtp; 550-5.7.1 Our system has detected that this message is likely unsolicited mail. For more information, go to https://support.google.com/mail/?p=UnsolicitedMessageError" });
	assert.equal(unsolicited.bounce, "soft");
	assert.equal(getEventPlan({ ...unsolicited, email: "reader@gmail.com" }).isRefusal, true, "counts against its send like any provider's");

	const unsigned = parse({ status: "5.7.26", diagnostic: "smtp; 550-5.7.26 This mail has been blocked because the sender is unauthenticated." });
	assert.equal(unsigned.bounce, "soft", "the sender's own problem says nothing about the address");

	const noStatus = parse({ status: "", diagnostic: "smtp; 554 delivery error" });
	assert.deepEqual([noStatus.bounce, noStatus.detail], ["soft", "bounce/unknown"]);
});

test("only a failure counts: Gmail still trying, or a delivery receipt, is nothing", async () => {
	const original = await buildEmail();
	const delayed = buildBounce(original, { action: "delayed", status: "4.7.28", diagnostic: "smtp; 421-4.7.28 Gmail has detected an unusual rate of mail originating from your SPF domain." });
	assert.equal(parseBounce(delayed), null, "anyone could write it, and it would pause the newsletter");
	for (const action of ["delivered", "relayed", "expanded"]) assert.equal(parseBounce(buildBounce(original, { action, status: "2.0.0" })), null, action);
});

test("a bounce read from the inbox only suppresses its own address: no spam trap block, refusal, backoff or listing for every account", async () => {
	const base = { accountId: ACCOUNT, messageId: MESSAGE, email: "reader@gmail.com", isForgeable: true };
	const trap = getEventPlan({ ...base, type: "bounce", bounce: "hard", undeliverable: true, reason: "5.1.1 550 spamtrap hit", detail: "bounce/5.1.1" });
	assert.equal(trap.isSpamTrap, false);
	assert.equal(trap.globalSuppression, null);
	assert.deepEqual(trap.suppression.emails, ["reader@gmail.com"]);
	const refused = getEventPlan({ ...base, type: "bounce", bounce: "soft", reason: "5.7.1 likely unsolicited mail. UnsolicitedMessageError" });
	assert.equal(refused.isRefusal, false);
	assert.equal(getEventPlan({ ...base, type: "deferred", reason: "4.7.28 Gmail has detected an unusual rate" }).rateLimit, null);

	const { isForgeable, ...trusted } = base;
	assert.equal(isForgeable, true);
	assert.equal(getEventPlan({ ...trusted, type: "bounce", bounce: "hard", reason: "550 spamtrap hit" }).isSpamTrap, true, "providers' own events still do");
});

test("Gmail's answers become outcomes: a refused login pauses, a full day or a busy server waits, a lost connection retries", () => {
	const smtp = (fields, message = "Refused") => Object.assign(new Error(message), fields);
	const outcome = (error) => toSendError(error).outcome;

	const login = toSendError(smtp({ code: "EAUTH", responseCode: 535, response: "535-5.7.8 Username and Password not accepted." }));
	assert.equal(login.outcome, SEND_OUTCOMES.misconfigured);
	assert.equal(getSendErrorAction(login), "pause");
	assert.match(login.message, /WORKSPACE_APP_PASSWORD/);

	const daily = toSendError(smtp({ code: "EMESSAGE", responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded." }));
	assert.deepEqual([daily.outcome, daily.retryAfter], [SEND_OUTCOMES.throttled, 3600]);
	const busy = toSendError(smtp({ code: "EENVELOPE", responseCode: 421, response: "421 4.7.0 Try again later, closing connection." }));
	assert.deepEqual([busy.outcome, busy.retryAfter, getSendErrorAction(busy)], [SEND_OUTCOMES.throttled, 300, "retry"]);

	for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET"]) {
		assert.equal(isConnectionError(smtp({ code })), true, code);
		assert.equal(outcome(smtp({ code })), SEND_OUTCOMES.unavailable, code);
	}
	assert.equal(isConnectionError(smtp({ code: "ESOCKET", responseCode: 550 })), false, "the server answered");

	const refused = toSendError(smtp({ code: "EENVELOPE", responseCode: 553, response: "553 5.1.3 The recipient address is not a valid RFC 5321 address." }));
	assert.equal(refused.outcome, SEND_OUTCOMES.failed);
	assert.equal(getSendErrorAction(refused), "fail");
	assert.equal(outcome(new Error("Something else")), SEND_OUTCOMES.failed);
	assert.equal(toSendError(daily), daily, "already an outcome");
	assert.ok(toSendError(smtp({ responseCode: 550, response: "x".repeat(500) })).detail.length <= 200);
});

test("the mailbox has room again once its oldest email leaves the last 24 hours, looked at again every hour until then", () => {
	const now = Date.parse("2026-11-13T12:00:00Z");
	assert.equal(getRetryAfter(new Date(now - 23.5 * 3_600_000), now), 1860);
	assert.equal(getRetryAfter(new Date(now - 60_000), now), 3600, "an hour at most, then it looks again");
	assert.equal(getRetryAfter(new Date(now - 25 * 3_600_000), now), 60, "never a loop");
	assert.equal(getRetryAfter(null, now), 60);
});

test("a domain is ready once Google's DKIM key is in DNS, under the selector the Admin console used", () => {
	assert.equal(getDkimHost("example.com", {}), "google._domainkey.example.com");
	assert.equal(getDkimHost("example.com", { WORKSPACE_DKIM_SELECTOR: " News2 " }), "news2._domainkey.example.com");
	assert.equal(getDkimHost("example.com", { WORKSPACE_DKIM_SELECTOR: "a.b/c" }), "google._domainkey.example.com");

	const key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";
	assert.equal(hasDkimKey([["v=DKIM1; k=rsa; p=", key]]), true, "DNS splits a long record");
	assert.equal(hasDkimKey([`v=DKIM1; k=rsa; p=${key}`]), true);
	assert.equal(hasDkimKey([["v=DKIM1; k=rsa; p="]]), false, "a revoked key");
	assert.equal(hasDkimKey([["v=spf1 include:_spf.google.com ~all"]]), false);
	assert.equal(hasDkimKey([]), false);
	assert.equal(hasDkimKey(null), false);
});

test("the Domains page tells where Google makes the DKIM record, and lists no return path", () => {
	const domain = { domain: "example.com", mailFromDomain: "example.com", provider: "workspace", dkimStatus: "PENDING", mailFromStatus: "SUCCESS", records: [] };
	const setup = getDomainSetup(domain);
	assert.deepEqual(setup.map(({ key }) => key), ["dkim", "dmarc"]);
	assert.match(setup[0].description, /Google Admin console/);
	assert.deepEqual(setup[0].records, []);
	assert.deepEqual(getDomainSetup({ ...domain, provider: "ses" }).map(({ key }) => key), ["dkim", "mail-from", "dmarc"]);
});
