import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdminAlertEmails, getAdminEmails, getConfigProblems, getUrgentReplyTo, isEmailAllowed } from "../lib/config.js";
import { register } from "../instrumentation.js";

const STRONG = { BETTER_AUTH_SECRET: "s".repeat(32), SUPPRESSION_HASH_KEY: "k".repeat(32) };
const CLOUD = { ...STRONG, MAILCHEAP_CLOUD: "true", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", RESEND_API_KEY: "re_x" };

async function withEnv(values, run) {
	const previous = { ...process.env };
	try {
		for (const name of ["MAILCHEAP_CLOUD", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"]) delete process.env[name];
		Object.assign(process.env, values);
		return await run();
	} finally {
		process.env = previous;
	}
}

test("BETTER_AUTH_SECRET and SUPPRESSION_HASH_KEY need 32 characters each", () => {
	assert.deepEqual(getConfigProblems(STRONG), []);
	assert.deepEqual(getConfigProblems({ ...STRONG, BETTER_AUTH_SECRET: "s".repeat(31) }), [
		"BETTER_AUTH_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48).",
	]);
	assert.deepEqual(getConfigProblems({ ...STRONG, SUPPRESSION_HASH_KEY: "k".repeat(31) }), [
		"SUPPRESSION_HASH_KEY must be at least 32 characters (generate one with: openssl rand -base64 48).",
	]);
	assert.equal(getConfigProblems({}).length, 2, "missing counts as too short");
});

test("the server doesn't start with a short secret or hash key", () =>
	withEnv(STRONG, () => {
		assert.doesNotThrow(register);
		process.env.SUPPRESSION_HASH_KEY = "short";
		assert.throws(register, /MailCheap can't start\. SUPPRESSION_HASH_KEY must be at least 32 characters/);
		process.env.SUPPRESSION_HASH_KEY = STRONG.SUPPRESSION_HASH_KEY;
		process.env.BETTER_AUTH_SECRET = "short";
		assert.throws(register, /MailCheap can't start\. BETTER_AUTH_SECRET must be at least 32 characters/);
	}));

test("MailCheap Cloud needs both Stripe keys and RESEND_API_KEY; a self-hosted server needs none of them", () => {
	assert.deepEqual(getConfigProblems(CLOUD), []);
	for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"]) {
		const problems = getConfigProblems({ ...CLOUD, [name]: " " });
		assert.equal(problems.length, 1, name);
		assert.match(problems[0], new RegExp(`MAILCHEAP_CLOUD is true, so ${name} has to be set`));
	}
	assert.match(
		getConfigProblems({ ...STRONG, MAILCHEAP_CLOUD: "true" })[0],
		/so STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY have to be set: the cloud bills through Stripe and sends its own emails through Resend/
	);
	assert.deepEqual(getConfigProblems(STRONG), [], "self-hosted: no Stripe, no Resend");
	assert.deepEqual(getConfigProblems({ ...STRONG, MAILCHEAP_CLOUD: "yes" }), [], "only exactly true is the cloud");
});

test("the cloud refuses to start without Stripe or Resend, and its health check fails with the reason", async () => {
	const { GET } = await import("../app/api/health/route.js");
	await withEnv(CLOUD, async () => {
		assert.doesNotThrow(register);
		const healthy = await GET();
		assert.equal(healthy.status, 200);
		assert.deepEqual(await healthy.json(), { ok: true });
		assert.equal(healthy.headers.get("cache-control"), "no-store");

		delete process.env.STRIPE_SECRET_KEY;
		assert.throws(register, /MailCheap can't start\. MAILCHEAP_CLOUD is true, so STRIPE_SECRET_KEY has to be set/);
		const failing = await GET();
		assert.equal(failing.status, 503);
		const body = await failing.json();
		assert.equal(body.ok, false);
		assert.match(body.problems[0], /STRIPE_SECRET_KEY has to be set/);
		assert.equal(JSON.stringify(body).includes("whsec_x") || JSON.stringify(body).includes("re_x"), false, "never a value");
	});
});

test("a self-hosted server signs in ALLOWED_EMAILS, its @domains and ADMIN_EMAILS, and nobody when both are empty", () => {
	const env = { ALLOWED_EMAILS: " Jane@Example.com, @Team.example.org ,", ADMIN_EMAILS: "ops@example.net" };
	for (const email of ["jane@example.com", "JANE@example.com ", "anyone@team.example.org", "ops@example.net"]) {
		assert.equal(isEmailAllowed(email, env), true, email);
	}
	for (const email of ["john@example.com", "x@sub.team.example.org", "team.example.org@evil.dev", "@team.example.org", "jane@example.com.evil.dev", "jane@", "", null]) {
		assert.equal(isEmailAllowed(email, env), false, String(email));
	}
	assert.equal(isEmailAllowed("jane@example.com", {}), false, "never open by default");
	assert.equal(isEmailAllowed("anyone@anywhere.dev", { MAILCHEAP_CLOUD: "true" }), true, "MailCheap Cloud takes anyone");
});

test("ADMIN_EMAILS is a comma-separated list, trimmed and lowercased", () => {
	const previous = process.env.ADMIN_EMAILS;
	try {
		process.env.ADMIN_EMAILS = " Owner@Example.com, ops@example.org ,,";
		assert.deepEqual(getAdminEmails(), ["owner@example.com", "ops@example.org"]);
		delete process.env.ADMIN_EMAILS;
		assert.deepEqual(getAdminEmails(), []);
	} finally {
		if (previous === undefined) delete process.env.ADMIN_EMAILS;
		else process.env.ADMIN_EMAILS = previous;
	}
});

test("ADMIN_ALERT_EMAILS is where the admins' alerts are emailed, and without an address in it, ADMIN_EMAILS", () => {
	const admins = { ADMIN_EMAILS: "signin@example.com" };
	assert.deepEqual(getAdminAlertEmails({ ...admins, ADMIN_ALERT_EMAILS: " Inbox@Example.org, second@example.net ,," }), ["inbox@example.org", "second@example.net"]);
	assert.deepEqual(getAdminAlertEmails({ ...admins, ADMIN_ALERT_EMAILS: "inbox@example.org, inbox" }), ["inbox@example.org"], "what isn't an address is left out");
	for (const value of [undefined, "", " , ", "inbox", "Inbox <inbox@example.org>", "inbox at example.org", "inbox@example.org\r\nBcc: other@example.net"]) {
		assert.deepEqual(getAdminAlertEmails({ ...admins, ADMIN_ALERT_EMAILS: value }), ["signin@example.com"], String(value));
	}
	assert.deepEqual(getAdminAlertEmails({}), [], "nobody, without either");
});

test("URGENT_REPLY_TO is where replies to an owner's urgent emails go, and anything that isn't one address leaves the usual one", () => {
	assert.equal(getUrgentReplyTo({ MAILCHEAP_CLOUD: "true", URGENT_REPLY_TO: " owner-help@example.com " }), "owner-help@example.com");
	assert.equal(getUrgentReplyTo({ MAILCHEAP_CLOUD: "true" }), "hello@mailcheap.ai", "support's, without one");
	for (const value of ["owner-help", "Owner <owner-help@example.com>", "a@example.com, b@example.com", "owner help@example.com"]) {
		assert.equal(getUrgentReplyTo({ MAILCHEAP_CLOUD: "true", URGENT_REPLY_TO: value }), "hello@mailcheap.ai", value);
	}
	assert.equal(getUrgentReplyTo({ URGENT_REPLY_TO: "owner-help@example.com" }), "owner-help@example.com", "a self-hosted server too");
	assert.equal(getUrgentReplyTo({}), null, "else EMAIL_FROM gets the replies there");
});
