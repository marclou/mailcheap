import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getEventPlan } from "../lib/email-event-rules.js";
import { normalizePostshibaEvent } from "../lib/email-provider/postshiba-events.js";
import { normalizeSesEvent } from "../lib/ses-event-mapping.js";
import {
	activate,
	addAuthor,
	addVerifiedDomain,
	as,
	catchRedirect,
	endSenderWarmup,
	form,
	jsonRequest,
	mockRdap,
	platformEmails,
	signIn,
	startTestApp,
	telegramMessages,
	withEnv,
} from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

const HOUR_MS = 3_600_000;
const TELEGRAM = { TELEGRAM_BOT_TOKEN: "123456:test-bot-token-never-logged", TELEGRAM_CHAT_ID: "424242" };
// Gmail's words as PostShiba's deferrals carry them, its 4.7.28 kept apart in status. With a domain this long, the link
// is past the 300 characters a reason keeps.
const GMAIL_LIMIT =
	"Gmail has detected an unusual rate of mail originating from your SPF domain [rp.why-readers-do-that.example.org      35]. To protect our users from spam, mail sent from your domain has been temporarily rate limited. For more information, go to  https://support.google.com/mail/?p=UnsolicitedRateLimitError to review our Bulk Email Senders Guidelines. abc123 - gsmtp";

const near = (actual, expected, why, tolerance = 60_000) => assert.ok(Math.abs(actual - expected) < tolerance, `${why ?? ""} ${actual} vs ${expected}`);

test("only Gmail rate limiting a deferral backs a newsletter off, from PostShiba or SES", () => {
	const deferred = (reason, fields = {}) =>
		getEventPlan(normalizePostshibaEvent({ event: "deferred", email: "reader@example.org", reason, sg_message_id: "abc", ...fields }));
	assert.match(deferred(GMAIL_LIMIT, { status: "4.7.28", bounce_classification: "Reputation" }).rateLimit, /^4\.7\.28 Reputation, Gmail has detected/);
	assert.ok(deferred("Gmail has detected an unusual rate of mail originating from your SPF domain. - gsmtp").rateLimit, "Gmail's words alone");
	assert.ok(deferred("Mail from your domain has been temporarily rate limited.", { status: "4.7.28" }).rateLimit, "Gmail's code alone");
	assert.equal(
		deferred("Our system has detected an unusual rate of mail and is temporarily deferring", { status: "4.7.0" }).rateLimit,
		null,
		"Proton Mail's look-alike isn't Gmail"
	);
	assert.equal(deferred("421 4.7.0 Try again later, closing connection. - gsmtp").rateLimit, null);
	assert.equal(deferred("452 4.2.2 The recipient's inbox is out of storage space. - gsmtp").rateLimit, null);
	const refused = normalizePostshibaEvent({ event: "bounce", type: "blocked", email: "reader@example.org", reason: GMAIL_LIMIT });
	assert.equal(getEventPlan(refused).rateLimit, null, "a deferral only: a refusal is a bounce");
	const ses = normalizeSesEvent({
		eventType: "DeliveryDelay",
		mail: { messageId: "ses-1", destination: ["reader@example.org"] },
		deliveryDelay: { delayType: "General", delayedRecipients: [{ emailAddress: "reader@example.org", diagnosticCode: `smtp; ${GMAIL_LIMIT}` }] },
	});
	assert.match(getEventPlan(ses).rateLimit, /Gmail has detected an unusual rate/);
});

describe("a domain Gmail rate limits", () => {
	let app;
	let m;

	async function account(email) {
		const user = await signIn(email);
		await activate(user, { limitOverrides: { emailsPerMonth: 100_000, subscribers: 100_000 } });
		return user;
	}

	// A newsletter's campaign going out to contacts mailed before, at Gmail unless readersAt says where. isWarm: from a
	// domain past its first week, so only the account paces it.
	async function sending(user, slug, contacts, { fromEmail, isWarm = true, readersAt = "gmail.com" } = {}) {
		const fields = { name: slug, slug, postalAddress: "1 Main St", ...(fromEmail && { fromEmail }) };
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))));
		const send = { user, accountId: user.accountId, newsletterId: url.split("/").at(-1) };
		await addAuthor(user, send.newsletterId);
		if (isWarm) await endSenderWarmup(send);
		await m.Contact.insertMany(
			Array.from({ length: contacts }, (_, index) => ({
				accountId: user.accountId,
				newsletterId: send.newsletterId,
				email: `mailcheap-test-${slug}-${index}@${readersAt}`,
				status: "active",
				lastSentAt: new Date(Date.now() - 3 * 86_400_000),
			}))
		);
		const draftUrl = await as(user, () => catchRedirect(m.campaigns.createCampaign(send.newsletterId)));
		send.campaignId = draftUrl.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(send.campaignId, { subject: "Issue", previewText: "Hi", body: "<p>Hello</p>" }));
		const from = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(send.campaignId, {})), { ok: true });
		send.batches = jobsTo(published.slice(from), "send-batch");
		return send;
	}

	const setup = async (email, contacts) => sending(await account(email), email.split("@")[0], contacts);
	const jobsTo = (jobs, name) => jobs.filter(({ url }) => url.endsWith(`/api/jobs/${name}`));

	async function runBatches(batches) {
		for (const batch of batches) await m.sendBatchRoute.POST(jsonRequest(batch.url, { method: "POST", body: batch.body }));
	}

	// What the provider's webhook hands over for one of the campaign's emails (lib/email-events.js).
	async function defer(send, reason) {
		const message = await m.Message.findOne({ accountId: send.accountId, campaignId: send.campaignId, status: "sent" }).lean();
		return m.emailEvents.handleEmailEvent({
			type: "deferred",
			recordAs: "deferred",
			accountId: String(send.accountId),
			messageId: String(message._id),
			providerMessageId: null,
			email: message.email,
			reason,
			occurredAt: new Date(),
			data: { reason },
		});
	}

	const campaignOf = (send) => m.Campaign.findOne({ accountId: send.accountId, _id: send.campaignId }).lean();
	const domainOf = async (send, domain) =>
		m.SenderDomain.findOne({
			accountId: send.accountId,
			domain: domain ?? (await m.Newsletter.findOne({ accountId: send.accountId, _id: send.newsletterId }).lean()).sendingDomain,
		}).lean();
	const resume = async (job) => (await m.resumeRoute.POST(jsonRequest(job.url, { method: "POST", body: job.body }))).json();
	const backoffAlert = (send) => m.Alert.findOne({ accountId: null, key: `gmail-backoff:${send.newsletterId}` }).lean();

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next", SEND_RATE_PER_SECOND: "1000" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			resumeRoute: await import("../app/api/jobs/resume-send/route.js"),
			emailEvents: await import("../lib/email-events.js"),
			blocks: await import("../lib/account-blocks.js"),
			Alert: (await import("../models/Alert.js")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
			SenderDomain: (await import("../models/SenderDomain.js")).default,
		};
	});

	after(() => app?.stop());

	test("its sends pause for 6 hours, the owner hears of it and the admin page shows it, then Gmail gets half its day, spread over 3 doubling days", async () => {
		const send = await setup("rate-limited@example.com", 1000);
		await runBatches(send.batches.slice(0, 8));
		const before = { emails: platformEmails.length, telegram: telegramMessages.length, jobs: published.length };
		const limitedAt = Date.now();
		await withEnv(TELEGRAM, () => defer(send, GMAIL_LIMIT));

		const paused = await campaignOf(send);
		assert.deepEqual([paused.status, paused.pauseCode], ["paused", "rate_limited"]);
		assert.match(paused.pauseReason, /^Gmail asked to slow down, so this newsletter's sends wait 6 hours/);
		const domain = await domainOf(send);
		near(domain.startedAt.getTime(), limitedAt + 6 * HOUR_MS, "its days start when its sends go on");
		assert.deepEqual([domain.firstDay, domain.days], [200, 3], "half of the 400 Gmail emails it sent in the last day, for 3 days");
		const jobs = published.slice(before.jobs);
		assert.deepEqual(jobs.map(({ url }) => new URL(url).pathname), ["/api/jobs/resume-send"]);
		near(jobs[0].notBefore * 1000, limitedAt + 6 * HOUR_MS);
		assert.deepEqual(
			platformEmails.slice(before.emails).map(({ to, subject }) => [to[0], subject]),
			[["rate-limited@example.com", "[MailCheap] Campaign paused"]],
			"MailCheap handles it, so the admins get neither an email nor a Telegram message"
		);
		assert.equal(telegramMessages.length, before.telegram);
		const alert = await backoffAlert(send);
		assert.deepEqual(alert.occurrences.map(({ emailed, telegram }) => ({ emailed, telegram })), [{ emailed: false, telegram: false }]);
		assert.match(alert.occurrences[0].detail, /Gmail answered: .*unusual rate of mail/);

		await withEnv(TELEGRAM, () => defer(send, GMAIL_LIMIT));
		assert.equal(published.length, before.jobs + 1, "Gmail saying it again, about emails still queued, changes nothing");
		assert.equal((await backoffAlert(send)).count, 1);
		assert.equal((await domainOf(send)).firstDay, 200);

		const resumedFrom = published.length;
		const resumed = await resume(jobs[0]);
		assert.equal(resumed.resumed, true);
		assert.equal((await campaignOf(send)).status, "sending");
		const batches = jobsTo(published.slice(resumedFrom), "send-batch");
		assert.equal(batches.length, 12, "the 600 left");
		assert.ok(
			batches.every(({ notBefore }) => notBefore * 1000 >= limitedAt + 6 * HOUR_MS - 60_000),
			"nothing goes before the 6 hours"
		);
		near(batches[1].notBefore * 1000, limitedAt + 12 * HOUR_MS, "spread over the day: the 51st a quarter into it", 120_000);
		near(
			batches.at(-1).notBefore * 1000,
			limitedAt + (6 + 24 + 21) * HOUR_MS,
			"200 over its first day, the last 350 into its second day's 400",
			120_000
		);

		assert.deepEqual(await resume(jobs[0]), { skipped: "campaign is sending" }, "a job late or twice does nothing");
	});

	test("a send resumed early waits for the back-off, and pauses again if Gmail says it again, without a new alert", async () => {
		const send = await setup("resumed-early@example.com", 1000);
		await runBatches(send.batches.slice(0, 8));
		const limitedAt = Date.now();
		await defer(send, GMAIL_LIMIT);
		assert.equal((await backoffAlert(send)).count, 1);

		const from = published.length;
		assert.deepEqual(await as(send.user, () => m.campaigns.resumeCampaign(send.campaignId)), { ok: true });
		const early = jobsTo(published.slice(from), "send-batch");
		assert.ok(early.every(({ notBefore }) => notBefore * 1000 >= limitedAt + 6 * HOUR_MS - 60_000), "its batches wait for the 6 hours");

		const again = published.length;
		await defer(send, GMAIL_LIMIT);
		const paused = await campaignOf(send);
		assert.deepEqual([paused.status, paused.pauseCode], ["paused", "rate_limited"]);
		const [job] = jobsTo(published.slice(again), "resume-send");
		near(job.notBefore * 1000, limitedAt + 6 * HOUR_MS, "it goes on when the back-off ends, not 6 hours from now");
		assert.equal((await backoffAlert(send)).count, 1);
	});

	test("a newsletter that moves to another domain during a back-off still waits for it, from no more emails", async () => {
		const send = await setup("moved-in-backoff@example.com", 1000);
		await runBatches(send.batches.slice(0, 8));
		const limitedAt = Date.now();
		await defer(send, GMAIL_LIMIT);
		await addVerifiedDomain(send.user, "moved-in-backoff.example.org");
		await m.Newsletter.updateOne({ accountId: send.accountId, _id: send.newsletterId }, { $set: { fromEmail: "news@moved-in-backoff.example.org" } });

		const from = published.length;
		assert.deepEqual(await as(send.user, () => m.campaigns.resumeCampaign(send.campaignId)), { ok: true });
		const batches = jobsTo(published.slice(from), "send-batch");
		assert.equal(batches.length, 12);
		assert.ok(batches.every(({ notBefore }) => notBefore * 1000 >= limitedAt + 6 * HOUR_MS - 60_000), "nothing before the back-off ends");
		const moved = await domainOf(send, "moved-in-backoff.example.org");
		near(moved.startedAt.getTime(), limitedAt + 6 * HOUR_MS);
		assert.deepEqual([moved.firstDay, moved.days], [200, 3], "the back-off's emails and days, under a new domain's 2,000");
	});

	test("newsletters on one new domain share its first day with Gmail and its back-off", async () => {
		const user = await account("two-lists@example.com");
		await addVerifiedDomain(user, "two-lists.example.org");
		mockRdap((domain) => (domain === "two-lists.example.org" ? new Date(Date.now() - 3 * 86_400_000) : null));
		const first = await sending(user, "first-list", 1200, { fromEmail: "first@two-lists.example.org", isWarm: false });
		const second = await sending(user, "second-list", 1200, { fromEmail: "second@two-lists.example.org", isWarm: false });
		mockRdap(null);
		assert.ok(first.batches.every(({ notBefore }) => notBefore === undefined), "1,200 of the day's 2,000");
		assert.deepEqual(
			[second.batches.filter(({ notBefore }) => notBefore === undefined).length, second.batches.filter(({ notBefore }) => notBefore).length],
			[16, 8],
			"the second gets the other 800 today, after the first one's emails, and its last 400 the next day"
		);
		assert.equal(await m.SenderDomain.countDocuments({ accountId: user.accountId }), 1, "one first day for the domain");

		await runBatches(first.batches.slice(0, 4));
		await defer(first, GMAIL_LIMIT);
		assert.deepEqual([(await campaignOf(first)).status, (await campaignOf(second)).status], ["paused", "paused"]);
	});

	test("a send that can't go on by itself stays paused and says why; a canceled one stays canceled", async () => {
		const send = await setup("blocked-after-limit@example.com", 400);
		await runBatches(send.batches.slice(0, 2));
		const from = published.length;
		await defer(send, GMAIL_LIMIT);
		const [job] = jobsTo(published.slice(from), "resume-send");
		await m.blocks.blockAccount(send.accountId, { reason: "A spam trap", by: "admin" });
		const result = await resume(job);
		assert.match(result.skipped, /blocked/i);
		const campaign = await campaignOf(send);
		assert.equal(campaign.status, "paused");
		assert.equal(campaign.pauseCode, undefined, "its owner resumes it once the account can send");
		assert.match(campaign.pauseReason, /^it couldn't go on by itself: /);

		const other = await setup("canceled-after-limit@example.com", 400);
		await runBatches(other.batches.slice(0, 2));
		const otherFrom = published.length;
		await defer(other, GMAIL_LIMIT);
		await m.Campaign.updateOne({ accountId: other.accountId, _id: other.campaignId }, { $set: { status: "canceled" } });
		assert.deepEqual(await resume(jobsTo(published.slice(otherFrom), "resume-send")[0]), { skipped: "campaign is canceled" });
	});

	test("another mail server saying Gmail's words, to stall a newsletter, changes nothing", async () => {
		const send = await sending(await account("not-gmail@example.com"), "not-gmail", 400, { readersAt: "example.org" });
		await runBatches(send.batches.slice(0, 2));
		const from = published.length;
		await defer(send, GMAIL_LIMIT);
		assert.equal((await campaignOf(send)).status, "sending");
		assert.equal(published.length, from);
	});

	test("a self-hosted server sends at full speed, so Gmail's limit only shows in the events", async () => {
		const send = await setup("self-hosted-limit@example.com", 400);
		await runBatches(send.batches.slice(0, 2));
		const from = published.length;
		await withEnv({ MAILCHEAP_CLOUD: "" }, () => defer(send, GMAIL_LIMIT));
		assert.equal((await campaignOf(send)).status, "sending");
		assert.equal(published.length, from);
	});
});

