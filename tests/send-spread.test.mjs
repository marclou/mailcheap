import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	formatPaceTime,
	getGmailBatchStarts,
	getGmailDays,
	getPace,
	getSenderDayEmails,
	getSenderDayStart,
	getSenderMs,
	getSenderPace,
} from "../lib/send-spread.js";
import { activate, addAuthor, as, catchRedirect, form, jsonRequest, mockRdap, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const CLOUD = { MAILCHEAP_CLOUD: "true" };
const now = new Date("2026-10-13T12:00:00Z");
const at = (hours) => new Date(now.getTime() + hours * HOUR_MS);

test("a new domain holds Gmail's readers back on its first day only, on MailCheap Cloud", () => {
	const fresh = getSenderPace({}, { now, env: CLOUD });
	assert.deepEqual(fresh, {
		day: 1,
		intoDayMs: 0,
		waitMs: 0,
		firstDay: 2000,
		days: 1,
		isGradual: false,
		sentToday: 0,
		inFlight: 0,
		hasStarted: false,
		domain: null,
	});
	assert.deepEqual(
		getSenderPace({ startedAt: at(-6), sentToday: 300, inFlight: 40, domain: "news.example.org" }, { now, env: CLOUD }),
		{ day: 1, intoDayMs: 6 * HOUR_MS, waitMs: 0, firstDay: 2000, days: 1, isGradual: false, sentToday: 300, inFlight: 40, hasStarted: true, domain: "news.example.org" }
	);
	assert.equal(getSenderPace({ startedAt: at(-24) }, { now, env: CLOUD }), null, "past its first day");
	assert.equal(getSenderPace({ days: 0 }, { now, env: CLOUD }), null, "a domain Gmail already knows");
	assert.equal(getSenderPace({}, { now, env: { MAILCHEAP_CLOUD: "" } }), null, "a self-hosted server");
	const waiting = getSenderPace({ startedAt: at(6), firstDay: 351, days: 3, isGradual: true, sentToday: 900 }, { now, env: CLOUD });
	assert.deepEqual([waiting.waitMs, waiting.day, waiting.sentToday], [6 * HOUR_MS, 1, 0], "a back-off's days wait for it to end");
	assert.equal(getSenderDayStart(at(-30), now).getTime(), at(-6).getTime(), "its second day began 6 hours ago");
	assert.equal(getSenderDayEmails({ firstDay: 351 }, 3), 1404, "twice as many each day");
});

test("on a new domain's first day, its first 2,000 Gmail readers go at once and the others when the day ends", () => {
	const fresh = getSenderPace({}, { now, env: CLOUD });
	assert.equal(getSenderMs(fresh, 0), 0);
	assert.equal(getSenderMs(fresh, 1999), 0);
	assert.equal(getSenderMs(fresh, 2000), DAY_MS, "the 2,001st waits for the next day");
	assert.equal(getSenderMs(fresh, 50_000), DAY_MS, "and so does everyone after: then it's over");
	const later = getSenderPace({ startedAt: at(-6), sentToday: 1500, inFlight: 300 }, { now, env: CLOUD });
	assert.equal(getSenderMs(later, 199), 0, "what it sent today and what's queued come first");
	assert.equal(getSenderMs(later, 200), 18 * HOUR_MS, "the rest of its first day");
	assert.deepEqual(getGmailBatchStarts(42, fresh, now.getTime()), [...Array(40).fill(null), at(24) / 1000, at(24) / 1000]);
	assert.equal(getSenderMs(null, 10_000), 0, "nothing holds Gmail back");
});

test("after a back-off, Gmail's emails spread over each day, twice as many each day for 3 days", () => {
	const restart = getSenderPace({ startedAt: at(6), firstDay: 1000, days: 3, isGradual: true }, { now, env: CLOUD });
	assert.equal(getSenderMs(restart, 0), 6 * HOUR_MS, "after the 6 hours");
	assert.equal(getSenderMs(restart, 500), 18 * HOUR_MS, "half its first day's 1,000 by the middle of it");
	assert.equal(getSenderMs(restart, 2000), 42 * HOUR_MS, "the second day's 2,000 by the middle of it");
	assert.equal(getSenderMs(restart, 100_000), 78 * HOUR_MS, "after its 3 days, the rest at once");
});

test("the dashboard says how many Gmail readers get a send today and how many later", () => {
	const fresh = getSenderPace({ domain: "news.example.org" }, { now, env: CLOUD });
	assert.deepEqual(getGmailDays(fresh, 6103), [2000, 4103]);
	assert.equal(getGmailDays(fresh, 2000), null, "all of them today");
	assert.equal(getGmailDays(null, 6103), null);
	assert.deepEqual(getGmailDays(getSenderPace({ startedAt: at(-2), sentToday: 1800 }, { now, env: CLOUD }), 500), [200, 300]);
	assert.deepEqual(getGmailDays(getSenderPace({ startedAt: at(-2), sentToday: 2000 }, { now, env: CLOUD }), 500), [0, 500], "today's share is used");
	const restart = getSenderPace({ startedAt: at(6), firstDay: 1000, days: 3, isGradual: true }, { now, env: CLOUD });
	assert.deepEqual(getGmailDays(restart, 5000), [1000, 2000, 2000], "after the wait, the days of a back-off");
	assert.deepEqual(getGmailDays(restart, 800), [800], "after the wait, even when they fit its first day");
	assert.deepEqual(getPace({ sender: { domain: "news.example.org" }, now, env: CLOUD }).sender.domain, "news.example.org");
	assert.equal(getPace({ env: { MAILCHEAP_CLOUD: "" } }), null, "a self-hosted server sends at full speed");
	assert.deepEqual([formatPaceTime(0.4), formatPaceTime(0.01), formatPaceTime(27), formatPaceTime(81)], ["24 minutes", "1 minute", "27 hours", "about 3 days"]);
});

describe("Gmail's readers on a new domain", () => {
	let app;
	let m;

	// contacts: { gmail, others }, all mailed before unless isNew, so no first-send steps hold them back.
	async function setup(email, { gmail = 0, others = 0, isNew = false } = {}) {
		const user = await signIn(email);
		await activate(user, { limitOverrides: { emailsPerMonth: 100_000, subscribers: 100_000 } });
		const slug = email.split("@")[0];
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St" }))));
		user.newsletterId = url.split("/").at(-1);
		await addAuthor(user);
		const contact = (address) => ({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: address,
			status: "active",
			...(!isNew && { lastSentAt: new Date(Date.now() - 3 * DAY_MS) }),
		});
		await m.Contact.insertMany([
			...Array.from({ length: gmail }, (_, index) => contact(`mailcheap-test-${slug}-${index}@gmail.com`)),
			...Array.from({ length: others }, (_, index) => contact(`reader${index}@${slug}.example.org`)),
		]);
		return user;
	}

	async function draft(user) {
		const draftUrl = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		const campaignId = draftUrl.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(campaignId, { subject: "Issue", previewText: "Hi", body: "<p>Hello</p>" }));
		return campaignId;
	}

	async function send(user, campaignId) {
		const from = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(campaignId, {})), { ok: true });
		return published.slice(from).filter(({ url }) => url.endsWith("/api/jobs/send-batch"));
	}

	async function run(jobs) {
		const results = [];
		for (const job of jobs) {
			const route = job.url.endsWith("check-first-send") ? m.checkRoute : m.sendBatchRoute;
			results.push(await (await route.POST(jsonRequest(job.url, { method: "POST", body: job.body }))).json());
		}
		return results;
	}

	const providersOf = async (batch) =>
		(await m.Message.find({ accountId: batch.body.accountId, _id: { $in: batch.body.messageIds } }).select({ provider: 1 }).lean()).map(
			({ provider }) => provider
		);
	const campaignOf = (user, campaignId) => m.Campaign.findOne({ accountId: user.accountId, _id: campaignId }).lean();
	const newsletterOf = (user) => m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
	const identityOf = async (user) => (await m.sender.loadSender({ _id: user.accountId }, await newsletterOf(user))).identity;

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next", SEND_RATE_PER_SECOND: "1000" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			checkRoute: await import("../app/api/jobs/check-first-send/route.js"),
			warmup: await import("../lib/sender-warmup.js"),
			sender: await import("../lib/sender.js"),
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
			SenderDomain: (await import("../models/SenderDomain.js")).default,
		};
	});

	after(() => {
		mockRdap(null);
		return app?.stop();
	});

	test("its first send: other inboxes and its first 2,000 Gmail readers at once, the other Gmail readers the next day", async () => {
		const user = await setup("new-shared@example.com", { gmail: 2500, others: 500 });
		const campaignId = await draft(user);
		const start = Date.now();
		const batches = await send(user, campaignId);
		assert.equal(batches.length, 60);
		const atOnce = batches.filter(({ notBefore }) => notBefore === undefined);
		const nextDay = batches.filter(({ notBefore }) => notBefore !== undefined);
		assert.equal(atOnce.length, 50, "500 others and 2,000 Gmail readers");
		assert.equal(nextDay.length, 10);
		assert.ok(nextDay.every(({ notBefore }) => Math.abs(notBefore * 1000 - (start + DAY_MS)) < 60_000), "a day after its first email");
		for (const batch of nextDay) assert.deepEqual(new Set(await providersOf(batch)), new Set(["gmail"]));
		const waiting = await m.Message.countDocuments({ accountId: user.accountId, campaignId, sendAfter: { $gt: new Date() } });
		assert.equal(waiting, 500, "Gmail readers set for the next day say so");
		const campaign = await campaignOf(user, campaignId);
		assert.ok(Math.abs(campaign.sendingUntil.getTime() - (start + DAY_MS)) < 60_000);
		assert.equal(campaign.spreadHours, undefined);
		const identity = await identityOf(user);
		const domain = await m.SenderDomain.findOne({ accountId: user.accountId, domain: identity }).lean();
		assert.deepEqual([domain.days, domain.firstDay], [1, 2000]);
		assert.ok(Math.abs(domain.startedAt.getTime() - start) < 60_000, "its first day starts with this send");

		const second = await setup("new-shared-second@example.com", { gmail: 10 });
		const other = await send(second, await draft(second));
		assert.ok(other.every(({ notBefore }) => notBefore === undefined), "another account's new domain has its own day");

		const sameDay = await send(user, await draft(user));
		assert.deepEqual(
			[sameDay.filter(({ notBefore }) => notBefore === undefined).length, sameDay.filter(({ notBefore }) => notBefore !== undefined).length],
			[10, 50],
			"a second send that day: its other inboxes at once, all its Gmail readers after the first send's"
		);
	});

	test("pausing and resuming doesn't let the next day's Gmail readers go today, and an older batch of theirs waits", async () => {
		const user = await setup("paused-shared@example.com", { gmail: 2500 });
		const campaignId = await draft(user);
		const batches = await send(user, campaignId);
		const atOnce = batches.filter(({ notBefore }) => notBefore === undefined);
		const nextDay = batches.filter(({ notBefore }) => notBefore !== undefined);
		await run(atOnce);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId, status: "sent" }), 2000);

		assert.deepEqual(await as(user, () => m.campaigns.pauseCampaign(campaignId)), { ok: true });
		const from = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(campaignId)), { ok: true });
		const resumed = published.slice(from).filter(({ url }) => url.endsWith("/api/jobs/send-batch"));
		assert.equal(resumed.length, 10);
		assert.ok(
			resumed.every(({ notBefore }) => notBefore * 1000 > Date.now() + 23 * HOUR_MS),
			"today's 2,000 are out, so the other 500 still go the next day"
		);

		const [early] = await run([{ ...nextDay[0], notBefore: undefined }]);
		assert.equal(early.sent, 0, "a batch delivered early leaves them for their day");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId, status: "sent" }), 2000);
	});

	test("a domain of its own registered long ago isn't held back; one registered this month, or one no registry dates, is", async () => {
		const user = await setup("own-domains@example.com");
		const newsletter = await newsletterOf(user);
		const account = { _id: user.accountId };
		mockRdap((domain) => (domain === "old-brand.example" ? "2015-04-01T00:00:00Z" : domain === "fresh-brand.example" ? new Date(Date.now() - 5 * DAY_MS) : null));
		assert.equal((await m.warmup.getSenderWarmup(account, newsletter, "news.old-brand.example")).days, 0, "its parent domain is old");
		assert.equal((await m.warmup.getSenderWarmup(account, newsletter, "news.fresh-brand.example")).days, 1, "registered 5 days ago");
		assert.equal((await m.warmup.getSenderWarmup(account, newsletter, "unknown-brand.example")).days, 1, "no registry has it: not proven older");
		assert.equal((await m.warmup.getSenderWarmup(account, newsletter, "brand-new.mailcheapmail.com")).days, 1, "a new shared subdomain");
		mockRdap(() => {
			throw new Error("asked again");
		});
		assert.equal((await m.warmup.getSenderWarmup(account, newsletter, "news.old-brand.example")).days, 0, "kept, not asked again");
		mockRdap(null);
	});

	test("a first send's check doesn't wait for Gmail readers its new domain sends the next day", async () => {
		const user = await setup("steps-and-gmail@example.com", { gmail: 5000, isNew: true });
		const identity = await identityOf(user);
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { sendingDomain: identity } });
		// Its first day began an hour ago, with room for 300 Gmail readers.
		await m.SenderDomain.create({ accountId: user.accountId, domain: identity, startedAt: new Date(Date.now() - HOUR_MS), firstDay: 300, days: 1 });
		const campaignId = await draft(user);
		const from = published.length;
		await send(user, campaignId);
		const firstStep = published.slice(from);
		await run(firstStep.filter(({ url }) => url.endsWith("send-batch")));
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId, status: "sent" }), 200);

		const beforeSecond = published.length;
		const [second] = await run(firstStep.filter(({ url }) => url.endsWith("check-first-send")));
		assert.deepEqual([second.released, second.step], [250, 2]);
		const secondStep = published.slice(beforeSecond).filter(({ url }) => url.endsWith("send-batch"));
		assert.deepEqual(
			secondStep.map(({ notBefore }) => notBefore !== undefined),
			[false, false, true, true, true],
			"100 more today, then the day's share is used"
		);
		await run(secondStep.filter(({ notBefore }) => notBefore === undefined));

		const lastCheck = published.slice(beforeSecond).find(({ url }) => url.endsWith("check-first-send"));
		const [last] = await run([lastCheck]);
		assert.equal(last.waiting, undefined, "the 150 set for tomorrow aren't due");
		assert.deepEqual([last.released, last.step], [4550, 3]);
		const campaign = await campaignOf(user, campaignId);
		assert.ok(campaign.sendingUntil.getTime() > Date.now() + 22 * HOUR_MS, "the rest of Gmail's readers tomorrow");
	});
});
