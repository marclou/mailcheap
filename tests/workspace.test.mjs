import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { activate, addAuthor, as, catchRedirect, form, jsonRequest, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { txts } from "./stubs/dns-check.mjs";
import { inbox, platformSent, sent, state } from "./stubs/google-workspace.mjs";
import { published } from "./stubs/qstash.mjs";

// A Google Workspace mailbox as the provider, through the real actions and jobs, with Gmail answered in memory.
const WORKSPACE_ENV = { EMAIL_PROVIDER: "workspace", WORKSPACE_EMAIL: "news@example.com", WORKSPACE_APP_PASSWORD: "abcd efgh ijkl mnop" };
const DKIM_KEY = [["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"]];
const REF = "X-MailCheap-Ref";
let app;
let m;
let processed = 0;

async function runNextJob() {
	const { url, body } = published[processed++];
	if (url.endsWith("/api/jobs/send-batch")) return m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	return null;
}

async function runJobs() {
	while (processed < published.length) await runNextJob();
}

function readBounces() {
	return m.readBouncesRoute.POST(jsonRequest("http://localhost:3000/api/jobs/read-bounces", { method: "POST", body: {} })).then((response) => response.json());
}

async function createNewsletter(user, slug) {
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, fromName: "Jane", postalAddress: "1 Main St, Paris" }))));
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
	await addAuthor(user);
}

function saveFrom(user, fromEmail) {
	return as(user, () =>
		m.newsletters.saveNewsletter(null, form({ id: user.newsletterId, name: user.slug, slug: user.slug, fromName: "Jane", fromEmail, postalAddress: "1 Main St, Paris" }))
	);
}

// A paying customer whose newsletter sends from its own domain, which Google signs.
async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	await createNewsletter(user, slug);
	const domain = `${slug}.dev`;
	txts.set(`google._domainkey.${domain}`, DKIM_KEY);
	assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain }))), { ok: true, domain });
	assert.equal((await saveFrom(user, `hello@${domain}`)).ok, true);
	return user;
}

async function importContacts(user, emails) {
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: emails.map((email) => ({ email, status: "active" })) }));
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

async function send(user, emails, subject) {
	await importContacts(user, emails);
	const id = await draft(user, subject);
	assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
	return id;
}

// Gmail's notification for an email that went out: its status, then the headers that email carried.
function bounceOf(email, { status = "5.1.1", action = "failed", diagnostic = "smtp; 550-5.1.1 The email account that you tried to reach does not exist.", id, ref = email.headers[REF], recipient = email.to } = {}) {
	return [
		"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
		"Subject: Delivery Status Notification (Failure)",
		`Message-ID: <${id}@mx.google.com>`,
		"Content-Type: multipart/report; boundary=b; report-type=delivery-status",
		"",
		"--b",
		"Content-Type: message/delivery-status",
		"",
		`Final-Recipient: rfc822; ${recipient}`,
		`Action: ${action}`,
		`Status: ${status}`,
		`Diagnostic-Code: ${diagnostic}`,
		"",
		"--b",
		"Content-Type: message/rfc822",
		"",
		`${REF}: ${ref}`,
		`To: ${email.to}`,
		"",
		"--b--",
	].join("\r\n");
}

function deliverBounce(source) {
	inbox.push({ uid: inbox.length + 1, receivedAt: new Date(), source });
}

before(async () => {
	app = await startTestApp({ ...WORKSPACE_ENV, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		readBouncesRoute: await import("../app/api/jobs/read-bounces/route.js"),
		bounces: await import("../lib/workspace-bounces.js"),
		capacity: await import("../lib/sending-capacity.js"),
		platformEmail: await import("../lib/platform-email.js"),
		providers: await import("../lib/email-provider/index.js"),
		tenants: await import("../lib/tenants.js"),
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Event: (await import("../models/Event.js")).default,
		MailboxCursor: (await import("../models/MailboxCursor.js")).default,
		MailboxSend: (await import("../models/MailboxSend.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

beforeEach(async () => {
	await m.MailboxSend.deleteMany({});
	await m.MailboxCursor.deleteMany({});
	inbox.length = 0;
	state.failNext = null;
	state.inboxError = null;
});

after(async () => {
	await app?.stop();
});

describe("domains", () => {
	test("a domain waits for Google's DKIM key, with nothing to create at Google and no tenant", async () => {
		const user = await signIn("ws-domain@example.com");
		await activate(user);
		await createNewsletter(user, "ws-domain");
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "ws-domain.dev" }))), { ok: true, domain: "ws-domain.dev" });
		let domain = await m.Domain.findOne({ accountId: user.accountId, domain: "ws-domain.dev" }).lean();
		assert.deepEqual([domain.provider, domain.verified, domain.dkimStatus, domain.mailFromDomain], ["workspace", false, "PENDING", "ws-domain.dev"]);
		assert.match((await saveFrom(user, "hello@ws-domain.dev")).error ?? "", /verif|DNS|records/i);

		txts.set("google._domainkey.ws-domain.dev", null);
		assert.equal((await as(user, () => m.domains.checkDomainAction(String(domain._id)))).verified, false, "a lookup that failed says nothing");
		txts.set("google._domainkey.ws-domain.dev", DKIM_KEY);
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: true });
		domain = await m.Domain.findOne({ accountId: user.accountId, domain: "ws-domain.dev" }).lean();
		assert.deepEqual([domain.dkimStatus, domain.mailFromStatus, domain.records.length], ["SUCCESS", "SUCCESS", 0]);
		assert.equal((await saveFrom(user, "hello@ws-domain.dev")).ok, true);

		const account = await m.Account.findById(user.accountId).lean();
		assert.equal(account.ses?.provisionedAt, undefined);
		assert.equal(m.providers.getEmailProvider().describeTenant(account), null);
		await m.tenants.removeTenants(account);
	});
});

describe("sending", () => {
	test("a campaign goes out from the mailbox, each email with its signed reference, and the inbox is read once after", async () => {
		const user = await customer("ws-send@example.com", "ws-send");
		const before = sent.length;
		const id = await send(user, ["one@example.org", "two@example.org"], "Weekly");
		await runJobs();

		const emails = sent.slice(before);
		assert.deepEqual(emails.map(({ to }) => to).sort(), ["one@example.org", "two@example.org"]);
		const [email] = emails;
		assert.equal(email.from, '"Jane" <hello@ws-send.dev>');
		assert.equal(email.subject, "Weekly");
		assert.match(email.headers["Feedback-ID"], new RegExp(`^${id}:mc-${user.accountId}:campaign:mailcheap$`));
		assert.ok(email.headers["List-Unsubscribe"]);
		assert.deepEqual(Object.keys(email).sort(), ["from", "headers", "html", "replyTo", "subject", "text", "to"]);

		const [accountId, messageId] = email.headers[REF].split(".");
		assert.equal(accountId, String(user.accountId));
		const message = await m.Message.findOne({ accountId: user.accountId, _id: messageId }).lean();
		assert.deepEqual([message.status, message.email], ["sent", email.to]);
		assert.match(message.providerMessageId, /^<workspace-\d+@example\.com>$/);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sent");
		assert.equal(await m.MailboxSend.countDocuments(), 2);

		const reads = published.filter(({ url }) => url.endsWith("/api/jobs/read-bounces"));
		assert.equal(new Set(reads.map(({ deduplicationId }) => deduplicationId)).size, 1, "one look, whatever the number of batches");
		assert.ok(reads[0].notBefore > Math.floor(Date.now() / 1000) + 600, "once bounces had time to come back");
	});

	test("over the mailbox's day, the batch waits for room instead of going on", async () => {
		const user = await customer("ws-full@example.com", "ws-full");
		await m.MailboxSend.create({ at: new Date(Date.now() - 23 * 3_600_000) });
		await withEnv({ WORKSPACE_DAILY_LIMIT: "2" }, async () => {
			const before = sent.length;
			const id = await send(user, ["full1@example.org", "full2@example.org"], "Capped");
			const response = await runNextJob();
			assert.equal(response.status, 200);
			assert.equal((await response.json()).republished, true);
			assert.equal(sent.length, before + 1);
			assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1, "nothing lost");
			assert.equal(await m.MailboxSend.countDocuments(), 2, "the refused email took no place");
			assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).status, "sending");

			const retry = published.findLast(({ url }) => url.endsWith("/api/jobs/send-batch"));
			const inSeconds = retry.notBefore - Math.floor(Date.now() / 1000);
			assert.ok(inSeconds > 3000 && inSeconds <= 3700, `when the oldest email leaves the day, not in a loop (${inSeconds}s)`);

			await m.MailboxSend.deleteMany({});
			await runJobs();
			assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "sent" }), 2);
		});
	});

	test("Google refusing the mailbox's login pauses the campaign and tells the admins, without its words", async () => {
		const user = await customer("ws-login@example.com", "ws-login");
		const id = await send(user, ["login1@example.org"], "Refused");
		state.failNext = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 });
		await runJobs();

		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id, status: "queued" }), 1);
		assert.equal(await m.MailboxSend.countDocuments(), 0);
		const alert = await m.Alert.findOne({ accountId: null, key: "send-refused:misconfigured" }).lean();
		assert.match(alert.title, /Google Workspace refuses MailCheap's sends/);
		assert.ok(!JSON.stringify(alert).includes("abcd"), "never the password");
	});

	test("MailCheap's own emails go out from the mailbox on a self-hosted server without Resend, and count in its day", async () => {
		await withEnv({ MAILCHEAP_CLOUD: "", RESEND_API_KEY: "", EMAIL_FROM: "MailCheap <news@example.com>", WORKSPACE_DAILY_LIMIT: "1" }, async () => {
			await m.MailboxSend.create({ at: new Date() });
			assert.equal(m.platformEmail.canSendPlatformEmail(), true);
			await m.platformEmail.sendPlatformEmail({ to: "admin@example.com", subject: "Code", text: "123456" });
			assert.deepEqual([platformSent.at(-1).from, platformSent.at(-1).to], ["MailCheap <news@example.com>", "admin@example.com"]);
			assert.equal(await m.MailboxSend.countDocuments(), 2, "a sign-in code never waits for tomorrow");
		});
	});

	test("the admin page shows the mailbox's last 24 hours against its limit", async () => {
		await m.MailboxSend.insertMany([{ at: new Date() }, { at: new Date(Date.now() - 3_600_000) }, { at: new Date(Date.now() - 25 * 3_600_000) }]);
		assert.deepEqual(await m.capacity.getSendingCapacity(), {
			lanes: [{ label: "All emails", status: null, meters: [{ label: "Last 24 hours", used: 2, cap: 1500 }], perSecond: 1 }],
		});
		assert.deepEqual(await withEnv({ WORKSPACE_APP_PASSWORD: "" }, () => m.capacity.getSendingCapacity()), { error: "unconfigured" });
	});
});

describe("bounces", () => {
	test("a bounce in the inbox suppresses its contact once, and the next read starts after it", async () => {
		const user = await customer("ws-bounce@example.com", "ws-bounce");
		const before = sent.length;
		const id = await send(user, ["gone@example.org", "here@example.org"], "Bounced");
		await runJobs();
		const email = sent.slice(before).find(({ to }) => to === "gone@example.org");

		deliverBounce(bounceOf(email, { id: "bounce-1" }));
		deliverBounce("From: mailer-daemon@example.net\r\nSubject: Out of office\r\n\r\nNot a bounce");
		assert.deepEqual(await readBounces(), { read: 2, bounced: 1, seen: 0, unknown: 1 });

		const contact = (address) => m.Contact.findOne({ accountId: user.accountId, email: address }).lean();
		assert.equal((await contact("gone@example.org")).status, "bounced");
		assert.equal((await contact("here@example.org")).status, "active");
		assert.deepEqual(
			(await m.Suppression.find({ accountId: user.accountId }).lean()).map(({ email: address, reason, detail }) => [address, reason, detail]),
			[["gone@example.org", "bounce", "bounce/5.1.1"]]
		);
		const [, messageId] = email.headers[REF].split(".");
		const message = await m.Message.findOne({ accountId: user.accountId, _id: messageId }).lean();
		assert.equal(message.status, "bounced");
		assert.match(message.error, /^Hard bounce: 5\.1\.1/);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).stats.bounced, 1);

		assert.deepEqual(await readBounces(), { read: 0, bounced: 0, seen: 0, unknown: 0 }, "from where the last read stopped");
		await m.MailboxCursor.deleteMany({});
		assert.deepEqual(await readBounces(), { read: 2, bounced: 0, seen: 1, unknown: 1 }, "read again after the folder's UIDs start over");
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean()).stats.bounced, 1);
		assert.equal(await m.Event.countDocuments({ accountId: user.accountId, providerEventId: "workspace:bounce-1@mx.google.com" }), 1);
	});

	test("an email written to the inbox to look like a bounce changes nothing", async () => {
		const user = await customer("ws-forged@example.com", "ws-forged");
		const victim = await customer("ws-victim@example.com", "ws-victim");
		const before = sent.length;
		await send(user, ["forged@example.org"], "Forged");
		await send(victim, ["kept@example.org"], "Kept");
		await runJobs();
		const [own, other] = ["forged@example.org", "kept@example.org"].map((to) => sent.slice(before).find((email) => email.to === to));

		const [account, , signature] = own.headers[REF].split(".");
		const [otherAccount, otherMessage] = other.headers[REF].split(".");
		deliverBounce(bounceOf(other, { id: "forged-1", ref: `${otherAccount}.${otherMessage}.${signature}` }));
		deliverBounce(bounceOf(other, { id: "forged-2", ref: `${account}.${otherMessage}.${signature}` }));
		deliverBounce(bounceOf(other, { id: "forged-3", ref: `${otherAccount}.${otherMessage}.${"A".repeat(43)}` }));
		deliverBounce(bounceOf(own, { id: "forged-4", recipient: "kept@example.org" }));
		deliverBounce(bounceOf(own, { id: "forged-5", recipient: "" }));
		assert.deepEqual(await readBounces(), { read: 5, bounced: 0, seen: 0, unknown: 5 });
		assert.equal((await m.Contact.findOne({ accountId: victim.accountId, email: "kept@example.org" }).lean()).status, "active");
		assert.equal(await m.Suppression.countDocuments({ accountId: { $in: [user.accountId, victim.accountId] } }), 0);
	});

	test("a reader's own forged spam trap bounce only suppresses them, and never blocks the account", async () => {
		const user = await customer("ws-trap@example.com", "ws-trap");
		const before = sent.length;
		await send(user, ["trap@example.org", "fine@example.org"], "Trap");
		await runJobs();
		const email = sent.slice(before).find(({ to }) => to === "trap@example.org");
		deliverBounce(bounceOf(email, { id: "trap-1", diagnostic: "smtp; 550 5.1.1 spamtrap hit, address is a honeypot" }));
		assert.deepEqual(await readBounces(), { read: 1, bounced: 1, seen: 0, unknown: 0 });
		assert.notEqual((await m.Account.findById(user.accountId).lean()).status, "paused");
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "trap@example.org" }).lean()).status, "bounced");
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "fine@example.org" }).lean()).status, "active");
	});

	test("a bounce about an email sent long ago is someone else's doing", async () => {
		const user = await customer("ws-old@example.com", "ws-old");
		const before = sent.length;
		await send(user, ["old@example.org"], "Old");
		await runJobs();
		const email = sent.slice(before)[0];
		const [, messageId] = email.headers[REF].split(".");
		await m.Message.updateOne({ accountId: user.accountId, _id: messageId }, { $set: { sentAt: new Date(Date.now() - 8 * 24 * 3_600_000) } });
		deliverBounce(bounceOf(email, { id: "old-1" }));
		assert.deepEqual(await readBounces(), { read: 1, bounced: 0, seen: 0, unknown: 1 });
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "old@example.org" }).lean()).status, "active");
	});

	test("a full mailbox leaves the contact subscribed, and Gmail still trying is nothing", async () => {
		const user = await customer("ws-soft@example.com", "ws-soft");
		const before = sent.length;
		await send(user, ["full@example.org", "slow@example.org"], "Soft");
		await runJobs();
		const emails = sent.slice(before);
		deliverBounce(bounceOf(emails.find(({ to }) => to === "full@example.org"), { id: "soft-1", status: "5.2.2", diagnostic: "smtp; 552-5.2.2 The recipient's inbox is out of storage space." }));
		deliverBounce(bounceOf(emails.find(({ to }) => to === "slow@example.org"), { id: "soft-2", action: "delayed", status: "4.4.1", diagnostic: "smtp; The recipient server did not accept our requests to connect." }));
		assert.deepEqual(await readBounces(), { read: 2, bounced: 1, seen: 0, unknown: 1 });

		for (const address of ["full@example.org", "slow@example.org"]) {
			assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: address }).lean()).status, "active", address);
		}
		assert.equal(await m.Suppression.countDocuments({ accountId: user.accountId }), 0);
		const full = await m.Message.findOne({ accountId: user.accountId, email: "full@example.org" }).lean();
		assert.match(full.error, /^Soft bounce: 5\.2\.2/);
	});

	test("an inbox that doesn't answer fails the job, which is tried again, and only logs from the hourly run", async () => {
		state.inboxError = new Error("Invalid credentials (Failure)");
		await assert.rejects(readBounces(), /Invalid credentials/);
		assert.deepEqual(await m.bounces.readBouncesQuietly(), { error: "unreadable" });
		state.inboxError = null;
		assert.deepEqual(await m.bounces.readBouncesQuietly(), { read: 0, bounced: 0, seen: 0, unknown: 0 });
		assert.deepEqual(await withEnv({ EMAIL_PROVIDER: "ses" }, () => m.bounces.readBounces()), { skipped: "not the email provider" });
	});
});
