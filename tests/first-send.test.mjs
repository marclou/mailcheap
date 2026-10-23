import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getFirstSendProblem, getFirstSendSlice } from "../lib/first-send.js";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, proveVolume, signIn, startTestApp } from "./helpers/app.mjs";
import { published, state as qstash } from "./stubs/qstash.mjs";

test("the first slice is 5% of never-mailed contacts, between 200 and 2,000", () => {
	assert.equal(getFirstSendSlice(150), null, "small lists go at once");
	assert.equal(getFirstSendSlice(200), null);
	assert.equal(getFirstSendSlice(201), 200);
	assert.equal(getFirstSendSlice(5000), 250);
	assert.equal(getFirstSendSlice(10_000), 500);
	assert.equal(getFirstSendSlice(100_000), 2000);
});

test("a slice over a campaign's levels stops the rest", () => {
	assert.equal(getFirstSendProblem({ sent: 250, bounced: 5 }), null, "2% is the pause limit");
	assert.deepEqual(getFirstSendProblem({ sent: 250, bounced: 6 }), { level: "pause", reason: "The first 250 new contacts had a bounce rate of 2.40% (limit 2.00%)" });
	assert.equal(getFirstSendProblem({ sent: 2000, complained: 2 }).level, "pause");
	assert.equal(getFirstSendProblem({ sent: 2000, complained: 1 }), null, "one complaint");
	assert.equal(getFirstSendProblem({ sent: 0 }), null);
});

describe("first sends in steps", () => {
	let app;
	let m;
	const handled = new Set();

	// Sends run until none are left; checks only once, as the ones they publish are due later.
	async function runJobs({ checks = false } = {}) {
		const results = [];
		const end = checks ? published.length : Infinity;
		for (let index = 0; index < Math.min(end, published.length); index++) {
			const job = published[index];
			const isCheck = job.url.endsWith("/api/jobs/check-first-send");
			if (handled.has(index) || isCheck !== checks) continue;
			handled.add(index);
			const route = isCheck ? m.checkRoute : m.sendBatchRoute;
			results.push({ url: job.url, notBefore: job.notBefore, result: await (await route.POST(jsonRequest(job.url, { method: "POST", body: job.body }))).json() });
		}
		return results;
	}

	const skipPublished = () => published.forEach((_, index) => handled.add(index));

	async function setup(email, { neverMailed, mailed = 0 }) {
		const user = await signIn(email);
		await activate(user, { limitOverrides: { emailsPerMonth: 100_000, subscribers: 100_000 } });
		const slug = email.split("@")[0];
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St" }))));
		user.newsletterId = url.split("/").at(-1);
		// Sends this size are proven, so only the first-send steps hold contacts back (tests/send-spread.test.mjs paces them).
		await proveVolume(user, 1000);
		const contact = (index, lastSentAt) => ({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: `reader${index}@${slug}.example.org`,
			status: "active",
			...(lastSentAt && { lastSentAt }),
		});
		await m.Contact.insertMany([
			...Array.from({ length: neverMailed }, (_, index) => contact(index)),
			...Array.from({ length: mailed }, (_, index) => contact(neverMailed + index, new Date(Date.now() - 86_400_000))),
		]);
		const draftUrl = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		user.campaignId = draftUrl.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(user.campaignId, { subject: "Issue", previewText: "Hi", body: "<p>Hello</p>" }));
		return user;
	}

	const count = (user, status) => m.Message.countDocuments({ accountId: user.accountId, campaignId: user.campaignId, status });
	const campaignOf = (user) => m.Campaign.findOne({ accountId: user.accountId, _id: user.campaignId }).lean();

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next", SEND_RATE_PER_SECOND: "1000" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			checkRoute: await import("../app/api/jobs/check-first-send/route.js"),
			blocks: await import("../lib/account-blocks.js"),
			Account: (await import("../models/Account.js")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
	});

	after(() => app?.stop());

	test("a slice goes first; the rest waits 3 hours, then follows when the slice is clean", async () => {
		const user = await setup("clean-list@example.com", { neverMailed: 2500, mailed: 100 });
		const start = Date.now();
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(user.campaignId, {})), { ok: true });
		assert.equal(await count(user, "held"), 2300);
		assert.equal(await count(user, "queued"), 300, "the slice and contacts mailed before");
		const campaign = await campaignOf(user);
		assert.equal(campaign.stats.recipients, 2600);
		assert.deepEqual({ slice: campaign.firstSend.slice, held: campaign.firstSend.held }, { slice: 200, held: 2300 });

		const batchJobs = published.filter(({ url, body }) => url.endsWith("send-batch") && String(body.accountId) === String(user.accountId));
		assert.ok(batchJobs.every(({ flowControl }) => flowControl.key === `account-${user.accountId}` && flowControl.parallelism === 1), "one batch at a time per account");
		const sends = await runJobs();
		assert.equal(sends.reduce((sum, { result }) => sum + result.sent, 0), 300);
		assert.equal((await campaignOf(user)).status, "sending", "not sent while contacts are held");

		const [check] = await runJobs({ checks: true }).then((results) => results.filter(({ url }) => url.endsWith("check-first-send")));
		assert.ok(check.notBefore * 1000 >= start + 179 * 60_000, "3 hours later");
		assert.equal(check.result.released, 2300);
		assert.equal(await count(user, "held"), 0);
		assert.equal(await count(user, "queued"), 2300);
		const batches = published.filter(({ url, body }, index) => !handled.has(index) && url.endsWith("send-batch") && String(body.accountId) === String(user.accountId));
		assert.equal(batches.reduce((sum, { body }) => sum + body.messageIds.length, 0), 2300);
		assert.ok(batches.every(({ notBefore }) => notBefore === undefined), "past the warm-up, at full speed");
		skipPublished();
	});

	test("a slice with too many bounces blocks the account; once an admin unblocks it, resuming sends the rest", async () => {
		const user = await setup("bought-list@example.com", { neverMailed: 3000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();
		const slice = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "sent" })
			.limit(12)
			.lean();
		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: slice.map(({ _id }) => _id) } }, { $set: { status: "bounced", bouncedAt: new Date() } });

		const [check] = await runJobs({ checks: true });
		assert.equal(check.result.blocked, true);
		const paused = await campaignOf(user);
		assert.equal(paused.status, "paused");
		assert.equal(paused.pauseCode, "first_send_slice");
		assert.equal(paused.pauseReason, "The first 200 new contacts had a bounce rate of 6.00% (limit 5.00%). The rest of the new contacts weren't sent.");
		const account = await m.Account.findById(user.accountId).lean();
		assert.deepEqual(
			[account.status, account.pausedBy, account.pauseReason],
			["paused", "slice", "The first 200 new contacts had a bounce rate of 6.00% (limit 5.00%)"]
		);
		assert.equal(await count(user, "held"), 2800);

		assert.equal((await as(user, () => m.campaigns.resumeCampaign(user.campaignId))).code, "account_blocked");
		await m.blocks.unblockAccount(user.accountId);
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(user.campaignId)), { ok: true });
		assert.equal(await count(user, "held"), 0, "the customer chose to send the rest");
		assert.equal(await count(user, "queued"), 2800);
		assert.equal((await campaignOf(user)).status, "sending");
		skipPublished();
	});

	test("a slice over the pause level only holds the rest, with a warning, until its owner resumes", async () => {
		const user = await setup("warm-list@example.com", { neverMailed: 3000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();
		const slice = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "sent" }).limit(6).lean();
		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: slice.map(({ _id }) => _id) } }, { $set: { status: "bounced", bouncedAt: new Date() } });

		const emailsBefore = platformEmails.length;
		const [check] = await runJobs({ checks: true });
		assert.deepEqual([check.result.paused, check.result.blocked], [true, undefined]);
		const paused = await campaignOf(user);
		assert.equal(paused.pauseCode, "first_send_slice");
		assert.match(paused.pauseReason, /^The first 200 new contacts had a bounce rate of 3.00% \(limit 2.00%\)\. The rest of the new contacts wait: clean the list/);
		assert.equal((await m.Account.findById(user.accountId).lean()).status, "active", "6 bounces don't block");
		const emails = platformEmails.slice(emailsBefore);
		assert.deepEqual(emails.map(({ to, subject }) => [to, subject]), [[["warm-list@example.com"], "[MailCheap] Campaign paused"]]);
		assert.equal(await count(user, "held"), 2800);

		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(user.campaignId)), { ok: true });
		const resumed = await campaignOf(user);
		assert.equal(resumed.status, "sending");
		assert.ok(resumed.ratesAcceptedAt instanceof Date, "the owner took the rates as they are");
		assert.equal(await count(user, "held"), 0);
		skipPublished();
	});

	test("a clean slice whose rest QStash refuses pauses the send; resuming sends the rest", async () => {
		const user = await setup("refused-rest@example.com", { neverMailed: 2500 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();

		qstash.failNext = new Error("quota exceeded");
		const [check] = await runJobs({ checks: true });
		assert.deepEqual([check.result.released, check.result.paused], [2300, true]);
		const paused = await campaignOf(user);
		assert.equal(paused.status, "paused", "not left sending with no batch for the rest");
		assert.equal(paused.pauseReason, "queueing failed: quota exceeded");
		assert.equal(await count(user, "queued"), 2300);

		const before = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(user.campaignId)), { ok: true });
		const batches = published.slice(before).filter(({ url }) => url.endsWith("send-batch"));
		assert.equal(batches.reduce((sum, { body }) => sum + body.messageIds.length, 0), 2300);
		assert.equal((await campaignOf(user)).status, "sending");
		skipPublished();
	});

	test("a check while the slice is still going out waits a few more minutes", async () => {
		const user = await setup("slow-slice@example.com", { neverMailed: 1000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		const check = published.find(({ url }, index) => !handled.has(index) && url.endsWith("check-first-send"));
		skipPublished();
		const response = await m.checkRoute.POST(jsonRequest(check.url, { method: "POST", body: check.body }));
		const result = await response.json();
		assert.equal(result.waiting, true);
		assert.equal(result.queued, 200);
		assert.ok(published.at(-1).url.endsWith("check-first-send"), "checks again later");
		assert.equal(await count(user, "held"), 800);
		skipPublished();
	});

	test("lists without new contacts, or small ones, go at once", async () => {
		const user = await setup("small-list@example.com", { neverMailed: 150, mailed: 50 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		assert.equal(await count(user, "held"), 0);
		assert.equal((await campaignOf(user)).firstSend?.slice, undefined);
		await runJobs();
		assert.equal((await campaignOf(user)).status, "sent");
	});
});
