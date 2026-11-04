import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getFirstSendProblem, getFirstSendSteps } from "../lib/first-send.js";
import { activate, addAuthor, as, catchRedirect, endSenderWarmup, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

test("new contacts go 2% first, then 5% more, then the rest, each step within its bounds", () => {
	assert.equal(getFirstSendSteps(150), null, "small lists go at once");
	assert.equal(getFirstSendSteps(200), null);
	assert.deepEqual(getFirstSendSteps(201), [200, 1]);
	assert.deepEqual(getFirstSendSteps(400), [200, 200], "no second step when the rest is as small");
	assert.deepEqual(getFirstSendSteps(1000), [200, 200, 600], "200 at least each");
	assert.deepEqual(getFirstSendSteps(9335), [200, 467, 8668]);
	assert.deepEqual(getFirstSendSteps(50_000), [1000, 2500, 46_500]);
	assert.deepEqual(getFirstSendSteps(200_000), [1000, 5000, 194_000], "1,000 and 5,000 at most");
});

test("new contacts over a campaign's levels stop the rest", () => {
	assert.equal(getFirstSendProblem({ sent: 240, bounced: 6 }), null, "2.5% is the pause limit");
	assert.deepEqual(getFirstSendProblem({ sent: 240, bounced: 7 }), { level: "pause", reason: "The first 240 new contacts had a bounce rate of 2.92% (limit 2.50%)" });
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
		await addAuthor(user);
		// From a domain Gmail already knows, so only the steps hold contacts back (tests/send-spread.test.mjs holds Gmail's).
		await endSenderWarmup(user);
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

	test("2% go first, at random; 5% more 30 minutes after they're out, then the rest, each once the ones before are clean", async () => {
		const user = await setup("clean-list@example.com", { neverMailed: 5000, mailed: 100 });
		const start = Date.now();
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(user.campaignId, {})), { ok: true });
		assert.equal(await count(user, "held"), 4800);
		assert.equal(await count(user, "queued"), 300, "the first step and contacts mailed before");
		const campaign = await campaignOf(user);
		assert.equal(campaign.stats.recipients, 5100);
		assert.deepEqual(
			{ steps: campaign.firstSend.steps, step: campaign.firstSend.step, slice: campaign.firstSend.slice, held: campaign.firstSend.held },
			{ steps: [200, 250, 4550], step: 1, slice: 200, held: 4800 }
		);
		assert.ok(campaign.sendingUntil.getTime() >= start + 59 * 60_000, "about an hour, for its 2 checks");
		const contacts = await m.Contact.find({ accountId: user.accountId, newsletterId: user.newsletterId }).sort({ _id: 1 }).select({ _id: 1 }).lean();
		const firstImported = new Set(contacts.slice(0, 200).map(({ _id }) => String(_id)));
		const firstStep = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "queued" }).lean();
		assert.ok(firstStep.some(({ contactId }) => !firstImported.has(String(contactId))), "not just the top of the list");

		const batchJobs = published.filter(({ url, body }) => url.endsWith("send-batch") && String(body.accountId) === String(user.accountId));
		assert.ok(batchJobs.every(({ flowControl }) => flowControl.key === `account-${user.accountId}` && flowControl.parallelism === 1), "one batch at a time per account");
		const sends = await runJobs();
		assert.equal(sends.reduce((sum, { result }) => sum + result.sent, 0), 300);
		assert.equal((await campaignOf(user)).status, "sending", "not sent while contacts are held");

		const [second] = await runJobs({ checks: true });
		assert.ok(second.notBefore * 1000 >= start + 29 * 60_000, "30 minutes later");
		assert.deepEqual([second.result.released, second.result.step], [250, 2]);
		assert.equal(await count(user, "held"), 4550);
		assert.deepEqual([(await campaignOf(user)).firstSend.step, (await campaignOf(user)).firstSend.held], [2, 4550]);
		assert.equal((await runJobs()).reduce((sum, { result }) => sum + result.sent, 0), 250);

		const [last] = await runJobs({ checks: true });
		assert.ok(last.notBefore * 1000 >= Date.now() + 28 * 60_000, "30 minutes after the second step");
		assert.deepEqual([last.result.released, last.result.step], [4550, 3]);
		assert.equal(await count(user, "held"), 0);
		const finished = await campaignOf(user);
		assert.ok(finished.firstSend.checkedAt instanceof Date);
		assert.equal(finished.sendingUntil, undefined, "the rest goes at once");
		const batches = published.filter(({ url, body }, index) => !handled.has(index) && url.endsWith("send-batch") && String(body.accountId) === String(user.accountId));
		assert.ok(batches.every(({ notBefore }) => notBefore === undefined), "at full speed");
		await runJobs();
		assert.equal((await campaignOf(user)).status, "sent");
		assert.equal(published.filter(({ url }, index) => !handled.has(index) && url.endsWith("check-first-send")).length, 0, "no more checks");
	});

	test("a first step with too many bounces blocks the account; once an admin unblocks it, resuming sends the rest", async () => {
		const user = await setup("bought-list@example.com", { neverMailed: 400 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();
		const step = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "sent" })
			.limit(12)
			.lean();
		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: step.map(({ _id }) => _id) } }, { $set: { status: "bounced", bouncedAt: new Date() } });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: user.campaignId }, { $inc: { "stats.bounced": 12 } });

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
		assert.equal(await count(user, "held"), 200);

		assert.equal((await as(user, () => m.campaigns.resumeCampaign(user.campaignId))).code, "account_blocked");
		await m.blocks.unblockAccount(user.accountId);
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(user.campaignId)), { ok: true });
		assert.equal(await count(user, "held"), 0, "the customer chose to send the rest");
		assert.equal(await count(user, "queued"), 200);
		assert.equal((await campaignOf(user)).status, "sending");
		await runJobs();
		assert.equal((await campaignOf(user)).status, "sent", "the first step's bounces don't block it again");
		assert.equal((await m.Account.findById(user.accountId).lean()).status, "active");
		skipPublished();
	});

	test("a step out when the account was blocked counts only what goes out after the unblock", async () => {
		const user = await setup("blocked-midway@example.com", { neverMailed: 3000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();
		const step = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "sent" })
			.limit(12)
			.lean();
		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: step.map(({ _id }) => _id) } }, { $set: { status: "bounced", bouncedAt: new Date() } });
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });
		skipPublished();

		await m.blocks.unblockAccount(user.accountId);
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(user.campaignId)), { ok: true });
		const [check] = await runJobs({ checks: true });
		assert.deepEqual([check.result.blocked, check.result.released, check.result.step], [undefined, 200, 2]);
		assert.equal((await m.Account.findById(user.accountId).lean()).status, "active");
		skipPublished();
	});

	test("a step over the pause level only holds the rest, with a warning, until its owner resumes", async () => {
		const user = await setup("warm-list@example.com", { neverMailed: 3000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		await runJobs();
		const step = await m.Message.find({ accountId: user.accountId, campaignId: user.campaignId, firstSend: true, status: "sent" }).limit(6).lean();
		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: step.map(({ _id }) => _id) } }, { $set: { status: "bounced", bouncedAt: new Date() } });

		const emailsBefore = platformEmails.length;
		const [check] = await runJobs({ checks: true });
		assert.deepEqual([check.result.paused, check.result.blocked], [true, undefined]);
		const paused = await campaignOf(user);
		assert.equal(paused.pauseCode, "first_send_slice");
		assert.match(paused.pauseReason, /^The first 200 new contacts had a bounce rate of 3.00% \(limit 2.50%\)\. The rest of the new contacts wait: clean the list/);
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

	test("a check while a step is still going out waits a few more minutes", async () => {
		const user = await setup("slow-step@example.com", { neverMailed: 1000 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		const check = published.find(({ url }, index) => !handled.has(index) && url.endsWith("check-first-send"));
		skipPublished();
		const response = await m.checkRoute.POST(jsonRequest(check.url, { method: "POST", body: check.body }));
		const result = await response.json();
		assert.equal(result.waiting, true);
		assert.equal(result.due, 200);
		assert.ok(published.at(-1).url.endsWith("check-first-send"), "checks again later");
		assert.equal(await count(user, "held"), 800);
		skipPublished();
	});

	test("lists without new contacts, or small ones, go at once", async () => {
		const user = await setup("small-list@example.com", { neverMailed: 150, mailed: 50 });
		await as(user, () => m.campaigns.sendCampaign(user.campaignId, {}));
		assert.equal(await count(user, "held"), 0);
		assert.equal((await campaignOf(user)).firstSend?.slice, undefined);
		assert.equal((await campaignOf(user)).sendingUntil, undefined);
		await runJobs();
		assert.equal((await campaignOf(user)).status, "sent");
	});
});
