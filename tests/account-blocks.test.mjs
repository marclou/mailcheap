import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { createConfirmToken } from "../lib/confirmation.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { getClickUrl, getOpenUrl } from "../lib/tracking.js";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, addAuthor, anonymous, as, callApi, catchNotFound, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

test("only a hard bounce that names a spam trap counts as a trap hit", () => {
	const bounce = (type, reason) => getEventPlan({ type: "bounce", bounce: type, reason, email: "reader@example.org" });
	assert.equal(bounce("hard", "550 5.1.1 This address is a spam trap").isSpamTrap, true);
	assert.equal(bounce("hard", "550 honeypot address, mail refused").isSpamTrap, true);
	assert.equal(bounce("hard", "550 5.1.1 spamtrap@example.org: user unknown").isSpamTrap, true);
	assert.equal(bounce("hard", "550 5.1.1 User unknown").isSpamTrap, false);
	assert.equal(bounce("soft", "554 5.7.1 Client host listed for spamtrap hits").isSpamTrap, false, "a shared IP's listing isn't this account's");
	assert.equal(getEventPlan({ type: "complaint", email: "reader@example.org" }).isSpamTrap, false);
});

let app;
let m;
let admin;
let processed = 0;

// Every pending batch, as QStash would deliver them; the results of this account's. Scheduled sends run by hand.
async function runJobs(user) {
	const results = [];
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (!url.endsWith("/api/jobs/send-batch")) continue;
		const result = await (await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }))).json();
		if (String(body.accountId) === String(user.accountId)) results.push(result);
	}
	return results;
}

const sentCount = (results) => results.reduce((sum, { sent = 0 }) => sum + sent, 0);
const loadAccount = (user) => m.Account.findById(user.accountId).lean();
const loadCampaign = (user, id) => m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();

async function customer(email, { contacts = 2, isFree = false } = {}) {
	const user = await signIn(email);
	if (isFree) assert.equal((await as(admin, () => m.admin.giveFreePlan(null, form({ accountId: String(user.accountId), plan: "starter" })))).ok, true);
	else await activate(user);
	const slug = email.split("@")[0];
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
					welcomeEnabled: "on",
					welcomeSubject: "Welcome",
					welcomeContent: "Thanks for joining.",
				})
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
	await addAuthor(user);
	user.slug = slug;
	if (contacts > 0) {
		const rows = Array.from({ length: contacts }, (_, index) => ({ email: `reader${index}@${slug}.example.org`, status: "active" }));
		await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	}
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent" })))).key;
	return user;
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

// Emails the account sent an hour ago, delivered, for events to land on.
function sentMessages(user, count) {
	const now = Date.now();
	return m.Message.insertMany(
		Array.from({ length: count }, (_, index) => ({
			kind: "campaign",
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId: new mongoose.Types.ObjectId(),
			contactId: new mongoose.Types.ObjectId(),
			email: `sent${index}@${user.slug}.example.org`,
			status: "delivered",
			providerMessageId: `provider-${user.accountId}-${index}`,
			sentAt: new Date(now - 3_600_000),
			deliveredAt: new Date(now - 3_500_000),
		}))
	);
}

// Emails the account sent at a given time, the first `bounced` of them hard bounced. campaignId: a send of its own.
function sendsAt(user, { at, sent, bounced, campaignId }) {
	return m.Message.insertMany(
		Array.from({ length: sent }, (_, index) => ({
			kind: "campaign",
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId: campaignId ?? new mongoose.Types.ObjectId(),
			contactId: new mongoose.Types.ObjectId(),
			email: `gone${index}@${user.slug}.example.org`,
			status: index < bounced ? "bounced" : "delivered",
			sentAt: at,
			...(index < bounced && { bouncedAt: at }),
		}))
	);
}

function event(user, message, fields) {
	return m.events.handleEmailEvent({ accountId: String(user.accountId), messageId: String(message._id), email: message.email, emails: [message.email], ...fields });
}

function alertsSince(index) {
	return platformEmails.slice(index).filter(({ subject }) => subject === "[MailCheap] Account blocked");
}

function assertError(response, status, code) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	assert.equal(response.body.error.code, code);
}

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const DESTINATION = "https://example.net/issue?ref=newsletter";
const tokenOf = (url) => url.split("/").at(-1);
const loadMessage = (user, message) => m.Message.findOne({ accountId: user.accountId, _id: message._id }).lean();
const loadContact = (contact) => m.Contact.findOne({ accountId: contact.accountId, _id: contact._id }).lean();

// From a reader's browser, not a link scanner, so the click counts.
function click(message, method = "GET") {
	const url = getClickUrl("http://localhost:3000", message._id, DESTINATION);
	const request = new Request(url, { method, headers: { "user-agent": BROWSER } });
	return m.clickRoute[method](request, { params: Promise.resolve({ token: tokenOf(url) }) });
}

function open(message) {
	const url = getOpenUrl("http://localhost:3000", message._id);
	return m.openRoute.GET(new Request(url), { params: Promise.resolve({ token: tokenOf(url) }) });
}

const answerOf = (response) => [response.status, response.headers.get("location"), response.headers.get("cache-control")];

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../app/archive/actions.js"),
		admin: await import("../app/admin/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		clickRoute: await import("../app/c/[token]/route.js"),
		openRoute: await import("../app/o/[token]/route.js"),
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		confirm: await import("../app/confirm/actions.js"),
		blocks: await import("../lib/account-blocks.js"),
		health: await import("../lib/account-health.js"),
		events: await import("../lib/email-events.js"),
		scheduling: await import("../lib/scheduling.js"),
		sending: await import("../lib/sending.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		siteExtensions: (await import("@/lib/site-extensions")).siteExtensions,
	};
	admin = await signIn("admin@example.com");
});

after(() => app?.stop());

describe("what blocks an account", () => {
	test("a hard bounce from a spam trap, at once: the admins get the address, the owner the reason", async () => {
		const user = await customer("trap@example.com", { contacts: 0 });
		const [soft, hard] = await sentMessages(user, 2);
		await event(user, soft, { type: "bounce", bounce: "soft", reason: "554 5.7.1 Client host listed for spamtrap hits" });
		assert.equal((await loadAccount(user)).status, "active");

		const emailsBefore = platformEmails.length;
		await event(user, hard, { type: "bounce", bounce: "hard", reason: "550 5.1.1 This address is a spam trap" });
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.pausedBy], ["paused", "trap"]);
		assert.equal(account.pauseReason, "An email reached a spam trap, an address found only on bought, scraped or old lists");

		const alerts = alertsSince(emailsBefore);
		const toAdmins = alerts.find(({ to }) => to.includes("admin@example.com"));
		const toOwner = alerts.find(({ to }) => to.includes("trap@example.com"));
		assert.match(toAdmins.text, /blocked by a spam trap/);
		assert.ok(toAdmins.text.includes(`${hard.email} bounced: Hard bounce: 550 5.1.1 This address is a spam trap`));
		assert.ok(!toOwner.text.includes(hard.email), "the trap's address stays with the admins");
		assert.ok(toOwner.text.endsWith(`welcome emails included, and imports and changes are off. Chat with us to unblock it.\nhttp://localhost:3000${m.siteExtensions.supportChatPath ?? "/"}`), toOwner.text);
		assert.ok(!toOwner.text.includes("hello@mailcheap.ai"), "the chat, not email");
	});

	test("over 7 days: 1 complaint does nothing, 2 warn the owner, 3 over 0.3% block, each counted at once", async () => {
		const user = await customer("complaints@example.com", { contacts: 0 });
		const messages = await sentMessages(user, 100);
		const subjectsSince = (index) => platformEmails.slice(index).map(({ to, subject }) => `${to.join(",")} ${subject}`);

		let emailsBefore = platformEmails.length;
		await event(user, messages[0], { type: "complaint" });
		assert.deepEqual(subjectsSince(emailsBefore), ["complaints@example.com [MailCheap] Spam complaint"], "only the usual notice");

		emailsBefore = platformEmails.length;
		await event(user, messages[1], { type: "complaint" });
		assert.equal((await loadAccount(user)).status, "active", "2 complaints never block");
		assert.deepEqual(subjectsSince(emailsBefore), ["complaints@example.com [MailCheap] Bounces or complaints are high"]);

		emailsBefore = platformEmails.length;
		await event(user, messages[2], { type: "complaint" });
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.pausedBy], ["paused", "rates"]);
		assert.equal(account.pauseReason, "Complaint rate of 3.00% over the last 7 days (limit 0.30%)");
		assert.equal(alertsSince(emailsBefore).length, 2, "the admins and the owner");
	});

	test("a campaign over the pause level pauses alone with a warning; resumed, only the block level stops it", async () => {
		const user = await customer("campaign-warning@example.com", { contacts: 3 });
		const warned = await draft(user, "Warned");
		const other = await draft(user, "Other");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(warned, {})), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(other, {})), { ok: true });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: warned }, { $set: { "stats.sent": 100, "stats.bounced": 5 } });

		const emailsBefore = platformEmails.length;
		assert.equal(sentCount(await runJobs(user)), 3, "the other campaign went out");
		assert.equal((await loadAccount(user)).status, "active");
		const paused = await loadCampaign(user, warned);
		assert.deepEqual([paused.status, paused.pauseCode], ["paused", "high_rates"]);
		assert.match(paused.pauseReason, /^Bounce rate of 5.00% on this campaign \(limit 2.50%\)\. Check where these contacts came from before you resume/);
		assert.equal((await loadCampaign(user, other)).status, "sent");
		const emails = platformEmails.slice(emailsBefore);
		assert.deepEqual(emails.map(({ to, subject }) => [to, subject]), [[["campaign-warning@example.com"], "[MailCheap] Campaign paused"]], "no admin email");

		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(warned)), { ok: true });
		assert.equal(sentCount(await runJobs(user)), 3, "the same rates don't pause it again");
		assert.equal((await loadCampaign(user, warned)).status, "sent");
	});

	test("a campaign over the block level, at its next batch: every send of the account stops", async () => {
		const user = await customer("campaign-rates@example.com", { contacts: 3 });
		const bad = await draft(user, "Bad");
		const other = await draft(user, "Other");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(bad, {})), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(other, {})), { ok: true });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: bad }, { $set: { "stats.sent": 100, "stats.bounced": 10 } });

		const emailsBefore = platformEmails.length;
		assert.equal(sentCount(await runJobs(user)), 0);
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.pausedBy, account.pauseReason], ["paused", "campaign", "Bounce rate of 10.00% on a campaign (limit 5.00%)"]);
		for (const id of [bad, other]) {
			const campaign = await loadCampaign(user, id);
			assert.deepEqual([campaign.status, campaign.pauseCode, campaign.pauseReason], ["paused", "account_blocked", "the account is blocked"]);
		}
		assert.equal(alertsSince(emailsBefore).length, 2, "one block, one alert each, no campaign alerts on top");
	});
});

describe("a blocked account", () => {
	test("sends nothing, welcome and confirmation emails included, even on a free plan", async () => {
		const user = await customer("blocked-free@example.com", { contacts: 2, isFree: true });
		const sending = await draft(user, "Going out");
		const later = await draft(user, "Later");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(sending, {})), { ok: true });
		const scheduledAt = new Date(Date.now() + 3_600_000);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(later, { scheduledAt: scheduledAt.toISOString() })), { ok: true });
		const queuedWelcome = await m.Message.create({
			kind: "welcome",
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			contactId: (await m.Contact.findOne({ accountId: user.accountId }).lean())._id,
			email: `reader0@${user.slug}.example.org`,
		});

		assert.deepEqual(await as(admin, () => m.admin.blockAccountAction(String(user.accountId), "Review")), { ok: true });
		const emailsBefore = sesEmails.length;

		assert.equal(sentCount(await runJobs(user)), 0, "the queued batch");
		assert.equal((await loadCampaign(user, sending)).pauseCode, "account_blocked");

		const due = new Date();
		await m.Campaign.updateOne({ accountId: user.accountId, _id: later }, { $set: { scheduledAt: due } });
		const scheduled = await m.scheduling.runScheduledSend({ accountId: String(user.accountId), campaignId: later, scheduledAt: due.toISOString() });
		assert.equal(scheduled.code, "account_blocked");
		assert.equal((await loadCampaign(user, later)).status, "draft", "a scheduled send goes back to draft");

		const test = await as(user, () => m.campaigns.sendTestCampaign(sending));
		assert.deepEqual(test, { error: "This account is blocked: Review. Chat with us to unblock it.", code: "account_blocked" });
		assert.equal((await as(user, () => m.newsletters.sendWelcomeTest(user.newsletterId))).code, "account_blocked");

		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const reader = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "new-reader@example.org", status: "active" });
		assert.deepEqual(await m.sending.queueWelcomeEmail({ newsletter, contact: reader }), { skipped: "account is blocked" });
		const pending = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "pending-reader@example.org", status: "pending" });
		assert.deepEqual(await m.sending.queueConfirmationEmail({ newsletter, contact: pending }), { skipped: "account is blocked" });

		const batch = await m.sending.sendMessageBatch({ accountId: String(user.accountId), messageIds: [String(queuedWelcome._id)] });
		assert.deepEqual([batch.sent, batch.failed], [0, 1], "a welcome email already queued");
		assert.match((await m.Message.findOne({ accountId: user.accountId, _id: queuedWelcome._id }).lean()).error, /^This account is blocked: Review/);
		assert.equal(sesEmails.length, emailsBefore, "nothing reached the provider");
	});

	test("refuses imports, new contacts, schedules and every API write; reads, pausing and revoking still work", async () => {
		const user = await customer("blocked-writes@example.com", { contacts: 1 });
		const signupsKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
		const id = await draft(user);
		const scheduled = await draft(user, "Later");
		await as(user, () => m.campaigns.scheduleCampaign(scheduled, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });

		const refused = { error: "This account is blocked: Review. Chat with us to unblock it.", code: "account_blocked" };
		const rows = [{ email: "new@example.org", status: "active" }];
		assert.deepEqual(await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows })), refused);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), refused);
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow })), refused);
		assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject: "Edited", body: "<p>Edited</p>" })), refused);
		const formResult = await anonymous(() => m.archive.subscribe(null, form({ newsletter: user.slug, email: "visitor@example.org" })));
		assert.deepEqual(formResult, { error: "This newsletter is not taking signups" });

		const signup = await callApi("POST", "/api/v1/contacts", { key: signupsKey, body: { newsletter: user.slug, email: "visitor@example.org" } });
		await flushAfter();
		assertError(signup, 403, "account_blocked");
		const { supportChatPath } = m.siteExtensions;
		const hint = supportChatPath ? `Chat with us to unblock it: http://localhost:3000${supportChatPath}` : "Chat with us to unblock it.";
		assert.equal(signup.body.error.message, `This account is blocked: Review. ${hint}`, "the API gives the chat's address, having no button for it");
		assertError(await callApi("POST", "/api/v1/contacts", { key: user.key, body: { newsletter: user.slug, email: "visitor@example.org" } }), 403, "account_blocked");
		assertError(await callApi("POST", "/api/v1/contacts/import", { key: user.key, body: { newsletter: user.slug, consent: true, contacts: rows } }), 403, "account_blocked");
		assertError(await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { subject: "New" } }), 403, "account_blocked");
		assertError(await callApi("POST", `/api/v1/campaigns/${id}/schedule`, { key: user.key, body: { scheduledAt: tomorrow } }), 403, "account_blocked");
		assertError(await callApi("POST", "/api/v1/api-keys", { key: user.key, body: { name: "More", level: "full" } }), 403, "account_blocked");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 1, "nobody was added");

		assert.equal((await callApi("GET", "/api/v1/contacts", { key: user.key })).status, 200);
		assert.equal((await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key })).status, 200);
		assert.equal((await callApi("GET", "/api/v1/billing", { key: user.key })).body.status, "blocked");
		assert.equal((await callApi("POST", `/api/v1/campaigns/${scheduled}/unschedule`, { key: user.key })).status, 200);
		const { apiKeys } = (await callApi("GET", "/api/v1/api-keys", { key: user.key })).body;
		const site = apiKeys.find(({ name }) => name === "Site");
		assert.equal((await callApi("DELETE", `/api/v1/api-keys/${site.id}`, { key: user.key })).status, 200);
	});
});

describe("unblocking", () => {
	test("only an admin unblocks: not its owner, not a clean check; its campaigns then wait for their owner", async () => {
		const user = await customer("unblock@example.com", { contacts: 1 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await m.blocks.blockAccount(user.accountId, { reason: "Bounce rate of 2.50% over the last 7 days (limit 2.00%)", by: "rates" });

		assert.equal(await as(user, () => catchNotFound(m.admin.unblockAccountAction(String(user.accountId)))), true, "a 404 for anyone else");
		assert.equal((await as(user, () => m.campaigns.resumeCampaign(id))).code, "account_blocked");
		await m.health.checkAccountHealth(user.accountId, { isUrgent: true });
		assert.equal((await loadAccount(user)).status, "paused", "rates back under the limits don't lift it");

		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.equal((await loadCampaign(user, id)).status, "paused");
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(id)), { ok: true });
		assert.equal(sentCount(await runJobs(user)), 1);
		assert.equal((await loadCampaign(user, id)).status, "sent");
	});

	test("a send that blocked its account goes on once unblocked: the bounces before don't count again", async () => {
		const user = await customer("resume-after-block@example.com", { contacts: 3 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { "stats.sent": 50, "stats.bounced": 11 } });
		assert.equal(sentCount(await runJobs(user)), 0);
		assert.deepEqual([(await loadAccount(user)).pausedBy, (await loadCampaign(user, id)).pauseCode], ["campaign", "account_blocked"]);

		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(id)), { ok: true });
		assert.equal(sentCount(await runJobs(user)), 3, "11 bounces out of its first 50 emails don't stop the rest");
		assert.equal((await loadAccount(user)).status, "active");
		const sent = await loadCampaign(user, id);
		assert.deepEqual([sent.status, sent.stats.bounced], ["sent", 11], "its report keeps them");
	});

	test("once unblocked, a send's new bounces still block the account", async () => {
		const user = await customer("bounces-after-unblock@example.com", { contacts: 3 });
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { "stats.sent": 50, "stats.bounced": 11 } });
		await runJobs(user);
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });

		await sendsAt(user, { at: new Date(), sent: 20, bounced: 10, campaignId: new mongoose.Types.ObjectId(id) });
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(id)), { ok: true });
		assert.equal(sentCount(await runJobs(user)), 0);
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.pausedBy, account.pauseReason], ["paused", "campaign", "Bounce rate of 50.00% on a campaign (limit 5.00%)"]);
	});

	test("once unblocked, the 7-day check adds up only the emails sent since", async () => {
		const user = await customer("week-after-unblock@example.com", { contacts: 0 });
		await sendsAt(user, { at: new Date(Date.now() - 3_600_000), sent: 50, bounced: 11 });
		await m.health.checkAccountHealth(user.accountId, { isUrgent: true });
		assert.equal((await loadAccount(user)).pauseReason, "Bounce rate of 22.00% over the last 7 days (limit 5.00%)");
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });

		await sendsAt(user, { at: new Date(), sent: 100, bounced: 1 });
		await m.health.checkAccountHealth(user.accountId, { isUrgent: true });
		assert.equal((await loadAccount(user)).status, "active", "1 bounce since, not 12 out of 150");

		await sendsAt(user, { at: new Date(), sent: 20, bounced: 10 });
		await m.health.checkAccountHealth(user.accountId, { isUrgent: true });
		const account = await loadAccount(user);
		assert.deepEqual([account.status, account.pausedBy], ["paused", "rates"]);
		assert.equal(account.pauseReason, "Bounce rate of 9.17% since the account was unblocked (limit 5.00%)");
	});
});

describe("links in emails", () => {
	test("a blocked account's links say they're disabled instead of redirecting, until an admin unblocks it", async () => {
		const user = await customer("blocked-links@example.com", { contacts: 0 });
		const [clicked, opened] = await sentMessages(user, 2);
		assert.deepEqual(await as(admin, () => m.admin.blockAccountAction(String(user.accountId), "Review")), { ok: true });

		const page = await click(clicked);
		assert.deepEqual(answerOf(page), [403, null, "no-store"], "no redirect, and nothing a browser or the CDN keeps");
		assert.equal(page.headers.get("x-robots-tag"), "noindex");
		assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
		const html = await page.text();
		assert.ok(html.includes("<h1>This link is disabled</h1><p>The sender's account is suspended.</p>"));
		assert.ok(!html.includes("example.net") && !html.includes("<a "), "the destination isn't shown or linked");
		assert.deepEqual(answerOf(await click(clicked, "HEAD")), [403, null, "no-store"]);

		assert.equal((await open(opened)).headers.get("content-type"), "image/gif", "the pixel still loads");
		await flushAfter();
		for (const message of [clicked, opened]) {
			const { openedAt, clickedAt } = await loadMessage(user, message);
			assert.deepEqual([openedAt, clickedAt], [undefined, undefined], "no open or click counts");
		}

		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		assert.deepEqual(answerOf(await click(clicked)), [302, DESTINATION, "no-store"], "the same link, at once");
		await flushAfter();
		assert.ok((await loadMessage(user, clicked)).clickedAt, "and its clicks count again");
	});

	test("a blocked account's unsubscribe links work, one-click included, and pending readers can confirm", async () => {
		const user = await customer("blocked-leave@example.com", { contacts: 2 });
		const [oneClick, footer] = await m.Contact.find({ accountId: user.accountId }).sort({ email: 1 }).lean();
		const pending = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "pending@example.org", status: "pending" });
		await m.blocks.blockAccount(user.accountId, { reason: "Review" });

		function unsubscribe(contact, body) {
			const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
			return m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", body }));
		}
		assert.equal((await unsubscribe(oneClick, new URLSearchParams({ "List-Unsubscribe": "One-Click" }))).status, 200);
		const page = await unsubscribe(footer, form({ source: "page" }));
		assert.equal(new URL(page.headers.get("location")).searchParams.get("status"), "done", "the footer link's page");
		for (const contact of [oneClick, footer]) assert.equal((await loadContact(contact)).status, "unsubscribed");

		const token = createConfirmToken({ contactId: pending._id, newsletterId: user.newsletterId });
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
		await flushAfter();
		assert.equal((await loadContact(pending)).status, "active");
	});

	test("other accounts' links redirect and count as before, and so do links whose message is gone or whose check fails", async (t) => {
		const user = await customer("open-links@example.com", { contacts: 0 });
		const blocked = await customer("blocked-neighbor@example.com", { contacts: 0 });
		await m.blocks.blockAccount(blocked.accountId, { reason: "Review" });
		const [clicked, opened, checked] = await sentMessages(user, 3);

		assert.deepEqual(answerOf(await click(clicked)), [302, DESTINATION, "no-store"]);
		assert.deepEqual(answerOf(await click(checked, "HEAD")), [302, DESTINATION, "no-store"]);
		assert.equal((await open(opened)).status, 200);
		await flushAfter();
		const [afterClick, afterOpen, afterHead] = await Promise.all([clicked, opened, checked].map((message) => loadMessage(user, message)));
		assert.ok(afterClick.clickedAt && afterClick.openedAt, "a click counts as an open too");
		assert.ok(afterOpen.openedAt && !afterOpen.clickedAt);
		assert.ok(!afterHead.openedAt && !afterHead.clickedAt, "HEAD never counts");

		assert.deepEqual(answerOf(await click({ _id: new mongoose.Types.ObjectId() })), [302, DESTINATION, "no-store"]);
		t.mock.method(console, "error", () => {});
		t.mock.method(m.Message, "aggregate", () => {
			throw new Error("MongoDB is unreachable");
		});
		assert.deepEqual(answerOf(await click(clicked)), [302, DESTINATION, "no-store"]);
	});
});
