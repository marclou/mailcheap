import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import mongoose from "mongoose";
import { addVerifiedDomain, as, callApi, catchRedirect, form, jsonRequest, mockStripe, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";

// A self-hosted server: no MAILCHEAP_CLOUD, no Stripe keys, no shared domain, and sign-in limited to
// ALLOWED_EMAILS and ADMIN_EMAILS. Google answers in memory.
const ALLOWED = "owner@example.com, @team.example.org";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

let app;
let m;
let processed = 0;
let stripeCalls;
let nextId = 0;

async function runJobs() {
	const results = [];
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (!url.endsWith("/api/jobs/send-batch")) continue;
		results.push(await (await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }))).json());
	}
	return results;
}

async function createKey(user) {
	return (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
}

async function callTool(key, name, args = {}) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${key}` },
		body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name, arguments: args }, id: ++nextId }),
	});
	const response = await m.mcpRoute.POST(request);
	const text = await response.text();
	const data = text.split("\n").find((line) => line.startsWith("data: "));
	return { status: response.status, ...JSON.parse(data ? data.slice(6) : text) };
}

function visit(path, { cookie } = {}) {
	const request = new m.NextRequest(new URL(path, "http://localhost:3000"), { headers: { host: "localhost:3000", ...(cookie && { cookie }) } });
	return m.proxy(request);
}

// What the proxy decided: render the page asked for, render another one in its place, or redirect.
function outcome(response) {
	const rewrite = response.headers.get("x-middleware-rewrite");
	if (rewrite) return { rewrite: new URL(rewrite).pathname };
	if (response.headers.get("x-middleware-next")) return { next: true };
	return { status: response.status, location: response.headers.get("location") };
}

function cookieOf(user) {
	return [...user.jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function countUsers(email) {
	return mongoose.connection.db.collection("users").countDocuments({ email });
}

function idToken(claims) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	return [encode({ alg: "RS256", kid: "test" }), encode({ iss: "https://accounts.google.com", aud: "google-client", iat: now, exp: now + 3600, ...claims }), "c2lnbmF0dXJl"].join(".");
}

// The way a browser goes through Google: the button's redirect, Google's consent, then the callback with a
// code, which Better Auth trades at Google's token endpoint for the account's ID token.
async function signInWithGoogle({ email, verified = true, sub = email }) {
	const visitor = { jar: new Map(), ip: "198.51.100.90" };
	const url = new URL(await as(visitor, () => catchRedirect(m.signin.signinWithGoogle(form({ next: "/" })))));
	assert.equal(url.host, "accounts.google.com");
	const previousFetch = globalThis.fetch;
	globalThis.fetch = (input, init) =>
		String(input?.url ?? input) === GOOGLE_TOKEN_URL
			? Promise.resolve(Response.json({ access_token: "ya29.test", token_type: "Bearer", expires_in: 3599, scope: "openid email profile", id_token: idToken({ sub, email, email_verified: verified, name: "Jo" }) }))
			: previousFetch(input, init);
	try {
		const cookie = [...visitor.jar].map(([name, value]) => `${name}=${value}`).join("; ");
		const callback = new Request(`http://localhost:3000/api/auth/callback/google?code=test-code&state=${url.searchParams.get("state")}`, { headers: { cookie } });
		const response = await as(visitor, () => m.authRoute.GET(callback));
		const location = new URL(response.headers.get("location"), "http://localhost:3000");
		const cookies = response.headers.getSetCookie().filter((line) => line.startsWith("better-auth.session_token=") && !line.startsWith("better-auth.session_token=;"));
		return { status: response.status, path: location.pathname, error: location.searchParams.get("error"), isSignedIn: cookies.length > 0 };
	} finally {
		globalThis.fetch = previousFetch;
	}
}

before(async () => {
	app = await startTestApp({
		MAILCHEAP_CLOUD: "",
		STRIPE_SECRET_KEY: "",
		STRIPE_WEBHOOK_SECRET: "",
		SHARED_DOMAIN: "",
		ALLOWED_EMAILS: ALLOWED,
		ADMIN_EMAILS: "admin@example.com",
		EMAIL_FROM: "MailCheap <login@mail.example.com>",
		GOOGLE_CLIENT_ID: "google-client",
		GOOGLE_CLIENT_SECRET: "google-secret",
		QSTASH_CURRENT_SIGNING_KEY: "sig-current",
		QSTASH_NEXT_SIGNING_KEY: "sig-next",
	});
	m = {
		auth: await import("../lib/auth.js"),
		signin: await import("../app/signin/actions.js"),
		authRoute: await import("../app/api/auth/[...all]/route.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		billingActions: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		stripeWebhook: await import("../app/api/webhooks/stripe/route.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
		sitemap: (await import("../app/sitemap.js")).default,
		docs: await import("../lib/docs/llms.js"),
		help: await import("../lib/help.js"),
		accountState: await import("../lib/account-state.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
	};
});

beforeEach(() => {
	stripeCalls = [];
	mockStripe((request) => {
		stripeCalls.push(request);
		return { status: 500, error: { type: "api_error", message: "Stripe isn't used on a self-hosted server" } };
	});
});

after(() => app?.stop());

describe("billing is off", () => {
	test("an allowed user gets the dashboard right after signing in: no plan picker, no Stripe", async () => {
		const user = await signIn("owner@example.com");
		const { account } = await as(user, () => m.auth.requireAccount());
		assert.equal(String(account._id), String(user.accountId));
		assert.equal(account.subscriptionStatus, undefined, "no plan, and none needed");
		assert.equal(m.accountState.getAccountStatus(account), "active");
		assert.equal(await as(user, () => catchRedirect(m.checkoutRoute.GET(new Request("http://localhost:3000/billing/checkout?plan=growth")))), "/billing?interval=month");
		assert.equal(stripeCalls.length, 0);
	});

	test("a send far past every plan's emails and subscribers goes out in full, and still counts; so do welcome emails", async () => {
		const user = await signIn("sender@team.example.org");
		await addVerifiedDomain(user, "self-hosted.dev");
		const settings = { name: "Notes", slug: "self-notes", fromName: "Jo", fromEmail: "hello@self-hosted.dev", postalAddress: "1 Main St, Paris" };
		const welcome = { welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeMarkdown: "Thanks for joining." };
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ ...settings, ...welcome }))));
		const newsletterId = url.split("/").at(-1);
		const rows = ["a", "b", "c"].map((name) => ({ email: `${name}@readers.example.org`, status: "active" }));
		await as(user, () => m.contacts.importContacts({ newsletterId, consent: true, rows }));
		await m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.emailsSent": 50_000_000 } });

		const draftUrl = await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)));
		const id = draftUrl.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const [batch] = await runJobs();
		assert.equal(batch.sent, 3);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
		assert.equal((await m.Account.findById(user.accountId).lean()).usage.emailsSent, 50_000_003);

		const key = await createKey(user);
		const overview = await callApi("GET", "/api/v1/overview", { key });
		assert.equal(overview.status, 200);
		assert.deepEqual([overview.body.usage.emailsLimit, overview.body.usage.emailsLeft, overview.body.usage.subscribersLimit], [null, null, null]);
		assert.equal(overview.body.usage.welcomeEmailsPaused, false);

		assert.equal((await callApi("POST", "/api/v1/contacts", { key, body: { email: "new@readers.example.org" } })).status, 201);
		await flushAfter();
		const message = await m.Message.findOne({ accountId: user.accountId, kind: "welcome" }).lean();
		assert.equal(message.status, "sent");
		assert.equal((await m.Account.findById(user.accountId).lean()).usage.emailsSent, 50_000_004);
	});

	test("there's no warm-up: a send far over anything sent before goes out at full speed", async () => {
		const user = await signIn("first-blast@team.example.org");
		await m.Account.updateOne({ _id: user.accountId }, { $unset: { spreadUntil: 1 } });
		await addVerifiedDomain(user, "blast.dev");
		const settings = { name: "Blast", slug: "blast-notes", fromName: "Jo", fromEmail: "hello@blast.dev", postalAddress: "1 Main St, Paris" };
		const newsletterId = (await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(settings))))).split("/").at(-1);
		const lastSentAt = new Date(Date.now() - 90 * 86_400_000);
		await m.Contact.insertMany(
			Array.from({ length: 300 }, (_, index) => ({ accountId: user.accountId, newsletterId, email: `reader${index}@blast.example.org`, status: "active", lastSentAt }))
		);
		const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)))).split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
		const from = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const batches = published.slice(from).filter(({ url }) => url.endsWith("/api/jobs/send-batch"));
		assert.equal(batches.length, 6);
		assert.ok(batches.every(({ notBefore }) => notBefore === undefined));
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).spreadHours, undefined);
		assert.equal((await m.Account.findById(user.accountId).lean()).spreadUntil, undefined);
		await runJobs();
	});

	test("billing says it's off through the dashboard, the REST API and MCP, and the Stripe webhook is closed", async () => {
		const user = await signIn("billing@team.example.org");
		const key = await createKey(user);
		for (const [method, path, body] of [
			["GET", "/api/v1/billing"],
			["POST", "/api/v1/billing/change-plan", { plan: "growth" }],
			["POST", "/api/v1/billing/portal"],
		]) {
			const response = await callApi(method, path, { key, body });
			assert.equal(response.status, 404, path);
			assert.equal(response.body.error.code, "billing_off", path);
			assert.match(response.body.error.message, /^Billing is off on this server/);
		}
		for (const tool of ["get_billing", "change_plan", "open_billing_portal"]) {
			const { result } = await callTool(key, tool, tool === "change_plan" ? { plan: "growth" } : {});
			assert.equal(result.isError, true, tool);
			assert.equal(JSON.parse(result.content[0].text).error.code, "billing_off", tool);
		}
		assert.equal(await as(user, () => catchRedirect(m.billingActions.choosePlan(form({ plan: "growth" })))), "/billing");
		assert.equal(await as(user, () => catchRedirect(m.billingActions.openBillingPortal())), "/billing");

		const webhook = await m.stripeWebhook.POST(new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", body: "{}" }));
		assert.equal(webhook.status, 404);
		assert.equal(stripeCalls.length, 0);
	});
});

describe("sign-in allowlist", () => {
	test("codes go to ALLOWED_EMAILS addresses, its @domains and ADMIN_EMAILS, and to nobody else", async () => {
		const emailsBefore = platformEmails.length;
		for (const email of ["owner@example.com", "anyone@team.example.org", "admin@example.com", "Owner@Example.com"]) {
			const visitor = { jar: new Map(), ip: `198.51.100.${10 + nextId++}` };
			assert.deepEqual(await as(visitor, () => m.signin.sendSigninCode(null, form({ email }))), { email: email.toLowerCase() }, email);
		}
		assert.equal(platformEmails.length - emailsBefore, 4);

		for (const email of ["stranger@example.com", "owner@example.com.evil.dev", "someone@sub.team.example.org", "team.example.org@evil.dev"]) {
			const visitor = { jar: new Map(), ip: `198.51.100.${10 + nextId++}` };
			assert.deepEqual(await as(visitor, () => m.signin.sendSigninCode(null, form({ email }))), { error: m.auth.SIGNIN_NOT_ALLOWED_MESSAGE }, email);
		}
		assert.equal(platformEmails.length - emailsBefore, 4, "no code went out");
	});

	test("a code is never checked for an address off the list, and no user is created", async () => {
		const visitor = { jar: new Map(), ip: "198.51.100.120" };
		const result = await as(visitor, () => m.signin.verifySigninCode(null, form({ email: "stranger@example.com", code: "123456" })));
		assert.deepEqual(result, { email: "stranger@example.com", error: m.auth.SIGNIN_NOT_ALLOWED_MESSAGE });
		assert.equal(await countUsers("stranger@example.com"), 0);
	});

	test("Better Auth's own routes can't send a code, sign in or sign up", async () => {
		const routes = [
			["/api/auth/email-otp/send-verification-otp", { email: "stranger@example.com", type: "sign-in" }],
			["/api/auth/sign-in/email-otp", { email: "stranger@example.com", otp: "123456" }],
			["/api/auth/sign-up/email", { email: "stranger@example.com", password: "a-long-password-1234", name: "Stranger" }],
		];
		for (const [path, body] of routes) {
			const response = await m.authRoute.POST(jsonRequest(path, { method: "POST", body, headers: { origin: "http://localhost:3000" } }));
			assert.ok(response.status >= 400, `${path} answered ${response.status}`);
		}
		assert.equal(await countUsers("stranger@example.com"), 0);
	});

	test("Google: an address off the list is refused before any user exists; an allowed one signs in", async () => {
		const refused = await signInWithGoogle({ email: "stranger@example.com" });
		assert.deepEqual(refused, { status: 302, path: "/signin", error: m.auth.SIGNIN_NOT_ALLOWED, isSignedIn: false });
		assert.equal(await countUsers("stranger@example.com"), 0);

		const allowed = await signInWithGoogle({ email: "google@team.example.org" });
		assert.deepEqual(allowed, { status: 302, path: "/", error: null, isSignedIn: true });
		const user = await mongoose.connection.db.collection("users").findOne({ email: "google@team.example.org" });
		assert.equal(user.emailVerified, true);
		assert.ok(await m.Account.exists({ ownerId: user._id }), "the account comes with the user");
	});

	test("Google: an address Google hasn't verified neither signs up nor joins the user who owns it", async () => {
		const unverified = await signInWithGoogle({ email: "unverified@team.example.org", verified: false });
		assert.equal(unverified.isSignedIn, false);
		assert.equal(await countUsers("unverified@team.example.org"), 0);

		await signIn("linked@team.example.org");
		const takeover = await signInWithGoogle({ email: "linked@team.example.org", verified: false, sub: "attacker" });
		assert.equal(takeover.isSignedIn, false);
		assert.equal(takeover.path, "/signin");
		const owner = await signInWithGoogle({ email: "linked@team.example.org", verified: true, sub: "owner-google" });
		assert.equal(owner.isSignedIn, true, "Google verified the email: same user");
	});

	test("Better Auth's internals refuse a user or a session for an address off the list", async () => {
		const context = await (await m.auth.getAuth()).$context;
		await assert.rejects(
			context.internalAdapter.createUser({ email: "inside@example.com", emailVerified: true, name: "" }, { method: "email-otp" }),
			(error) => error.body?.code === m.auth.SIGNIN_NOT_ALLOWED
		);
		const { insertedId } = await mongoose.connection.db
			.collection("users")
			.insertOne({ email: "before-the-list@example.com", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() });
		await assert.rejects(context.internalAdapter.createSession(String(insertedId)), (error) => error.body?.code === m.auth.SIGNIN_NOT_ALLOWED);
		assert.equal(await mongoose.connection.db.collection("sessions").countDocuments({ userId: insertedId }), 0);
	});

	test("an address taken off the list is signed out at its next request, and its API keys stop working", async () => {
		const user = await signIn("leaving@team.example.org");
		const key = await createKey(user);
		assert.ok(await as(user, () => m.auth.getCurrentAccount()));
		await withEnv({ ALLOWED_EMAILS: "owner@example.com" }, async () => {
			assert.equal(await as(user, () => m.auth.getCurrentAccount()), null);
			assert.equal(await as(user, () => catchRedirect(m.auth.requireAccount())), "/signin");
			assert.equal((await callApi("GET", "/api/v1/campaigns", { key })).status, 401);
			assert.equal((await callTool(key, "list_campaigns")).status, 401, "MCP refuses the key too");
		});
		assert.ok(await as(user, () => m.auth.getCurrentAccount()), "back on the list");
		assert.equal((await callApi("GET", "/api/v1/campaigns", { key })).status, 200);
		assert.equal((await callTool(key, "list_campaigns")).status, 200);
	});

	test("never open by default: with both lists empty, nobody gets a code", async () => {
		await withEnv({ ALLOWED_EMAILS: "", ADMIN_EMAILS: "" }, async () => {
			const visitor = { jar: new Map(), ip: "198.51.100.130" };
			assert.deepEqual(await as(visitor, () => m.signin.sendSigninCode(null, form({ email: "owner@example.com" }))), { error: m.auth.SIGNIN_NOT_ALLOWED_MESSAGE });
		});
	});
});

describe("public pages", () => {
	test("/ is the dashboard, or sign-in without a session; the docs and what search engines read open without one", async () => {
		assert.deepEqual(outcome(await visit("/")), { status: 307, location: "http://localhost:3000/signin" });
		const user = await signIn("pages@team.example.org");
		assert.deepEqual(outcome(await visit("/", { cookie: cookieOf(user) })), { next: true });
		for (const path of ["/signin", "/docs", "/docs/mcp", "/help", "/help/sending", "/llms.txt", "/sitemap.xml", "/robots.txt", "/opengraph-image-12o0cb", "/api/health"]) {
			assert.deepEqual(outcome(await visit(path)), { next: true }, path);
		}
	});

	test("the sitemap lists the docs and the help center, without the articles about plans and the warm-up", () => {
		const urls = m.sitemap().map(({ url }) => url);
		const help = ["/help", ...m.help.HELP_ARTICLES.filter(({ isCloudOnly }) => !isCloudOnly).map(({ slug }) => `/help/${slug}`)];
		assert.deepEqual(urls, [...m.docs.DOC_PAGES.map(({ href }) => href), ...help].map((path) => `http://localhost:3000${path}`));
		assert.ok(!urls.some((url) => url.endsWith("/help/warm-up") || url.endsWith("/help/plans")));
	});
});
