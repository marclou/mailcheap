import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { ADMIN_ALERTS, isDashboardAlert, isTelegramAlert } from "../lib/alert-rules.js";
import { getTeamStatusAlerts } from "../lib/email-provider/postshiba-rules.js";
import { escapeTelegramHtml, formatTelegramAlert, isTelegramConfigured } from "../lib/telegram.js";
import { findAlertCalls, isAdminAlert, kindsOf } from "./helpers/alert-calls.mjs";
import { activate, answerTelegram, as, catchRedirect, form, platformEmails, signIn, startTestApp, telegramMessages, withEnv } from "./helpers/app.mjs";
import { POSTSHIBA_ENV, createFakePostshiba } from "./helpers/postshiba.mjs";
import { failNextPublish } from "./stubs/dns-broker.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// The admins' alerts on Telegram: which ones go there, how they read, how often, and nothing at all without both
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. tests/helpers/app.mjs records the Bot API's requests; none leaves.
const TELEGRAM = { TELEGRAM_BOT_TOKEN: "123456:test-bot-token-never-logged", TELEGRAM_CHAT_ID: "424242" };
const NO_TELEGRAM = { TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" };
const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const ACCOUNT_ID = "6a0000000000000000000001";
const HOUR = 3_600_000;
let app;
let fake;
let m;
let visitors = 0;

function isClassified(kind) {
	return Object.hasOwn(ADMIN_ALERTS, kind) || (kind.endsWith("-") && Object.keys(ADMIN_ALERTS).some((known) => known.startsWith(kind)));
}

function firstLines(messages) {
	return messages.map(({ text }) => text.split("\n")[0]);
}

function toAdmins(emails) {
	return emails.filter(({ to }) => to.includes("admin@example.com"));
}

async function quietly(run) {
	const error = console.error;
	console.error = () => {};
	try {
		return await run();
	} finally {
		console.error = error;
	}
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	fake = createFakePostshiba();
	fake.install();
	m = {
		alerts: await import("../lib/alerts.js"),
		adminStats: await import("../lib/admin-stats.js"),
		blocks: await import("../lib/account-blocks.js"),
		dnsBroker: await import("../lib/dns-broker.js"),
		qstashRoute: await import("../lib/qstash-route.js"),
		signin: await import("../app/signin/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		cronRoute: await import("../app/api/cron/hourly/route.js"),
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
	};
	// An alert's cooldown is a unique index, which a new database builds in the background.
	await m.Alert.init();
});

afterEach(() => fake.state.failures.splice(0));

after(() => app?.stop());

describe("which alerts reach Telegram", () => {
	test("the admins' alerts that need them do; the others, an account's own alerts and unknown kinds don't, and those with nothing to do aren't emailed either", () => {
		const needed = [
			`account-blocked:${ACCOUNT_ID}:1792000000000`,
			"customer-blocked:6a0000000000000000000002",
			`tenant-hold:${ACCOUNT_ID}`,
			`tenant-suspend-failed:${ACCOUNT_ID}`,
			`purge-postponed:${ACCOUNT_ID}`,
			"shared-sender-failed:6a0000000000000000000002",
			"dns-helper-cap",
			"dns-helper-down",
			"inbound-cap",
			"platform-email-failed",
			"send-refused:approval_pending",
			"stripe-webhook-failed:invoice.paid",
			"job-failing:/api/jobs/send-batch",
			"postshiba-kyc:pending",
		];
		for (const key of needed) assert.equal(isTelegramAlert({ accountId: null, key }), true, key);
		const emailedOnly = [`deleted-email-signup:${ACCOUNT_ID}`, `tenant:${ACCOUNT_ID}:ENABLED`, `tenant-failed:${ACCOUNT_ID}`, "content-flagged:6a0000000000000000000003"];
		for (const key of emailedOnly) assert.deepEqual([isTelegramAlert({ accountId: null, key }), isDashboardAlert({ accountId: null, key })], [false, false], key);
		const nothingToDo = [
			"gmail-backoff:6a0000000000000000000002",
			`account-blocked-by-admin:${ACCOUNT_ID}:1792000000000`,
			"shared-sender-waiting:6a0000000000000000000002",
		];
		for (const key of nothingToDo) assert.deepEqual([isTelegramAlert({ accountId: null, key }), isDashboardAlert({ accountId: null, key })], [false, true], key);
		assert.equal(isTelegramAlert({ accountId: ACCOUNT_ID, key: "account-blocked" }), false, "the owner's copy of a block");
		assert.equal(isTelegramAlert({ accountId: ACCOUNT_ID, key: "complaints" }), false, "a complaint goes to its account's owner only");
		assert.equal(isTelegramAlert({ accountId: null, key: "something-new:1" }), false, "an unknown kind is only a record");
		const refused = { accountId: null, key: `credential-refused:${ACCOUNT_ID}` };
		assert.deepEqual([isTelegramAlert(refused), isDashboardAlert(refused)], [false, true], "one account's login refused only shows on the admin page");
		assert.equal(isDashboardAlert({ accountId: null, key: "send-refused:credential_refused" }), false, "the provider refusing several accounts' does reach them");
	});

	test("every admin alert in the code has its kind in lib/alert-rules.js", async () => {
		const unclassified = [];
		let count = 0;
		for (const { file, object } of await findAlertCalls()) {
			if (!isAdminAlert(object)) continue;
			count++;
			const kinds = kindsOf(object);
			// A key that comes from a spread is checked where it's made (getTeamStatusAlerts below).
			const isKnown = kinds.length > 0 ? kinds.some(isClassified) : /\.\.\.\w/.test(object);
			if (!isKnown) unclassified.push(`${file}: ${object.slice(0, 120)}`);
		}
		assert.ok(count >= 15, `found ${count} admin alerts`);
		assert.deepEqual(unclassified, []);
	});

	test("PostShiba's team status: a suspension, an approval still pending, a cluster at its cap and each held tenant alert", () => {
		const status = {
			suspended: true,
			kyc_status: "pending",
			clusters_at_cap: [{ id: "ClUs01", name: "outbound", hourly_remaining: 0, daily_remaining: 12, queued: 15 }],
			held_tenants: [{ id: "TnHeld", slug: `mc-${ACCOUNT_ID}` }, "TnOther"],
		};
		const alerts = getTeamStatusAlerts(status, new Map([["TnHeld", ACCOUNT_ID]]));
		assert.deepEqual(alerts.map(({ key }) => key), ["postshiba-suspended", "postshiba-kyc:pending", "postshiba-cap:ClUs01", `tenant-hold:${ACCOUNT_ID}`, "tenant-hold:TnOther"]);
		assert.ok(alerts.every(({ key }) => isTelegramAlert({ accountId: null, key })));
		assert.equal(alerts[2].detail, "outbound: 0 left this hour, 12 in 24 hours, 15 queued.");
		assert.match(alerts[3].detail, new RegExp(`holds account ${ACCOUNT_ID}'s tenant \\(operator_hold\\)`));
		assert.deepEqual(getTeamStatusAlerts({ suspended: false, kyc_status: "approved", clusters_at_cap: [], held_tenants: [] }), []);
	});
});

describe("the message", () => {
	test("the app's name in bold, the title, a blank line, then a line each: what happened, what to do, a link", () => {
		const text = formatTelegramAlert({ title: "Shared addresses paused", lines: ["The DNS helper is at its daily cap.", "", "They wait for room.", "https://mailcheap.ai/admin"] });
		assert.equal(text, "<b>MailCheap</b> · Shared addresses paused\n\nThe DNS helper is at its daily cap.\nThey wait for room.\nhttps://mailcheap.ai/admin");
		assert.equal(formatTelegramAlert({ title: "Only a title" }), "<b>MailCheap</b> · Only a title");
		assert.equal(formatTelegramAlert({ title: "Long", lines: ["x".repeat(2000)] }), `<b>MailCheap</b> · Long\n\n${"x".repeat(500)}`, "under Telegram's 4,096 characters");
	});

	test("what anyone else wrote is escaped, so it can't add tags or break Telegram's HTML", () => {
		assert.equal(escapeTelegramHtml(`<a href="x">&</a>`), `&lt;a href="x"&gt;&amp;&lt;/a&gt;`);
		const text = formatTelegramAlert({ title: "News <b>&</b> more", lines: ['<a href="https://evil.example">Jane</a> & co', "https://mailcheap.ai/?a=1&b=2"] });
		assert.equal(text, '<b>MailCheap</b> · News &lt;b&gt;&amp;&lt;/b&gt; more\n\n&lt;a href="https://evil.example"&gt;Jane&lt;/a&gt; &amp; co\nhttps://mailcheap.ai/?a=1&amp;b=2');
	});
});

describe("delivery", () => {
	test("without both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, alerts are emailed as before and Telegram gets nothing", async () => {
		assert.equal(isTelegramConfigured({}), false);
		assert.equal(isTelegramConfigured({ TELEGRAM_BOT_TOKEN: TELEGRAM.TELEGRAM_BOT_TOKEN }), false);
		assert.equal(isTelegramConfigured({ TELEGRAM_CHAT_ID: TELEGRAM.TELEGRAM_CHAT_ID }), false);
		assert.equal(isTelegramConfigured({ ...TELEGRAM, TELEGRAM_BOT_TOKEN: " " }), false);
		assert.equal(isTelegramConfigured(TELEGRAM), true);

		const before = { telegram: telegramMessages.length, emails: platformEmails.length };
		const halves = [NO_TELEGRAM, { ...NO_TELEGRAM, TELEGRAM_BOT_TOKEN: TELEGRAM.TELEGRAM_BOT_TOKEN }, { ...NO_TELEGRAM, TELEGRAM_CHAT_ID: TELEGRAM.TELEGRAM_CHAT_ID }];
		for (const [index, env] of halves.entries()) {
			await withEnv(env, () => m.alerts.sendAlert({ accountId: null, key: `account-blocked:${ACCOUNT_ID}:${index}`, title: "Account blocked", detail: "By a spam trap." }));
		}
		assert.equal(telegramMessages.length, before.telegram);
		assert.deepEqual(toAdmins(platformEmails.slice(before.emails)).map(({ subject }) => subject), Array(3).fill("[MailCheap] Account blocked"));
		assert.deepEqual(await withEnv(NO_TELEGRAM, () => m.alerts.announceTelegram()), { skipped: "Telegram isn't set up" });
	});

	test("with ADMIN_ALERT_EMAILS, the admins' alerts are emailed there and not to ADMIN_EMAILS, those that need them and those only worth a look, and an owner's still go to the owner", async () => {
		const owner = await signIn("alert-owner@example.com");
		await flushAfter();
		await withEnv({ ...NO_TELEGRAM, ADMIN_ALERT_EMAILS: "inbox@example.org" }, async () => {
			const before = platformEmails.length;
			const campaignId = "6a00000000000000000000b1";
			await m.alerts.sendAlert({ accountId: null, key: `customer-blocked:${campaignId}`, title: "A paying customer can't send", detail: "Letter (letter.example.com, Growth plan): PostShiba suspended letter.example.com." });
			await m.alerts.sendAlert({ accountId: null, key: `content-flagged:${campaignId}`, title: "Issue flagged", detail: `The content check wasn't sure about campaign ${campaignId}. It went out.` });
			await m.alerts.sendAlert({ accountId: owner.accountId, key: "complaints", title: "Spam complaint", detail: "A reader marked an email as spam." });
			assert.deepEqual(
				platformEmails.slice(before).map(({ to, subject }) => [to, subject]),
				[
					[["inbox@example.org"], "[MailCheap] A paying customer can't send"],
					[["inbox@example.org"], "[MailCheap] Issue flagged"],
					[["alert-owner@example.com"], "[MailCheap] Spam complaint"],
				]
			);
		});
	});

	test("with both, an alert that needs an admin reaches Telegram in HTML, escaped, and is emailed as before", async () => {
		await withEnv(TELEGRAM, async () => {
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			await m.alerts.sendAlert({
				accountId: null,
				key: "shared-sender-failed:format",
				title: "Shared address not set up",
				detail: 'news.mailcheapmail.com (account 1): PostShiba answered 422 <b>"taken"</b> & more.',
				action: "The newsletter's next save or send tries again.",
				path: "/admin",
			});
			const sent = telegramMessages.slice(before.telegram);
			assert.equal(sent.length, 1);
			const { text, ...request } = sent[0];
			assert.deepEqual(request, { token: TELEGRAM.TELEGRAM_BOT_TOKEN, chat_id: TELEGRAM.TELEGRAM_CHAT_ID, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
			const lines = ["news.mailcheapmail.com (account 1): PostShiba answered 422 <b>\"taken\"</b> & more.", "The newsletter's next save or send tries again.", "http://localhost:3000/admin"];
			assert.equal(text, `<b>MailCheap</b> · Shared address not set up\n\n${lines.map(escapeTelegramHtml).join("\n")}`);
			const [email] = toAdmins(platformEmails.slice(before.emails));
			assert.equal(email.subject, "[MailCheap] Shared address not set up");
			assert.equal(email.text, ["Shared address not set up", ...lines].join("\n"), "the email as it was, with what to do on its own line");
		});
	});

	test("the same alert reaches Telegram at most once every 6 hours, two at once included, whatever its email's cooldown", async () => {
		await withEnv(TELEGRAM, async () => {
			const alert = { accountId: null, key: "inbound-cap", title: "Forwards from MailCheap's inboxes paused", detail: "Over 200 emails in 24 hours.", cooldownMinutes: 0 };
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			await Promise.all([m.alerts.sendAlert(alert), m.alerts.sendAlert(alert)]);
			await m.alerts.sendAlert(alert);
			assert.equal(telegramMessages.length - before.telegram, 1, "once");
			assert.ok(toAdmins(platformEmails.slice(before.emails)).length >= 2, "while each email follows its own cooldown");

			const sentAgo = (ms) => m.Alert.updateOne({ accountId: null, key: alert.key }, { $set: { telegramSentAt: new Date(Date.now() - ms) } });
			await sentAgo(6 * HOUR - 60_000);
			await m.alerts.sendAlert(alert);
			assert.equal(telegramMessages.length - before.telegram, 1, "not before 6 hours");
			await sentAgo(6 * HOUR + 60_000);
			await m.alerts.sendAlert(alert);
			assert.equal(telegramMessages.length - before.telegram, 2, "again after them");
		});
	});

	test("an alert only for the admin page shows in Needs a look each time, and is neither emailed nor sent to Telegram", async () => {
		await withEnv(TELEGRAM, async () => {
			const key = `credential-refused:${ACCOUNT_ID}`;
			const alert = {
				accountId: null,
				key,
				title: "PostShiba refused an account's login",
				detail: `Account ${ACCOUNT_ID}: PostShiba refused the account's SMTP credential (401).`,
				action: "Its campaign tries again in a few minutes, and pauses on a third refusal within the hour.",
			};
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			await m.alerts.sendAlert(alert);
			await m.alerts.sendAlert(alert);
			assert.equal(telegramMessages.length, before.telegram);
			assert.deepEqual(toAdmins(platformEmails.slice(before.emails)), []);

			const stored = await m.Alert.findOne({ accountId: null, key }).lean();
			assert.equal(stored.lastSentAt, undefined, "never emailed");
			assert.equal(stored.count, 2);
			assert.deepEqual(stored.occurrences.map(({ emailed, telegram }) => ({ emailed, telegram })), Array(2).fill({ emailed: false, telegram: false }));
			const listed = (await m.adminStats.listAttention()).alerts.find(({ id }) => id === String(stored._id));
			assert.deepEqual([listed?.title, listed?.timesThisWeek], ["Email provider refused an account's login", 2]);
			assert.equal(await m.alerts.countRecentAlerts("credential-refused", 60), 1, "one account");
		});
	});

	test("what's only worth a look, an owner's own alerts and an admin's own block stay off Telegram, the block off the admins' email too; each automatic block reaches it", async () => {
		const user = await signIn("blocked-twice@example.com");
		const other = await signIn("blocked-by-hand@example.com");
		await withEnv(TELEGRAM, async () => {
			const before = telegramMessages.length;
			const emails = platformEmails.length;
			await m.alerts.sendAlert({ accountId: null, key: `deleted-email-signup:${ACCOUNT_ID}`, title: "A deleted account's email signed up again", detail: "jane.doe@example.com deleted an account." });
			await m.alerts.sendAlert({ accountId: user.accountId, key: "complaints", title: "Spam complaint", detail: "reader@example.org marked an email as spam." });
			assert.equal(await m.blocks.blockAccount(other.accountId, { reason: "Spam", by: "admin", detail: "Blocked by admin@example.com" }), true);
			assert.equal(telegramMessages.length, before, "none of them");
			assert.deepEqual(
				toAdmins(platformEmails.slice(emails)).map(({ subject }) => subject),
				["[MailCheap] A deleted account's email signed up again"],
				"the admin who blocked an account knows already"
			);
			assert.ok(platformEmails.slice(emails).some(({ to, subject }) => to.includes("blocked-by-hand@example.com") && subject === "[MailCheap] Account blocked"), "its owner hears of it");

			assert.equal(await m.blocks.blockAccount(user.accountId, { reason: "Complaints over 0.3%", by: "rates" }), true);
			// An admin unblocks it, and it's blocked again within the hour: news again.
			await m.Account.updateOne({ _id: user.accountId }, { $set: { status: "active" } });
			assert.equal(await m.blocks.blockAccount(user.accountId, { reason: "Complaints over 0.3% again", by: "rates" }), true);
			const blocks = telegramMessages.slice(before);
			assert.deepEqual(firstLines(blocks), ["<b>MailCheap</b> · Account blocked", "<b>MailCheap</b> · Account blocked"]);
			assert.match(blocks[0].text, new RegExp(`\\n\\nAccount ${user.accountId}, blocked by .+: Complaints over 0\\.3%\\.\\nReview it on the admin page, and unblock it once it's sorted out\\.\\nhttp://localhost:3000/admin$`));
		});
	});

	test("Telegram failing or refusing never fails the alert: the email goes anyway, the next one tries again, and the token stays out of the logs", async () => {
		await withEnv(TELEGRAM, async () => {
			const logged = [];
			const { error, warn } = console;
			console.error = (...args) => logged.push(args.join(" "));
			console.warn = (...args) => logged.push(args.join(" "));
			const refused = { accountId: null, key: "qstash-refused", title: "QStash refused a job", detail: "Unauthorized.", cooldownMinutes: 0 };
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			try {
				answerTelegram(() => Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }));
				await m.alerts.sendAlert(refused);
				answerTelegram(() => {
					throw new TypeError("fetch failed");
				});
				await m.alerts.sendAlert({ accountId: null, key: "rate-limit-unavailable", title: "Rate limiter unavailable", detail: "Upstash Redis failed (fetch failed)." });
			} finally {
				answerTelegram(null);
				Object.assign(console, { error, warn });
			}
			assert.equal(telegramMessages.length, before.telegram);
			assert.equal(toAdmins(platformEmails.slice(before.emails)).length, 2, "the emails went anyway");
			const log = logged.join("\n");
			assert.match(log, /\[alert\] Could not send: Telegram answered 401: Unauthorized/);
			assert.match(log, /\[alert\] Could not send: Telegram didn't answer \(TypeError\)/);
			assert.ok(!log.includes(TELEGRAM.TELEGRAM_BOT_TOKEN) && !log.includes("api.telegram.org"));

			await m.alerts.sendAlert(refused);
			assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · QStash refused a job"], "a message that didn't go out leaves its turn");
		});
	});

	test("what its sender retries on its own, a webhook, alerts on its third failure in an hour", async () => {
		await withEnv(TELEGRAM, async () => {
			const alert = { accountId: null, key: "webhook-failing:test-webhook", title: "Webhook failing", detail: "test-webhook couldn't handle 3 events within an hour: The database is down." };
			const before = telegramMessages.length;
			await m.alerts.sendAlertIfRepeated("test-webhook", alert);
			await m.alerts.sendAlertIfRepeated("test-webhook", alert);
			assert.equal(telegramMessages.length, before);
			await m.alerts.sendAlertIfRepeated("test-webhook", alert);
			assert.deepEqual(firstLines(telegramMessages.slice(before)), ["<b>MailCheap</b> · Webhook failing"]);
		});
	});

	test("Telegram's first message goes out once, as soon as both are set, and again only if it failed", async () => {
		await withEnv(TELEGRAM, async () => {
			const before = telegramMessages.length;
			answerTelegram(() => Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }));
			try {
				assert.deepEqual(await quietly(() => m.alerts.announceTelegram()), { failed: "Telegram answered 400: Bad Request: chat not found" });
			} finally {
				answerTelegram(null);
			}
			assert.deepEqual(await m.alerts.announceTelegram(), { announced: true });
			assert.deepEqual(await m.alerts.announceTelegram(), { skipped: "already announced" });
			const sent = telegramMessages.slice(before);
			assert.equal(sent.length, 1);
			assert.match(sent[0].text, /^<b>MailCheap<\/b> · Telegram alerts are on\n\nOnly what needs you comes here: account blocks, PostShiba stopping sends, .+\.$/);
		});
	});
});

describe("what alerts", () => {
	test("the hourly check runs only with CRON_SECRET, and what PostShiba says stops sending alerts the admins once", async () => {
		const call = (authorization) => m.cronRoute.GET(new Request("http://localhost:3000/api/cron/hourly", { headers: authorization ? { authorization } : {} }));
		assert.equal((await withEnv({ CRON_SECRET: "" }, () => call(`Bearer ${CRON_SECRET}`))).status, 503, "never open without one");
		const user = await signIn("held@example.com");
		await withEnv({ ...TELEGRAM, ...POSTSHIBA_ENV, CRON_SECRET }, async () => {
			for (const authorization of [undefined, CRON_SECRET, `Bearer ${CRON_SECRET.slice(1)}`, `Bearer ${CRON_SECRET}x`, "Bearer someone-elses-secret-0123456789"]) {
				assert.equal((await call(authorization)).status, 401, String(authorization));
			}
			const { summaries, domains, imports, ...checks } = await (await call(`Bearer ${CRON_SECRET}`)).json();
			assert.deepEqual(checks, { postshiba: { alerts: [] }, telegram: { skipped: "already announced" } });
			assert.equal(typeof summaries.queued, "number", "and the summary emails due this hour");
			assert.equal(typeof domains.checked, "number", "and the verified domains due for their daily look at DNS");
			assert.equal(typeof imports.checked, "number", "and the imports that stalled with nobody looking");

			const tenantId = "TnHeld01";
			fake.state.tenants.set(tenantId, { id: tenantId, name: `mc-${user.accountId}`, slug: `mc-${user.accountId}`, suspended: false, held: true });
			await m.Account.updateOne({ _id: user.accountId }, { $set: { "postshiba.tenantId": tenantId, "postshiba.tenantSlug": `mc-${user.accountId}` } });
			Object.assign(fake.state.team, { suspended: true, kyc_status: "pending", clusters_at_cap: [{ id: "ClUs01", name: "outbound", hourly_remaining: 0, daily_remaining: 12, queued: 15 }] });
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			try {
				const { postshiba } = await (await call(`Bearer ${CRON_SECRET}`)).json();
				assert.deepEqual(postshiba.alerts, ["postshiba-suspended", "postshiba-kyc:pending", "postshiba-cap:ClUs01", `tenant-hold:${user.accountId}`]);
				const titles = ["PostShiba suspended the team", "PostShiba hasn't approved sending", "PostShiba cluster at its cap", "PostShiba holds a tenant"];
				assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), titles.map((title) => `<b>MailCheap</b> · ${title}`));
				assert.deepEqual(toAdmins(platformEmails.slice(before.emails)).map(({ subject }) => subject), titles.map((title) => `[MailCheap] ${title}`));

				await call(`Bearer ${CRON_SECRET}`);
				assert.equal(telegramMessages.length - before.telegram, 4, "the next hour's check finds the same problems: nothing new");
				assert.equal(toAdmins(platformEmails.slice(before.emails)).length, 4);
			} finally {
				Object.assign(fake.state.team, { suspended: false, kyc_status: "approved", clusters_at_cap: [] });
				fake.state.tenants.delete(tenantId);
			}

			fake.fail({ method: "GET", path: /\/status$/, status: 503, body: { error: "unavailable" } });
			const down = await (await call(`Bearer ${CRON_SECRET}`)).json();
			assert.match(down.postshiba.failed, /503 unavailable/);
			assert.equal(telegramMessages.length - before.telegram, 4, "an outage waits for the next hour");
			fake.fail({ method: "GET", path: /\/status$/, status: 401, body: { error: "Invalid token or no user signed in" } });
			await call(`Bearer ${CRON_SECRET}`);
			assert.deepEqual(firstLines(telegramMessages.slice(-1)), ["<b>MailCheap</b> · PostShiba refused the status check"]);
		});
	});

	test("the hourly check alerts for each newsletter with a plan that sends from a domain PostShiba suspended or holds, and for no other", async () => {
		const call = () => m.cronRoute.GET(new Request("http://localhost:3000/api/cron/hourly", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
		const Newsletter = (await import("../models/Newsletter.js")).default;
		const paying = await signIn("suspended-domain@example.com");
		await activate(paying, { plan: "growth" });
		const unpaid = await signIn("unpaid-domain@example.com");
		await m.Account.updateOne({ _id: paying.accountId }, { $set: { "postshiba.tenantId": "TnPaying1" } });
		await m.Account.updateOne({ _id: unpaid.accountId }, { $set: { "postshiba.tenantId": "TnUnpaid1" } });
		const [held, paused, noted] = await Newsletter.create([
			{ accountId: paying.accountId, name: "Held letter", slug: "held-letter", fromEmail: "hello@held-letter.example.com" },
			{ accountId: paying.accountId, name: "Paused letter", slug: "paused-letter", fromEmail: "hello@paused-letter.example.com" },
			{ accountId: paying.accountId, name: "Noted letter", slug: "noted-letter", fromEmail: "hello@noted-letter.example.com" },
			{ accountId: paying.accountId, name: "Moved letter", slug: "moved-letter", fromEmail: "hello@own-domain.example.com" },
			{ accountId: unpaid.accountId, name: "Unpaid letter", slug: "unpaid-letter", fromEmail: "hello@unpaid-letter.example.com" },
		]);
		const domain = (id, name, tenantId, fields = {}) => ({ id, name, tenant_id: tenantId, sending_allowed: false, suspended: true, suspended_reason: "paused", operator_held: false, ...fields });
		const added = [
			domain("DmHeld01", "held-letter.example.com", "TnPaying1", { suspended_reason: "operator_hold", operator_held: true }),
			domain("DmPaus01", "paused-letter.example.com", "TnPaying1"),
			domain("DmNote01", "noted-letter.example.com", "TnPaying1", { suspended_reason: "Complaint from reader@example.org" }),
			domain("DmMove01", "moved-letter.example.com", "TnPaying1"),
			domain("DmUnpd01", "unpaid-letter.example.com", "TnUnpaid1"),
			domain("DmOwn001", "own-domain.example.com", "TnPaying1", { suspended: false, suspended_reason: null, dkim_status: "pending" }),
		];
		for (const item of added) fake.state.domains.set(item.id, item);
		await withEnv({ ...TELEGRAM, ...POSTSHIBA_ENV, CRON_SECRET }, async () => {
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			try {
				const { postshiba } = await (await call()).json();
				assert.deepEqual(
					postshiba.alerts,
					[held, paused, noted].map(({ _id }) => `customer-blocked:${_id}`),
					"not a domain no newsletter sends from, an unpaid account's or one still being set up"
				);
				const sent = telegramMessages.slice(before.telegram).map(({ text }) => text);
				assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), Array(3).fill("<b>MailCheap</b> · A paying customer can't send"));
				assert.match(
					sent[0],
					/\n\nHeld letter \(held-letter\.example\.com, Growth plan\): PostShiba's abuse team holds held-letter\.example\.com \(operator_hold\)\. Its campaigns pause and its signup and test emails fail until it's lifted\.\nAsk PostShiba's support why it's held\.\n/
				);
				assert.match(sent[1], /\n\nPaused letter \(paused-letter\.example\.com, Growth plan\): PostShiba suspended paused-letter\.example\.com \(paused\)\./);
				assert.match(sent[1], new RegExp(`/admin/newsletters/${paused._id}$`));
				assert.match(sent[2], /\n\nNoted letter \(noted-letter\.example\.com, Growth plan\): PostShiba suspended noted-letter\.example\.com\. Its campaigns/, "a reason that isn't a code isn't quoted");
				const emailed = toAdmins(platformEmails.slice(before.emails));
				assert.equal(emailed.length, 3);
				assert.doesNotMatch([...sent, ...emailed.map(({ text }) => text)].join("\n"), /reader@/);

				await call();
				assert.equal(telegramMessages.length - before.telegram, 3, "the next hour finds the same blocks: nothing new");
				assert.equal(toAdmins(platformEmails.slice(before.emails)).length, 3, "emailed once a day");
				const attention = await m.adminStats.listAttention();
				const listed = attention.blockedSends.filter(({ ownerEmail }) => ownerEmail === "suspended-domain@example.com");
				assert.deepEqual(listed.map(({ timesThisWeek }) => timesThisWeek), [2, 2, 2]);
				assert.match(listed.find(({ detail }) => detail.startsWith("Held letter")).detail, /: the email provider's abuse team holds held-letter\.example\.com/);
			} finally {
				for (const item of added) fake.state.domains.delete(item.id);
			}
		});
	});

	test("a background job failing its third try alerts; QStash's first retries and a forged signature don't", async () => {
		await withEnv(TELEGRAM, async () => {
			const job = (path, retried) => new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "upstash-retried": String(retried) }, body: "{}" });
			const failing = m.qstashRoute.withQStashSignature(async () => {
				throw new Error("The database is down");
			});
			const before = telegramMessages.length;
			await assert.rejects(failing(job("/api/jobs/send-batch", 0)), /The database is down/);
			await assert.rejects(failing(job("/api/jobs/send-batch", 1)), /The database is down/);
			assert.equal(telegramMessages.length, before, "QStash's own retries come first");
			await assert.rejects(failing(job("/api/jobs/send-batch", 2)), /The database is down/);
			assert.equal(
				telegramMessages.at(-1).text,
				"<b>MailCheap</b> · Background job failing\n\n/api/jobs/send-batch failed 3 times in a row: The database is down.\nAfter its last try QStash keeps it in the dead letter queue: check the logs, then retry it there.\nhttps://console.upstash.com/qstash"
			);

			const busy = m.qstashRoute.withQStashSignature(async () => Response.json({ retry: true }, { status: 503 }));
			assert.equal((await busy(job("/api/jobs/check-first-send", 3))).status, 503);
			assert.match(telegramMessages.at(-1).text, /\/api\/jobs\/check-first-send failed 4 times in a row: it answered 503\./);

			const refuse = () => async () => {
				throw Object.assign(new Error("signature verification failed"), { name: "SignatureError" });
			};
			const forged = m.qstashRoute.withQStashSignature(async () => Response.json({}), { verify: refuse });
			const count = telegramMessages.length;
			assert.equal((await forged(job("/api/jobs/purge-account", 9))).status, 403);
			assert.equal(telegramMessages.length, count, "anyone can send that header");
		});
	});

	test("sign-in codes that can't go out alert the admins, once the form has answered", async () => {
		await withEnv({ ...TELEGRAM, RESEND_API_KEY: "" }, async () => {
			const before = telegramMessages.length;
			const visitor = { jar: new Map(), ip: `203.0.113.${++visitors}` };
			const result = await quietly(() => as(visitor, () => m.signin.sendSigninCode(null, form({ email: "no-code@example.com" }))));
			assert.equal(result.error, "Couldn't send the code. Try again in a minute.");
			await flushAfter();
			assert.deepEqual(
				telegramMessages.slice(before).map(({ text }) => text),
				[
					"<b>MailCheap</b> · Sign-in codes not sending\n\nRESEND_API_KEY is not set: MailCheap Cloud sends its own emails through Resend only.\nNobody can sign in with a code until it's fixed: check Resend's key, domain and quota.\nhttps://resend.com/emails",
				]
			);
		});
	});

	test("the DNS helper at its cap alerts once for itself, and each shared address waiting for it only shows on the admin page", async () => {
		await withEnv(TELEGRAM, async () => {
			const first = await signIn("dns-cap@example.com");
			const second = await signIn("dns-cap-two@example.com");
			const third = await signIn("dns-own@example.com");
			for (const user of [first, second, third]) await activate(user);
			const save = (user, slug) => as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" }))));
			const before = { telegram: telegramMessages.length, emails: platformEmails.length };
			await quietly(async () => {
				for (const [user, slug] of [[first, "dns-cap"], [second, "dns-cap-two"]]) {
					failNextPublish({ status: 429, message: "900 records were created in the last 24 hours, the cap is 900", helperProblem: "cap" });
					await save(user, slug);
				}
			});
			assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · DNS helper at its daily cap"], "once for both");
			assert.deepEqual(toAdmins(platformEmails.slice(before.emails)).map(({ subject }) => subject), ["[MailCheap] DNS helper at its daily cap"]);
			const waiting = (await m.Alert.find({ accountId: null, key: /^shared-sender-waiting:/ }).lean()).map(({ occurrences }) => occurrences.at(-1));
			for (const domain of ["dns-cap.mailcheapmail.com", "dns-cap-two.mailcheapmail.com"]) {
				const occurrence = waiting.find(({ detail }) => detail.startsWith(`${domain} `));
				assert.deepEqual([occurrence?.emailed, occurrence?.telegram], [false, false], `${domain} named on the admin page`);
			}

			await quietly(async () => {
				failNextPublish({ status: 403, message: "CNAME dns-own.mailcheapmail.com isn't a shared address record of dns-own", helperProblem: null });
				await save(third, "dns-own");
			});
			assert.deepEqual(firstLines(telegramMessages.slice(-1)), ["<b>MailCheap</b> · Shared address not set up"], "a slug's own problem reaches Telegram itself");
		});
	});

	test("the DNS helper's client tells the helper failing from a refusal of one slug's records", async () => {
		const records = [{ type: "CNAME", name: "weekly.example.com", value: "cname.vercel-dns.com" }];
		const answers = [
			[429, { error: "daily_cap", message: "900 records were created in the last 24 hours, the cap is 900" }, "cap"],
			[401, { error: "unauthorized" }, "down"],
			[502, { error: "vercel_failed", message: "Vercel answered POST with 403: Not authorized" }, "down"],
			[503, { error: "not_configured", message: "The DNS helper has no Vercel token yet" }, "down"],
			[404, "The page could not be found", "down"],
			[403, { error: "refused", message: "www is MailCheap's own" }, null],
		];
		const fetch = globalThis.fetch;
		try {
			await withEnv({ DNS_BROKER_URL: "https://dns.example.com/api/records", DNS_BROKER_SECRET: "test-dns-secret-0123456789" }, async () => {
				for (const [status, body, helperProblem] of answers) {
					globalThis.fetch = async () => (typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }));
					await assert.rejects(m.dnsBroker.publishSharedRecords("weekly", records), (error) => error.status === status && error.helperProblem === helperProblem, String(status));
				}
				globalThis.fetch = async () => {
					throw new TypeError("fetch failed");
				};
				await assert.rejects(m.dnsBroker.publishSharedRecords("weekly", records), { message: "The DNS helper didn't answer: fetch failed", helperProblem: "down" });
			});
		} finally {
			globalThis.fetch = fetch;
		}
	});
});
