import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, addAuthor, addSentIssue, anonymous, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// Sends go through the real code: QStash jobs are kept by the stub and run here through the job route,
// SES sends land in the stub. Accounts get tiny limits so each case sends a handful of emails.
let app;
let m;
let processed = 0;

async function runJobs() {
	const results = [];
	while (processed < published.length) {
		const { url, body } = published[processed++];
		const route = url.endsWith("/api/jobs/send-batch") ? m.sendBatchRoute : m.scheduledRoute;
		const response = await route.POST(jsonRequest(url, { method: "POST", body }));
		results.push(await response.json());
	}
	return results;
}

async function setup(email, { emails, subscribers, contacts, welcome = false }) {
	const user = await signIn(email);
	await activate(user, { limitOverrides: { emailsPerMonth: emails, subscribers } });
	const slug = email.split("@")[0].replace(/[^a-z0-9]/g, "-");
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({
					name: `${slug} news`,
					slug,
					fromEmail: `hello@${slug}.mailcheapmail.com`,
					postalAddress: "1 Main St, Paris",
					archiveEnabled: "on",
					...(welcome && { welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeContent: "Thanks for joining." }),
				})
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
	await addAuthor(user);
	user.slug = slug;
	const rows = Array.from({ length: contacts }, (_, index) => ({ email: `reader${index}@${slug}.example.org`, status: "active" }));
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	return user;
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

async function usage(user) {
	return (await m.Account.findById(user.accountId).lean()).usage;
}

async function setUsage(user, emailsSent) {
	await m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.emailsSent": emailsSent } });
}

async function createApiKey(user) {
	user.apiKey ??= (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site" })))).key;
	return user.apiKey;
}

async function signup(user, email) {
	const key = await createApiKey(user);
	const response = await callApi("POST", "/api/v1/contacts", { key, body: { newsletter: user.slug, email } });
	await flushAfter();
	return response;
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../app/archive/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		scheduledRoute: await import("../app/api/jobs/send-scheduled/route.js"),
		accounts: await import("../lib/accounts.js"),
		blocks: await import("../lib/account-blocks.js"),
		usage: await import("../lib/usage.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
	};
});

after(() => app?.stop());

describe("counting", () => {
	test("every email the account sends counts: issues and tests", async () => {
		const user = await setup("counting@example.com", { emails: 100, subscribers: 100, contacts: 3 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.equal((await usage(user)).emailsSent, 1);

		const before = sesEmails.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const [batch] = await runJobs();
		assert.equal(batch.sent, 3);
		assert.equal(sesEmails.length - before, 3);
		assert.deepEqual([...new Set(sesEmails.slice(before).map(({ headers }) => headers["Feedback-ID"]))], [`${id}:mc-${user.accountId}:campaign:mailcheap`]);
		assert.equal((await usage(user)).emailsSent, 4);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
	});

	test("welcome emails count, and stop at the limit while signups keep coming in", async () => {
		const user = await setup("welcome@example.com", { emails: 1, subscribers: 100, contacts: 0, welcome: true });
		assert.equal((await signup(user, "first-reader@example.org")).status, 201);
		const first = await m.Message.findOne({ accountId: user.accountId, kind: "welcome", email: "first-reader@example.org" }).lean();
		assert.equal(first.status, "sent");
		assert.equal((await usage(user)).emailsSent, 1, "counted");

		const before = sesEmails.length;
		assert.equal((await signup(user, "new-reader@example.org")).status, 201);
		const welcome = await m.Message.findOne({ accountId: user.accountId, kind: "welcome", email: "new-reader@example.org" }).lean();
		assert.deepEqual([welcome.status, welcome.error], ["skipped", "This month's emails are used up"]);
		assert.equal(sesEmails.length, before);
		assert.equal((await usage(user)).emailsSent, 1, "never past the limit");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, status: "active" }), 2, "the signup went through");
	});
});

describe("blocking", () => {
	test("a send that needs more emails than are left is refused with plan_limit_emails", async () => {
		const user = await setup("emails@example.com", { emails: 5, subscribers: 100, contacts: 4 });
		await setUsage(user, 2);
		const id = await draft(user);
		const result = await as(user, () => m.campaigns.sendCampaign(id, {}));
		assert.deepEqual(result, {
			error: "This send needs 4 emails and your plan has 3 left this month. Upgrade to send.",
			code: "plan_limit_emails",
		});
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "draft");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id }), 0, "nothing was queued");

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, { audienceLimit: 3 })), { ok: true }, "fewer contacts fit");
		await runJobs();
		assert.equal((await usage(user)).emailsSent, 5);
	});

	test("an account over its subscriber limit can't send, but keeps taking signups", async () => {
		const user = await setup("subscribers@example.com", { emails: 1_000, subscribers: 2, contacts: 3 });
		const id = await draft(user);
		const result = await as(user, () => m.campaigns.sendCampaign(id, {}));
		assert.equal(result.code, "plan_limit_subscribers");
		assert.equal(result.error, "You have 3 subscribers and your plan allows 2. Upgrade to send.");
		assert.equal((await signup(user, "still-welcome@example.org")).status, 201);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, status: "active" }), 4);
	});

	test("scheduling checks the plan, and a schedule after the reset only checks subscribers", async () => {
		const user = await setup("schedule@example.com", { emails: 3, subscribers: 100, contacts: 4 });
		const id = await draft(user);
		const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
		assert.equal((await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: soon }))).code, "plan_limit_emails");
		const { usage: current } = await m.Account.findById(user.accountId).lean();
		const afterReset = new Date(current.periodEnd.getTime() + 3_600_000).toISOString();
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: afterReset })), { ok: true });
	});

	test("a scheduled send that no longer fits goes back to draft when it's due", async () => {
		const user = await setup("due@example.com", { emails: 10, subscribers: 100, contacts: 2 });
		const id = await draft(user);
		const at = new Date(Date.now() + 3_600_000);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: at.toISOString() })), { ok: true });
		published.length = processed;
		await setUsage(user, 10);
		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { scheduledAt: new Date(Date.now() + 10_000) } });
		const { scheduledAt } = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		const response = await m.scheduledRoute.POST(
			jsonRequest("/api/jobs/send-scheduled", { method: "POST", body: { accountId: String(user.accountId), campaignId: id, scheduledAt: scheduledAt.toISOString() } })
		);
		const result = await response.json();
		assert.equal(result.code, "plan_limit_emails");
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "draft");
	});

	test("emails another send is still sending count against the next one", async () => {
		const user = await setup("inflight@example.com", { emails: 6, subscribers: 100, contacts: 4 });
		const first = await draft(user, "First");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(first, {})), { ok: true });
		const second = await draft(user, "Second");
		const result = await as(user, () => m.campaigns.sendCampaign(second, {}));
		assert.equal(result.error, "This send needs 4 emails and your plan has 2 left this month. Upgrade to send.");
		await runJobs();
	});

	test("the batch stops at the limit: the campaign pauses with the code, and resumes after an upgrade", async () => {
		const user = await setup("hardstop@example.com", { emails: 4, subscribers: 100, contacts: 4 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await setUsage(user, 2);
		const [batch] = await runJobs();
		assert.equal(batch.sent, 2);
		let campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.equal(campaign.pauseCode, "plan_limit_emails");
		assert.equal(campaign.pauseReason, "this month's emails are used up");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 2);
		assert.equal((await usage(user)).emailsSent, 4, "never past the limit");

		assert.equal((await as(user, () => m.campaigns.resumeCampaign(id))).code, "plan_limit_emails");
		await m.accounts.setLimitOverrides(user.accountId, { emailsPerMonth: 10, subscribers: 100 });
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(id)), { ok: true });
		await runJobs();
		campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "sent");
		assert.equal(campaign.pauseCode, undefined);
		assert.equal(campaign.stats.sent, 4);
		assert.equal((await usage(user)).emailsSent, 6);
	});
});

describe("blocked and canceled accounts", () => {
	test("a block mid-send stops the next batch, and the campaign says why", async () => {
		const user = await setup("midsend@example.com", { emails: 100, subscribers: 100, contacts: 2 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });
		const [batch] = await runJobs();
		assert.equal(batch.sent, 0);
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.equal(campaign.pauseCode, "account_blocked");
		assert.equal(campaign.pauseReason, "the account is blocked");
		assert.equal((await usage(user)).emailsSent, 0, "nothing sent, nothing counted");
	});

	test("a canceled account takes no signups and sends no signup emails; its archive is offline", async () => {
		const user = await setup("canceled@example.com", { emails: 100, subscribers: 100, contacts: 1, welcome: true });
		await createApiKey(user);
		await addSentIssue(user);
		const { getArchiveNewsletter } = await import("../lib/archive-data.js");
		assert.ok(await getArchiveNewsletter(user.slug), "online before");
		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
		assert.equal((await signup(user, "too-late@example.org")).status, 402);
		const formResult = await anonymous(() => m.archive.subscribe(null, form({ newsletter: user.slug, email: "visitor@example.org" })));
		assert.deepEqual(formResult, { error: "This newsletter is not taking signups" });
		assert.equal(await getArchiveNewsletter(user.slug), null);

		const newsletter = await (await import("../models/Newsletter.js")).default.findOne({ accountId: user.accountId }).lean();
		const reader = await m.Contact.findOne({ accountId: user.accountId }).lean();
		const { queueWelcomeEmail } = await import("../lib/sending.js");
		assert.deepEqual(await queueWelcomeEmail({ newsletter, contact: { ...reader, status: "active" } }), { skipped: "no active plan" });
	});
});

describe("yearly plans", () => {
	test("the email count starts over each month of a paid year", async () => {
		const user = await setup("yearly@example.com", { emails: 100, subscribers: 100, contacts: 0 });
		const start = new Date(Date.now() - 45 * 86_400_000);
		const { startUsagePeriod, addMonths } = await import("../lib/usage-period.js");
		const usageFields = { ...startUsagePeriod({ start, end: addMonths(start, 12) }), emailsSent: 80 };
		await m.Account.updateOne({ _id: user.accountId }, { $set: { interval: "year", usage: usageFields } });
		const account = await m.Account.findById(user.accountId).lean();
		const current = await m.usage.getUsage(account);
		assert.equal(current.emailsSent, 0);
		assert.ok(current.periodStart > start && current.periodStart <= new Date());
		assert.ok(current.periodEnd > new Date());
	});
});
