import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import { gravatarHash } from "../lib/gravatar.js";
import { activate, anonymous, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

// Each newsletter's summary email, from the hourly cron to the inbox: which newsletters get a job, the job sending once
// (again when a send fails), a quiet day skipped, the ways to change it or stop it without signing in, and its own
// settings page.
let app;
let m;
let reader = 0;

// 8:30 AM UTC on a Monday: the weekly summary and the daily one are due for an account in UTC.
const MONDAY = new Date("2026-10-26T08:30:00Z");
const WEEKLY_KEY = "weekly:2026-10-26";
const DAILY_KEY = "daily:2026-10-26";
const DAY_MS = 86_400_000;

before(async () => {
	app = await startTestApp();
	m = {
		send: await import("../lib/summary-send.js"),
		summary: await import("../lib/summary.js"),
		token: await import("../lib/summary-token.js"),
		unsubscribeRoute: await import("../app/api/summary/unsubscribe/route.js"),
		settings: await import("../app/summary/[token]/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		Account: (await import("../models/Account.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

async function addNewsletter(user, slug, frequency) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris" })))
	);
	const newsletterId = url.split("/").at(-1);
	if (frequency) await m.Newsletter.updateOne({ accountId: user.accountId, _id: newsletterId }, { $set: { "notifications.summary": frequency } });
	return newsletterId;
}

async function customer(email, { hasPlan = true, frequency } = {}) {
	const user = await signIn(email);
	if (hasPlan) await activate(user);
	user.slug = email.split("@")[0];
	user.newsletterId = await addNewsletter(user, user.slug, frequency);
	return user;
}

// Readers who joined at that time, written as they are so their signup date stays in the past.
async function addReaders(user, count, joinedAt, newsletterId = user.newsletterId) {
	const docs = Array.from({ length: count }, () => ({
		accountId: user.accountId,
		newsletterId: new mongoose.Types.ObjectId(newsletterId),
		email: `reader${++reader}@example.org`,
		status: "active",
		subscribedAt: joinedAt,
		createdAt: joinedAt,
		updatedAt: joinedAt,
	}));
	await m.Contact.collection.insertMany(docs);
}

function readNewsletter(user, newsletterId = user.newsletterId) {
	return m.Newsletter.findOne({ accountId: user.accountId, _id: newsletterId }).lean();
}

async function readFrequency(user, newsletterId) {
	return (await readNewsletter(user, newsletterId)).notifications?.summary;
}

function tokenFor(user, newsletterId = user.newsletterId) {
	return m.token.createSummarySettingsToken({ accountId: user.accountId, newsletterId });
}

// Summaries only: sign-in codes go to the same address.
function emailsTo(user) {
	return platformEmails.filter(({ to, headers }) => to.includes(user.email) && headers?.["List-Unsubscribe-Post"]);
}

async function queueJobs(now = MONDAY) {
	const before = published.length;
	await m.send.queueDueSummaries({ now });
	const jobs = published.slice(before).filter(({ url }) => url.endsWith("/api/jobs/send-summary"));
	return { jobs, keys: Object.fromEntries(jobs.map(({ body }) => [body.newsletterId, body.key])) };
}

test("the hourly run queues one job per newsletter whose summary is due, in its owner's timezone", async () => {
	const weekly = await customer("queue-weekly@example.com");
	const daily = await customer("queue-daily@example.com", { frequency: "daily" });
	const off = await customer("queue-off@example.com", { frequency: "off" });
	const free = await customer("queue-free@example.com", { hasPlan: false });
	const tokyo = await customer("queue-tokyo@example.com");
	await m.Account.updateOne({ _id: tokyo.accountId }, { $set: { "summary.timeZone": "Asia/Tokyo" } });
	const several = await customer("queue-several@example.com", { frequency: "daily" });
	const quiet = await addNewsletter(several, "queue-several-quiet", "off");
	const second = await addNewsletter(several, "queue-several-weekly");

	const { jobs, keys } = await queueJobs();
	assert.equal(keys[weekly.newsletterId], WEEKLY_KEY, "weekly while unset");
	assert.equal(keys[daily.newsletterId], DAILY_KEY);
	assert.equal(keys[off.newsletterId], undefined, "turned off");
	assert.equal(keys[free.newsletterId], undefined, "no paid plan");
	assert.equal(keys[tokyo.newsletterId], undefined, "5:30 PM in Tokyo");
	assert.equal(keys[several.newsletterId], DAILY_KEY, "each newsletter of an account on its own");
	assert.equal(keys[quiet], undefined);
	assert.equal(keys[second], WEEKLY_KEY);
	assert.ok(jobs.every(({ body }) => !("accountId" in body)), "a job names its newsletter only");
	const job = jobs.find(({ body }) => body.newsletterId === weekly.newsletterId);
	assert.equal(job.deduplicationId, `summary-${weekly.newsletterId}-weekly-2026-10-26`);

	await m.Newsletter.updateOne({ accountId: weekly.accountId, _id: weekly.newsletterId }, { $set: { summarySent: { key: WEEKLY_KEY, at: MONDAY } } });
	assert.equal((await queueJobs()).keys[weekly.newsletterId], undefined, "already sent");
	assert.equal((await queueJobs(new Date("2026-10-26T07:30:00Z"))).keys[daily.newsletterId], undefined, "before 8 AM");
	await withEnv({ MAILCHEAP_CLOUD: "" }, async () => assert.deepEqual(await m.send.queueDueSummaries({ now: MONDAY }), { queued: 0 }));
});

test("a summary goes out once, to the owner, with its newsletter's numbers and a one-click unsubscribe", async () => {
	const user = await customer("send-once@example.com");
	await addReaders(user, 2, new Date("2026-09-01T10:00:00Z"));
	await addReaders(user, 3, new Date("2026-10-14T10:00:00Z"));
	await addReaders(user, 5, new Date("2026-10-21T10:00:00Z"));
	const other = await addNewsletter(user, "send-once-other");
	await addReaders(user, 40, new Date("2026-10-21T10:00:00Z"), other);
	const { updatedAt } = await readNewsletter(user);

	assert.deepEqual(await m.send.sendSummary({ newsletterId: user.newsletterId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	const [email] = emailsTo(user);
	assert.equal(email.subject, "send-once news: +5 subscribers this week");
	assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
	assert.match(email.headers["List-Unsubscribe"], /^<http:\/\/localhost:3000\/api\/summary\/unsubscribe\?token=[\w-]+\.[\w-]+>$/);
	assert.match(email.text, /Subscribers: 10 \(\+100%\)/);
	assert.match(email.text, /New: 5 \(\+2 vs last week\)/);
	assert.doesNotMatch(email.text, /send-once-other/, "another newsletter's numbers have their own summary");
	assert.ok(email.html.includes("http://localhost:3000/share/"), "someone joined: there's something to share");
	const token = email.headers["List-Unsubscribe"].match(/token=([^>]+)>/)[1];
	assert.deepEqual(m.token.verifySummarySettingsToken(token, MONDAY.getTime()), { accountId: String(user.accountId), newsletterId: user.newsletterId });

	const sent = await readNewsletter(user);
	assert.equal(sent.summarySent.key, WEEKLY_KEY);
	assert.equal(sent.updatedAt.getTime(), updatedAt.getTime(), "sending isn't a change to its settings");
	assert.deepEqual(await m.send.sendSummary({ newsletterId: user.newsletterId, key: WEEKLY_KEY, now: MONDAY }), { skipped: "sent" });
	assert.equal(emailsTo(user).length, 1, "a second delivery of the job sends nothing");

	assert.deepEqual(await m.send.sendSummary({ newsletterId: other, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	assert.equal(emailsTo(user).at(-1).subject, "send-once-other news: +40 subscribers this week");
});

test("a failed send is given back, so the job's retry sends it", async () => {
	const user = await customer("send-retry@example.com");
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		if (String(input) === "https://api.resend.com/emails") throw new Error("Resend is down");
		return fetch(input, init);
	};
	try {
		await assert.rejects(m.send.sendSummary({ newsletterId: user.newsletterId, key: WEEKLY_KEY, now: MONDAY }), /Resend is down/);
	} finally {
		globalThis.fetch = fetch;
	}
	assert.equal((await readNewsletter(user)).summarySent, undefined);
	assert.deepEqual(await m.send.sendSummary({ newsletterId: user.newsletterId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	assert.equal(emailsTo(user).length, 1);
});

test("a daily summary skips a day with no news; a weekly one says it was quiet", async () => {
	const daily = await customer("quiet-daily@example.com", { frequency: "daily" });
	assert.deepEqual(await m.send.sendSummary({ newsletterId: daily.newsletterId, key: DAILY_KEY, now: MONDAY }), { skipped: "quiet" });
	assert.equal(emailsTo(daily).length, 0);

	const weekly = await customer("quiet-weekly@example.com");
	assert.deepEqual(await m.send.sendSummary({ newsletterId: weekly.newsletterId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	const [email] = emailsTo(weekly);
	assert.equal(email.subject, "quiet-weekly news: no new subscribers this week");
	assert.ok(!email.html.includes("/share/"), "nothing to share");
});

test("a job that comes too late, for another frequency, a newsletter that's gone or an account that stopped paying sends nothing", async () => {
	const user = await customer("stale-job@example.com");
	const send = (key, now = MONDAY) => m.send.sendSummary({ newsletterId: user.newsletterId, key, now });
	assert.deepEqual(await send(WEEKLY_KEY, new Date(MONDAY.getTime() + DAY_MS)), { skipped: "stale" });
	assert.deepEqual(await send(DAILY_KEY), { skipped: "frequency_changed" });
	assert.deepEqual(await send("weekly:yesterday"), { skipped: "invalid" });
	assert.deepEqual(await m.send.sendSummary({ newsletterId: String(new mongoose.Types.ObjectId()), key: WEEKLY_KEY, now: MONDAY }), {
		skipped: "no_newsletter",
	});
	await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
	assert.deepEqual(await send(WEEKLY_KEY), { skipped: "not_eligible" });
	assert.equal(emailsTo(user).length, 0);
});

function unsubscribeRequest(method, token) {
	const url = `http://localhost:3000/api/summary/unsubscribe?token=${encodeURIComponent(token)}`;
	return method === "POST"
		? new Request(url, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })
		: new Request(url, { method });
}

test("a mail app's one-click unsubscribe turns that newsletter's summary off; opening the link only shows the choice", async () => {
	const user = await customer("one-click@example.com");
	const other = await addNewsletter(user, "one-click-other", "daily");
	const token = tokenFor(user);

	const opened = await m.unsubscribeRoute.GET(unsubscribeRequest("GET", token));
	assert.equal(new URL(opened.headers.get("location")).pathname, `/summary/${token}`);
	assert.equal(await readFrequency(user), undefined, "a link scanner's visit changes nothing");

	const response = await m.unsubscribeRoute.POST(unsubscribeRequest("POST", token));
	assert.equal(response.status, 200);
	assert.equal(await readFrequency(user), "off");
	assert.equal(await readFrequency(user, other), "daily", "the account's other newsletter keeps its summary");

	const forged = await m.unsubscribeRoute.POST(unsubscribeRequest("POST", `${token.split(".")[0]}.${"A".repeat(43)}`));
	assert.equal(forged.status, 400);
});

test("the summary's own page changes how often that newsletter's summary comes with the link alone", async () => {
	const user = await customer("settings-link@example.com");
	const token = tokenFor(user);
	const save = (fields) => anonymous(() => catchRedirect(m.settings.saveSummaryChoice(form(fields))));

	assert.equal(await save({ token, frequency: "daily" }), `/summary/${token}?saved=daily`);
	assert.equal(await readFrequency(user), "daily");
	assert.equal(await save({ token, frequency: "hourly" }), `/summary/${token}`);
	assert.equal(await readFrequency(user), "daily");

	const other = await customer("settings-other@example.com");
	const forged = `${tokenFor(other).split(".")[0]}.${token.split(".")[1]}`;
	await save({ token: forged, frequency: "off" });
	assert.equal(await readFrequency(other), undefined, "another newsletter under this link's signature");
	await save({ token: m.token.createSummarySettingsToken({ accountId: user.accountId, newsletterId: other.newsletterId }), frequency: "off" });
	assert.equal(await readFrequency(other), undefined, "a newsletter only changes for its own account");
});

test("the Notifications page saves each newsletter's summary on its own and previews its own numbers", async () => {
	const user = await customer("notifications-page@example.com");
	await addReaders(user, 4, new Date(Date.now() - 2 * DAY_MS));
	const other = await addNewsletter(user, "notifications-page-other");

	assert.deepEqual(await as(user, () => m.newsletters.saveNotifications(user.newsletterId, { summary: "daily" })), {
		ok: true,
		notifications: { summary: "daily" },
	});
	assert.equal(await readFrequency(user), "daily");
	assert.equal(await readFrequency(user, other), undefined, "the other newsletter stays weekly");
	assert.match((await as(user, () => m.newsletters.saveNotifications(user.newsletterId, { summary: "hourly" }))).error, /notifications\.summary/);
	assert.equal(await readFrequency(user), "daily");

	const stranger = await customer("notifications-stranger@example.com");
	assert.equal((await as(user, () => m.newsletters.saveNotifications(stranger.newsletterId, { summary: "off" }))).error, "Newsletter not found");
	assert.equal(await readFrequency(stranger), undefined, "nobody changes another account's newsletter");

	const preview = await as(user, () => m.newsletters.previewSummaryEmail(user.newsletterId));
	assert.match(preview.subject, /^notifications-page news: .+ yesterday$/, "the newsletter's own summary, daily as it chose");
	assert.ok(preview.html.includes("notifications-page news"));
	const weekly = await as(user, () => m.newsletters.previewSummaryEmail(other));
	assert.match(weekly.subject, /^notifications-page-other news: .+ this week$/);
	assert.equal((await as(user, () => m.newsletters.previewSummaryEmail(stranger.newsletterId))).error, "Newsletter not found");
});

test("the Notifications page shows the address the summary goes to, with its owner's picture", async () => {
	const user = await customer("notifications-to@example.com");
	const NotificationsPage = (await import("../app/(app)/newsletters/notifications/page.js")).default;
	const page = renderToStaticMarkup(await as(user, () => NotificationsPage()));
	assert.match(page, /Sent to.+notifications-to@example\.com.+The address you sign in with\./s);
	assert.ok(page.includes(`gravatar.com/avatar/${gravatarHash(user.email)}`), "their picture next to it");
});

test("saving a newsletter's other settings keeps its summary as it was, chosen or not", async () => {
	const user = await customer("settings-keep@example.com");
	const rename = () =>
		as(user, () => m.newsletters.saveNewsletter(null, form({ id: user.newsletterId, section: "general", name: "Renamed", slug: user.slug })));
	assert.equal((await rename()).ok, true);
	assert.equal((await readNewsletter(user)).notifications?.summary, undefined, "never chosen: it follows the default");

	await as(user, () => m.newsletters.saveNotifications(user.newsletterId, { summary: "off" }));
	await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { summarySent: { key: WEEKLY_KEY, at: MONDAY } } });
	assert.equal((await rename()).ok, true);
	const saved = await readNewsletter(user);
	assert.equal(saved.notifications.summary, "off");
	assert.equal(saved.summarySent.key, WEEKLY_KEY, "a save never forgets the summary that went out");
});

test("the dashboard keeps its owner's timezone for the cron, which has no browser to ask", async () => {
	const user = await customer("account-zone@example.com");
	await m.send.rememberTimeZone(await m.Account.findById(user.accountId).lean(), "Europe/Paris");
	await m.send.rememberTimeZone(await m.Account.findById(user.accountId).lean(), "Mars/Olympus_Mons");
	assert.equal((await m.Account.findById(user.accountId).lean()).summary.timeZone, "Europe/Paris", "an unknown zone isn't kept");
	await m.send.rememberTimeZone(await m.Account.findById(user.accountId).lean(), "Asia/Tokyo");
	assert.equal((await m.Account.findById(user.accountId).lean()).summary.timeZone, "Asia/Tokyo");
});

test("the API reads and changes each newsletter's summary, previews it, and gives its numbers", async () => {
	const user = await customer("summary-api@example.com");
	const period = m.summary.getLatestSummaryPeriod({ frequency: "weekly", timeZone: "UTC" });
	await addReaders(user, 6, new Date(period.start.getTime() + DAY_MS));
	await addReaders(user, 1, new Date(period.start.getTime() - DAY_MS));
	const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Summary", level: "full" })));

	const read = await callApi("GET", `/api/v1/newsletters/${user.slug}`, { key });
	assert.deepEqual(read.body.notifications, { summary: "weekly" });
	const changed = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key, body: { notifications: { summary: "off" } } });
	assert.equal(changed.status, 200, JSON.stringify(changed.body));
	assert.deepEqual(changed.body.notifications, { summary: "off" });
	assert.equal(await readFrequency(user), "off");
	const refused = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key, body: { notifications: { summary: "monthly" } } });
	assert.equal(refused.status, 400);
	assert.equal(await readFrequency(user), "off");

	const preview = await callApi("GET", `/api/v1/summary/preview?newsletter=${user.slug}`, { key });
	assert.equal(preview.status, 200, JSON.stringify(preview.body));
	assert.equal(preview.body.frequency, "weekly", "off previews the weekly");
	assert.equal(preview.body.newsletter.id, user.newsletterId);
	assert.equal(preview.body.to, user.email, "where it goes: the owner's address");
	assert.match(preview.body.subject, /^summary-api news: \+6 subscribers this week$/);
	assert.match(preview.body.text, /New: 6/);

	const response = await callApi("GET", "/api/v1/summary?period=week&timeZone=UTC", { key });
	assert.equal(response.status, 200, JSON.stringify(response.body));
	assert.deepEqual(response.body.period, { from: period.startKey, to: period.lastKey, timeZone: "UTC" });
	assert.equal(response.body.summary.subscribers.joined, 6);
	assert.equal(response.body.summary.subscribers.previousJoined, 1);
	assert.equal(response.body.summary.subscribers.total, 7);
	assert.equal(response.body.summary.subscribers.bars.length, 8);
	assert.equal(typeof response.body.summary.line, "string");
});
