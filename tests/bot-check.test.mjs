import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { withBotId } from "botid/next/config";
import { BOTID_SIGNIN, BOTID_WEBSITE, isBotRequest } from "../lib/bot-check.js";
import { activate, anonymous, as, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { botIdChecks, setBotIdVerdict } from "./stubs/botid-server.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

const ON_VERCEL = { VERCEL: "1" };

afterEach(() => setBotIdVerdict("human"));

function quiet(t) {
	t.mock.method(console, "warn", () => {});
	t.mock.method(console, "error", () => {});
}

// BotID's rule for the paths it covers: a * stands for anything, slashes included.
function covers(protect, path) {
	const escape = (text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	return protect.some((rule) => rule.method === "POST" && new RegExp(`^${rule.path.split("*").map(escape).join(".*")}$`).test(path));
}

test("BotID only runs on Vercel, refuses only what it calls a bot, and lets the form through when its check fails", async (t) => {
	quiet(t);
	setBotIdVerdict("bot");
	const checks = botIdChecks.length;
	assert.equal(await isBotRequest("signup"), false, "a self-hosted server never asks");
	assert.equal(botIdChecks.length, checks);

	await withEnv(ON_VERCEL, async () => {
		assert.equal(await isBotRequest("signup"), true);
		setBotIdVerdict("human");
		assert.equal(await isBotRequest("signup"), false);
		setBotIdVerdict("error");
		assert.equal(await isBotRequest("signup"), false, "a BotID problem never costs a signup");
	});
});

test("each page's check covers its form: sign-in, and a website's signup form on any of its pages, not its page views", () => {
	assert.ok(covers(BOTID_SIGNIN, "/signin"));
	for (const path of ["/", "/p/first-issue", "/authors/jane", "/archive/field-notes", "/archive/field-notes/p/first-issue"]) {
		assert.ok(covers(BOTID_WEBSITE, path), path);
	}
	for (const path of ["/api/views", "/api/unsubscribe", "/confirm", "/keep"]) assert.ok(!covers(BOTID_WEBSITE, path), path);
});

test("next.config adds BotID's paths only on Vercel, with frame headers that come after the site's", async () => {
	const local = (await import("../next.config.mjs?local")).default;
	assert.equal(local.rewrites, undefined, "nothing of BotID off Vercel");

	const onVercel = await withEnv(ON_VERCEL, async () => (await import("../next.config.mjs?vercel")).default);
	const sources = (await onVercel.rewrites()).map(({ source }) => source);
	assert.ok(sources.length > 0 && sources.every((source) => source.startsWith("/149e9513-")), sources.join(", "));
	const headers = await onVercel.headers();
	const last = headers.findLast(({ source }) => source.startsWith("/149e9513-"));
	assert.equal(headers.at(-1), last, "BotID's frame headers win over the site's frame-ancestors 'none'");
	assert.ok(last.headers.some(({ key, value }) => key === "Content-Security-Policy" && value.includes("frame-ancestors 'self'")));
});

describe("the forms BotID checks", () => {
	let app;
	let m;
	let owner;

	before(async () => {
		app = await startTestApp();
		m = {
			welcome: await import("../app/welcome/actions.js"),
			archive: await import("../app/archive/actions.js"),
			signin: await import("../app/signin/actions.js"),
			proxy: (await import("../proxy.js")).proxy,
			NextRequest: (await import("next/server")).NextRequest,
			Contact: (await import("../models/Contact.js")).default,
		};
		owner = await signIn("botid-owner@example.com");
		await activate(owner);
		await as(owner, () => catchRedirect(m.welcome.completeOnboarding(null, form({ name: "Bot notes" }))));
	});

	after(() => app?.stop());

	test("a website's signup form refuses a bot before anything is saved or sent, and takes a person's signup", async (t) => {
		quiet(t);
		const signUp = (email) => anonymous(() => m.archive.subscribe(null, form({ newsletter: "bot-notes", email })));
		await withEnv(ON_VERCEL, async () => {
			setBotIdVerdict("bot");
			assert.deepEqual(await signUp("script@example.org"), { error: "Couldn't sign you up. Try again in a minute." });
			setBotIdVerdict("human");
			assert.equal((await signUp("reader@example.org")).ok, true);
		});
		await flushAfter();
		const emails = await m.Contact.find({ accountId: owner.accountId }).distinct("email");
		assert.ok(emails.includes("reader@example.org"));
		assert.ok(!emails.includes("script@example.org"));
	});

	test("the sign-in form sends no code to a bot, with the same answer as a failed send, and one to a person", async (t) => {
		quiet(t);
		const visitor = { jar: new Map(), ip: "203.0.113.77" };
		const ask = (email) => as(visitor, () => m.signin.sendSigninCode(null, form({ email })));
		const codesTo = (email) => platformEmails.filter(({ to }) => to.includes(email)).length;
		await withEnv(ON_VERCEL, async () => {
			setBotIdVerdict("bot");
			assert.deepEqual(await ask("botid-script@example.com"), { error: "Couldn't send the code. Try again in a minute." });
			setBotIdVerdict("human");
			assert.deepEqual(await ask("botid-person@example.com"), { email: "botid-person@example.com" });
		});
		assert.equal(codesTo("botid-script@example.com"), 0);
		assert.equal(codesTo("botid-person@example.com"), 1);
	});

	test("BotID's script and calls pass the proxy on a newsletter's host and without a session", async () => {
		const sources = (await withBotId({}).rewrites()).map(({ source }) => source.replace(":path*", "p.js"));
		for (const path of sources) {
			for (const host of ["bot-notes.mailcheapmail.com", "localhost:3000"]) {
				const response = await m.proxy(new m.NextRequest(`https://${host}${path}`, { headers: { host } }));
				assert.equal(response.headers.get("x-middleware-next"), "1", `${host}${path}`);
			}
		}
	});
});
