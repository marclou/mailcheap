import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getEventPlan, withRefusal } from "../lib/email-event-rules.js";
import { normalizePostshibaEvent } from "../lib/email-provider/postshiba-events.js";
import {
	activate,
	addAuthor,
	as,
	catchRedirect,
	endSenderWarmup,
	form,
	jsonRequest,
	platformEmails,
	signIn,
	startTestApp,
	telegramMessages,
	withEnv,
} from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

const TELEGRAM = { TELEGRAM_BOT_TOKEN: "123456:test-bot-token-never-logged", TELEGRAM_CHAT_ID: "424242" };
// Gmail's words as PostShiba's refusals carry them: a "blocked" bounce, its 5.7.1 kept apart in status.
const GMAIL_UNSOLICITED =
	"[192.0.2.10      12] Gmail has detected that this message is likely unsolicited mail. To reduce the amount of spam sent to Gmail, this message has been blocked. For more information, go to  https://support.google.com/mail/?p=UnsolicitedMessageError abc123 - gsmtp";
const PAUSE_REASON = /^Gmail refusal rate of \d+\.\d{2}% on this campaign \(limit 2\.00%\)\. Gmail refuses emails it reads as unsolicited: check that these contacts asked for your emails before you resume\.$/;

test("only Gmail refusing an email to a Gmail address as unsolicited counts against its send", () => {
	const READER = "reader@gmail.com";
	const plan = (fields) => getEventPlan(normalizePostshibaEvent({ email: READER, sg_message_id: "abc", ...fields }));
	const bounce = (reason, fields = {}) => plan({ event: "bounce", type: "blocked", status: "5.7.1", bounce_classification: "Reputation", reason, ...fields });
	const counts = (event, recipient = READER) => withRefusal(event, recipient).firsts.some(({ field }) => field === "refusedAt");

	const refused = bounce(GMAIL_UNSOLICITED);
	assert.deepEqual(withRefusal(refused, READER).firsts, [{ field: "refusedAt", stat: "refused" }]);
	assert.deepEqual([refused.status, refused.suppression], [null, null], "the email stays sent, and its contact as it is");
	assert.match(refused.error, /^Soft bounce: Reputation, \[192\.0\.2\.10 +12\] Gmail has detected that this message is likely unsolicited mail/);
	assert.ok(counts(bounce("Gmail has detected that this message is likely unsolicited mail. - gsmtp"), "reader@googlemail.com"), "Gmail's words alone");
	assert.equal(counts(refused, "reader@example.org"), false, "another mail server saying Gmail's words");
	assert.equal(
		counts(bounce("Gmail has detected that this message is likely suspicious due to the very low reputation of the sending IP address. - gsmtp")),
		false,
		"Gmail refusing the sending IP"
	);
	assert.equal(counts(bounce("The recipient's inbox is out of storage space. - gsmtp", { status: "5.2.2" })), false);

	const hard = plan({ event: "bounce", type: "bounce", reason: GMAIL_UNSOLICITED });
	assert.deepEqual(withRefusal(hard, READER).firsts, [{ field: "bouncedAt", stat: "bounced" }], "a hard bounce counts as one already");
	assert.equal(counts(plan({ event: "deferred", reason: GMAIL_UNSOLICITED })), false, "a deferral isn't a refusal");
});

describe("a send Gmail refuses as unsolicited", () => {
	let app;
	let m;

	async function account(email) {
		const user = await signIn(email);
		await activate(user, { limitOverrides: { emailsPerMonth: 100_000, subscribers: 100_000 } });
		return user;
	}

	// A newsletter's campaign going out from a domain Gmail already knows, to contacts at readersAt, mailed before unless
	// isNew. Its jobs: the send's batches, and its first-send checks.
	async function sending(email, contacts, { readersAt = "gmail.com", isNew = false } = {}) {
		const user = await account(email);
		const slug = email.split("@")[0];
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St" }))));
		const send = { user, accountId: user.accountId, newsletterId: url.split("/").at(-1) };
		await addAuthor(user, send.newsletterId);
		await endSenderWarmup(send);
		await m.Contact.insertMany(
			Array.from({ length: contacts }, (_, index) => ({
				accountId: user.accountId,
				newsletterId: send.newsletterId,
				email: `mailcheap-test-${slug}-${index}@${readersAt}`,
				status: "active",
				...(!isNew && { lastSentAt: new Date(Date.now() - 3 * 86_400_000) }),
			}))
		);
		const draftUrl = await as(user, () => catchRedirect(m.campaigns.createCampaign(send.newsletterId)));
		send.campaignId = draftUrl.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(send.campaignId, { subject: "Issue", previewText: "Hi", body: "<p>Hello</p>" }));
		send.from = published.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(send.campaignId, {})), { ok: true });
		return send;
	}

	// The send's jobs published since it last ran them, in order: batches, or first-send checks.
	async function runJobs(send, name = "send-batch", limit = Infinity) {
		const route = name === "send-batch" ? m.sendBatchRoute : m.checkRoute;
		const jobs = published
			.slice(send.from)
			.filter(({ url, body }) => url.endsWith(`/api/jobs/${name}`) && String(body.accountId) === String(send.accountId))
			.filter((job) => !send.ran?.has(job))
			.slice(0, limit);
		send.ran ??= new Set();
		for (const job of jobs) {
			send.ran.add(job);
			await route.POST(jsonRequest(job.url, { method: "POST", body: job.body }));
		}
		return jobs.length;
	}

	// What the provider's webhook hands over when Gmail refuses one of the campaign's emails (lib/email-events.js): the
	// next ones not refused yet, or again the ones given.
	async function refuse(send, count, { messages, firstSend } = {}) {
		const refusing =
			messages ??
			(await m.Message.find({ accountId: send.accountId, campaignId: send.campaignId, kind: "campaign", status: "sent", refusedAt: null, ...(firstSend && { firstSend: true }) })
				.limit(count)
				.lean());
		for (const message of refusing) {
			await m.emailEvents.handleEmailEvent({
				type: "bounce",
				recordAs: "bounce",
				bounce: "soft",
				accountId: String(send.accountId),
				messageId: String(message._id),
				providerMessageId: null,
				email: message.email,
				reason: `Reputation, ${GMAIL_UNSOLICITED}`,
				occurredAt: new Date(),
				data: { type: "blocked", status: "5.7.1", reason: GMAIL_UNSOLICITED },
			});
		}
		return refusing;
	}

	const campaignOf = (send) => m.Campaign.findOne({ accountId: send.accountId, _id: send.campaignId }).lean();
	const accountOf = (send) => m.Account.findById(send.accountId).lean();
	const adminAlert = (send) => m.Alert.findOne({ accountId: null, key: `gmail-refusals:${send.campaignId}` }).lean();

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next", SEND_RATE_PER_SECOND: "1000" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			checkRoute: await import("../app/api/jobs/check-first-send/route.js"),
			emailEvents: await import("../lib/email-events.js"),
			Account: (await import("../models/Account.js")).default,
			Alert: (await import("../models/Alert.js")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
	});

	after(() => app?.stop());

	test("over 2%, with 10 at least, it pauses at its next batch: its owner hears why, and the admins on Telegram", async () => {
		const send = await sending("refused-list@example.com", 1000);
		await runJobs(send, "send-batch", 2);
		await refuse(send, 9);
		await runJobs(send, "send-batch", 1);
		assert.equal((await campaignOf(send)).status, "sending", "9 refusals, at 9% of 100, are under the minimum");

		const before = { emails: platformEmails.length, telegram: telegramMessages.length };
		const [again] = await refuse(send, 2);
		await withEnv(TELEGRAM, () => runJobs(send, "send-batch", 1));
		const paused = await campaignOf(send);
		assert.deepEqual([paused.status, paused.pauseCode, paused.stats.sent, paused.stats.refused], ["paused", "high_rates", 150, 11]);
		assert.match(paused.pauseReason, PAUSE_REASON);
		assert.match(paused.pauseReason, /^Gmail refusal rate of 7\.33%/, "11 of 150");
		assert.equal((await accountOf(send)).status, "active");

		const emails = platformEmails.slice(before.emails).map(({ to, subject }) => [to[0], subject]);
		assert.deepEqual(emails, [
			["refused-list@example.com", "[MailCheap] Campaign paused"],
			["admin@example.com", "[MailCheap] Gmail refuses a campaign as unsolicited"],
		]);
		const telegram = telegramMessages.slice(before.telegram);
		assert.equal(telegram.length, 1);
		assert.match(telegram[0].text, /Gmail refuses a campaign as unsolicited/);
		const alert = await adminAlert(send);
		assert.match(alert.occurrences[0].detail, new RegExp(`^refused-list \\(refused-list\\.mailcheapmail\\.com\\), account ${send.accountId}, campaign ${send.campaignId}: Gmail refusal rate`));

		await refuse(send, 1, { messages: [await m.Message.findOne({ accountId: send.accountId, _id: again._id }).lean()] });
		assert.equal((await campaignOf(send)).stats.refused, 11, "the same refusal delivered twice counts once");
	});

	test("resumed, it goes on to the end: Gmail's refusals never block the account", async () => {
		const send = await sending("resumed-refused@example.com", 600);
		await runJobs(send, "send-batch", 4);
		await refuse(send, 100);
		await runJobs(send, "send-batch", 1);
		assert.equal((await campaignOf(send)).status, "paused");
		assert.equal((await adminAlert(send)).count, 1);

		send.from = published.length;
		assert.deepEqual(await as(send.user, () => m.campaigns.resumeCampaign(send.campaignId)), { ok: true });
		await runJobs(send, "send-batch", 1);
		await refuse(send, 100);
		await runJobs(send);
		const sent = await campaignOf(send);
		assert.deepEqual([sent.status, sent.stats.sent, sent.stats.refused], ["sent", 600, 200]);
		assert.equal((await accountOf(send)).status, "active", "a refusal rate of 33.33% only paused it");
		assert.equal((await adminAlert(send)).count, 1, "the admins heard of it once");
	});

	test("another mail server saying Gmail's words, to pause a newsletter, changes nothing", async () => {
		const send = await sending("not-gmail-refusals@example.com", 400, { readersAt: "example.org" });
		await runJobs(send, "send-batch", 1);
		await refuse(send, 50);
		await runJobs(send, "send-batch", 1);
		const campaign = await campaignOf(send);
		assert.deepEqual([campaign.status, campaign.stats.sent, campaign.stats.refused], ["sending", 100, 0]);
	});

	test("a first send's step Gmail refuses holds the rest of its new contacts, and the admins hear of it", async () => {
		const send = await sending("refused-first-send@example.com", 400, { isNew: true });
		assert.deepEqual((await campaignOf(send)).firstSend.steps, [200, 200]);
		await runJobs(send);
		await refuse(send, 10, { firstSend: true });
		await runJobs(send, "check-first-send");
		const paused = await campaignOf(send);
		assert.deepEqual([paused.status, paused.pauseCode], ["paused", "first_send_slice"]);
		assert.equal(
			paused.pauseReason,
			"The first 200 new contacts had a Gmail refusal rate of 5.00% (limit 2.00%). The rest of the new contacts wait: clean the list of addresses you can't vouch for, then resume to send to them."
		);
		assert.equal(await m.Message.countDocuments({ accountId: send.accountId, campaignId: send.campaignId, status: "held" }), 200);
		assert.ok(await adminAlert(send));
		assert.equal((await accountOf(send)).status, "active");
	});
});
