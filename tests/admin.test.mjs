import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { activate, as, catchNotFound, form, signIn, startTestApp } from "./helpers/app.mjs";

const DAY_MS = 86_400_000;

let app;
let m;
let admin;
let customer;

before(async () => {
	app = await startTestApp({ ADMIN_EMAILS: "ops@example.com, owner@example.com" });
	m = {
		actions: await import("../app/admin/actions.js"),
		accounts: await import("../lib/accounts.js"),
		stats: await import("../lib/admin-stats.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		Account: (await import("../models/Account.js")).default,
	};
	admin = await signIn("ops@example.com");
	customer = await signIn("customer@example.com");
	await activate(customer, { plan: "growth" });
});

after(() => app?.stop());

test("admin actions answer 404 to anyone outside ADMIN_EMAILS, and change nothing", async () => {
	const id = String(customer.accountId);
	assert.equal(await as(customer, () => catchNotFound(m.actions.blockAccountAction(id, "nope"))), true);
	assert.equal(await as(customer, () => catchNotFound(m.actions.unblockAccountAction(id))), true);
	assert.equal(
		await as(customer, () => catchNotFound(m.actions.saveLimits(null, form({ accountId: id, emailsPerMonth: "999999" })))),
		true
	);
	const untouched = await m.Account.findById(customer.accountId).lean();
	assert.equal(untouched.status, "active");
	assert.equal(untouched.limitOverrides?.emailsPerMonth, undefined);
});

test("blocking and unblocking an account", async () => {
	const id = String(customer.accountId);
	assert.deepEqual(await as(admin, () => m.actions.blockAccountAction(id, "Complaints spike")), { ok: true });
	let account = await m.Account.findById(id).lean();
	assert.equal(account.status, "paused");
	assert.equal(account.pauseReason, "Complaints spike");
	assert.equal(account.pausedBy, "admin");
	assert.ok(account.pausedAt instanceof Date);
	assert.deepEqual(await as(admin, () => m.actions.blockAccountAction(id, "again")), { error: "Already blocked" });

	assert.deepEqual(await as(admin, () => m.actions.unblockAccountAction(id)), { ok: true });
	account = await m.Account.findById(id).lean();
	assert.equal(account.status, "active");
	assert.equal(account.pausedAt, undefined);
	assert.equal(account.pauseReason, undefined);
	assert.equal(account.pausedBy, undefined);
	assert.deepEqual(await as(admin, () => m.actions.unblockAccountAction(id)), { error: "Not blocked" });
});

test("limit overrides replace the plan's numbers, and empty fields bring the plan's back", async () => {
	const id = String(customer.accountId);
	const saved = await as(admin, () => m.actions.saveLimits(null, form({ accountId: id, emailsPerMonth: "150,000", subscribers: "" })));
	assert.equal(saved.ok, true);
	let account = await m.Account.findById(id).lean();
	assert.equal(account.limitOverrides.emailsPerMonth, 150_000);
	assert.equal(account.limitOverrides.subscribers, undefined);

	assert.deepEqual(await as(admin, () => m.actions.saveLimits(null, form({ accountId: id, emailsPerMonth: "-5" }))), {
		error: "Use whole numbers, or leave empty for the plan's",
	});
	assert.deepEqual(await as(admin, () => m.actions.saveLimits(null, form({ accountId: id, emailsPerMonth: "1.5" }))), {
		error: "Use whole numbers, or leave empty for the plan's",
	});

	await as(admin, () => m.actions.saveLimits(null, form({ accountId: id, emailsPerMonth: "", subscribers: "" })));
	account = await m.Account.findById(id).lean();
	assert.equal(account.limitOverrides?.emailsPerMonth, undefined);
});

test("the account list shows each owner, plan, status, usage and creation date, newest first", async () => {
	const url = await as(customer, async () => {
		const { catchRedirect } = await import("./helpers/app.mjs");
		return catchRedirect(
			m.newsletters.saveNewsletter(null, form({ name: "News", slug: "customer-news", fromEmail: "hello@customer-news.mailcheapmail.com", postalAddress: "1 Main St" }))
		);
	});
	await as(customer, () =>
		m.contacts.importContacts({ newsletterId: url.split("/").at(-1), consent: true, rows: [{ email: "a@example.org", status: "active" }, { email: "b@example.org", status: "unsubscribed" }] })
	);

	const accounts = await m.accounts.listAccountsForAdmin();
	assert.deepEqual(accounts.map(({ ownerEmail }) => ownerEmail), ["customer@example.com", "ops@example.com"]);
	const [listed] = accounts;
	assert.equal(listed.plan, "growth");
	assert.equal(listed.subscriptionStatus, "active");
	assert.equal(listed.activeContacts, 1);
	assert.equal(listed.usage.emailsSent, 0);
	assert.ok(listed.createdAt instanceof Date);

	const pinned = await m.accounts.listAccountsForAdmin({ accountId: String(admin.accountId) });
	assert.deepEqual(
		pinned.map(({ ownerEmail, activeContacts }) => [ownerEmail, activeContacts]),
		[["ops@example.com", 0]],
		"one account's own link: it alone, with its owner and contacts"
	);
});

test("the numbers at the top count every account, not just the ones listed", async () => {
	const third = await signIn("third@example.com");
	await m.Account.updateOne({ _id: third.accountId }, { $set: { status: "paused", pausedBy: "admin", pauseReason: "Spam" } });

	assert.equal((await m.accounts.listAccountsForAdmin({ limit: 2 })).length, 2);
	assert.deepEqual(await m.stats.getAccountTotals(), { accounts: 3, newThisWeek: 3, paying: 1, pastDue: 0, onFreePlan: 0, blocked: 1 });
});

test("search finds accounts in the whole database by owner email, newsletter name or account id, in any case", async () => {
	const emails = async (search) => (await m.accounts.listAccountsForAdmin({ search })).map(({ ownerEmail }) => ownerEmail);
	assert.deepEqual(await emails("CUSTOMER@"), ["customer@example.com"]);
	assert.deepEqual(await emails("news"), ["customer@example.com"], "its newsletter is named News");
	assert.deepEqual(await emails(String(admin.accountId)), ["ops@example.com"]);
	assert.deepEqual(await emails("example.com"), ["third@example.com", "customer@example.com", "ops@example.com"], "newest first");
	assert.deepEqual(await emails("a+b(["), [], "a pattern's characters are only text");
	assert.equal((await emails("  ")).length, 3, "a blank search lists the newest");
});

test("email stats count customers' emails of the last 30 days, never test emails or the admins' accounts", async () => {
	const now = new Date();
	const campaignId = new mongoose.Types.ObjectId();
	const email = (accountId, fields) => ({
		accountId,
		newsletterId: new mongoose.Types.ObjectId(),
		campaignId,
		contactId: new mongoose.Types.ObjectId(),
		kind: "campaign",
		email: "reader@example.org",
		sentAt: now,
		...fields,
	});
	await mongoose.connection.db.collection("messages").insertMany([
		...Array.from({ length: 8 }, () => email(customer.accountId, { deliveredAt: now })),
		email(customer.accountId, { bouncedAt: now }),
		email(customer.accountId, { deliveredAt: now, complainedAt: now }),
		email(customer.accountId, { kind: "welcome", sentAt: new Date(now.getTime() - 40 * DAY_MS) }),
		...Array.from({ length: 3 }, () => email(customer.accountId, { kind: "test" })),
		...Array.from({ length: 5 }, () => email(admin.accountId, {})),
	]);

	const stats = await m.stats.getEmailStats({ now });
	assert.deepEqual([stats.sent, stats.total, stats.bounceRate, stats.complaintRate], [10, 11, 0.1, 0.1]);
	assert.equal(stats.days.length, 30);
	assert.deepEqual(stats.days.at(-1), { day: now.toISOString().slice(0, 10), sent: 10 });
	assert.equal(stats.days.reduce((sum, { sent }) => sum + sent, 0), 10);
});

test("recent campaigns are customers', upcoming first, with their owner and numbers; drafts and the admins' stay out", async () => {
	const now = Date.now();
	const campaign = (accountId, fields) => ({ accountId, newsletterId: new mongoose.Types.ObjectId(), subject: "Issue", createdAt: new Date(now), ...fields });
	await mongoose.connection.db.collection("campaigns").insertMany([
		campaign(customer.accountId, { subject: "Sent", status: "sent", startedAt: new Date(now - DAY_MS), stats: { recipients: 100, delivered: 97, bounced: 3, complained: 1 } }),
		campaign(customer.accountId, { subject: "Upcoming", status: "scheduled", scheduledAt: new Date(now + DAY_MS) }),
		campaign(customer.accountId, { subject: "Draft", status: "draft" }),
		campaign(admin.accountId, { subject: "Admin's", status: "sent", startedAt: new Date(now) }),
	]);

	const campaigns = await m.stats.listRecentCampaigns();
	assert.deepEqual(campaigns.map(({ subject, status }) => [subject, status]), [["Upcoming", "scheduled"], ["Sent", "sent"]]);
	assert.deepEqual(
		{ ownerEmail: campaigns[1].ownerEmail, recipients: campaigns[1].recipients, bounced: campaigns[1].bounced, complained: campaigns[1].complained },
		{ ownerEmail: "customer@example.com", recipients: 100, bounced: 3, complained: 1 }
	);
});

test("needs a look: customers' paused campaigns with their reason, blocked accounts and the last 7 days' alerts", async () => {
	const now = new Date();
	await mongoose.connection.db.collection("campaigns").insertOne({ accountId: customer.accountId, newsletterId: new mongoose.Types.ObjectId(), subject: "Paused one", status: "paused", pauseReason: "Too many bounces", updatedAt: now });
	await mongoose.connection.db.collection("alerts").insertMany([
		{ accountId: customer.accountId, key: "campaign-paused", title: "Campaign paused", lastSentAt: now },
		{ key: "qstash-refused", title: "QStash refused a job", lastSentAt: new Date(now.getTime() - 8 * DAY_MS) },
	]);

	const attention = await m.stats.listAttention({ now });
	assert.deepEqual(attention.pausedCampaigns.map(({ subject, reason, ownerEmail }) => [subject, reason, ownerEmail]), [["Paused one", "Too many bounces", "customer@example.com"]]);
	assert.deepEqual(attention.blockedAccounts.map(({ ownerEmail, by, reason }) => [ownerEmail, by, reason]), [["third@example.com", "admin", "Spam"]]);
	const alerts = Object.fromEntries(attention.alerts.map(({ title, ownerEmail }) => [title, ownerEmail]));
	assert.equal(alerts["Campaign paused"], "customer@example.com");
	assert.equal("Account blocked" in alerts, true, "from the block earlier");
	assert.equal("QStash refused a job" in alerts, false, "8 days old");
});

test("needs a look never names the email provider, in alert titles or pause reasons", async () => {
	const now = new Date();
	await mongoose.connection.db.collection("campaigns").insertOne({ accountId: customer.accountId, newsletterId: new mongoose.Types.ObjectId(), subject: "Refused one", status: "paused", pauseReason: "Refused by PostShiba: 550 sending disabled", updatedAt: now });
	await mongoose.connection.db.collection("alerts").insertMany([
		{ key: "postshiba-cap:BuLk01", title: "PostShiba cluster at its cap", lastSentAt: now },
		{ key: "tenant-create:x", title: "Amazon SES tenant not created", lastSentAt: now },
	]);

	const attention = await m.stats.listAttention({ now });
	assert.equal(attention.pausedCampaigns.find(({ subject }) => subject === "Refused one").reason, "Refused by the email provider: 550 sending disabled");
	const titles = attention.alerts.map(({ title }) => title);
	assert.ok(titles.includes("Email provider cluster at its cap"));
	assert.ok(titles.includes("Email provider tenant not created"));
	assert.doesNotMatch(JSON.stringify(attention), /PostShiba|\bSES\b/);
});
