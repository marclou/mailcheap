import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { activate, addSentIssue, addVerifiedDomain, as, callApi, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { POSTSHIBA_ENV, createFakePostshiba } from "./helpers/postshiba.mjs";
import { invalidations, refusedDistributions } from "./stubs/cloudfront.mjs";
import { RedirectError } from "./stubs/next-navigation.mjs";
import { published } from "./stubs/qstash.mjs";
import { deleted as deletedObjects, objects, refusedDeletes } from "./stubs/s3.mjs";
import { state as ses } from "./stubs/ses.mjs";
import { deleted as deletedBlobs } from "./stubs/vercel-blob.mjs";
import { dnsRecords } from "./stubs/dns-broker.mjs";

// Deleting an account from its page, through the real actions and the purge job, with QStash, SES, S3, CloudFront and
// Vercel in memory: what blocks it, the code it takes, what stops at once, restoring it, and what the purge removes and
// keeps.
const S3 = {
	IMAGES_S3_BUCKET: "mailcheap-images-test",
	IMAGES_S3_ACCESS_KEY_ID: "images-key-id",
	IMAGES_S3_SECRET_ACCESS_KEY: "images-secret",
	IMAGES_CDN_URL: "https://cdn.example.com",
	IMAGES_CLOUDFRONT_DISTRIBUTION_ID: "E2TESTDISTRIBUTION",
};
const DELETION_SUBJECT = /^(\d{6}) is your code to delete your MailCheap account$/;
const BLOCKED = { error: "Your account can't be deleted yet. This page says what to do first." };
const WRONG_CODE = { error: "This code is wrong or expired" };
const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const OAUTH_COLLECTIONS = ["oauthConsent", "oauthAccessToken", "oauthRefreshToken"];

let app;
let m;

function collection(name) {
	return mongoose.connection.db.collection(name);
}

async function sendCode(user) {
	assert.deepEqual(await as(user, () => m.account.sendDeletionCode()), { sent: true });
	const { subject, headers } = platformEmails.findLast(({ to, subject }) => to.includes(user.email) && DELETION_SUBJECT.test(subject));
	const code = DELETION_SUBJECT.exec(subject)[1];
	assert.equal(headers["OTP-Token"], `"${code}"; origin="http://localhost:3000"`, "mail apps read the code from OTP-Token, bound to APP_URL's origin");
	return code;
}

// The action's answer, or where it sent the browser.
function deleteWith(user, fields) {
	return as(user, () => m.account.deleteAccount(null, form({ email: user.email, ...fields }))).catch((error) => {
		if (error instanceof RedirectError) return { redirect: error.url };
		throw error;
	});
}

async function deleteAccount(user) {
	assert.deepEqual(await deleteWith(user, { code: await sendCode(user) }), { redirect: "/signin?deleted=1" });
}

function findPurgeJob(user) {
	return published.findLast(({ url, body }) => url.endsWith("/api/jobs/purge-account") && body.accountId === String(user.accountId));
}

async function runPurgeJob(body) {
	const response = await m.purgeRoute.POST(jsonRequest("http://localhost:3000/api/jobs/purge-account", { method: "POST", body }));
	return response.json();
}

// The grace period over: the account's purge time moves to the past, and the job for that time runs.
async function purgeNow(user) {
	const purgeAt = new Date(Date.now() - 1000);
	await m.Account.updateOne({ _id: user.accountId }, { $set: { "deletion.purgeAt": purgeAt } });
	return runPurgeJob({ accountId: String(user.accountId), purgeAt: purgeAt.toISOString() });
}

// What Stripe's webhook writes once the plan is canceled in the billing portal.
function cancelPlan(user) {
	return m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
}

async function createNewsletter(user, slug) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.slug = slug;
	return user.newsletterId;
}

async function createCampaign(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello readers</p>" }));
	return id;
}

async function uploadImage(user) {
	const request = new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { "content-type": "image/png", "x-file-name": "cover" }, body: PNG });
	const response = await as(user, () => m.uploadsRoute.POST(request));
	assert.equal(response.status, 200);
	return (await response.json()).url;
}

function connectApp(user, clientId = "app-client") {
	const owned = { clientId, userId: user.userId, createdAt: new Date() };
	return Promise.all([
		collection("oauthConsent").insertOne({ ...owned, scopes: ["mailcheap:full"] }),
		collection("oauthAccessToken").insertOne({ ...owned, token: `at-${clientId}-${user.userId}` }),
		collection("oauthRefreshToken").insertOne({ ...owned, token: `rt-${clientId}-${user.userId}` }),
	]);
}

// A paying customer with one of everything: Google as a sign-in method, a newsletter on the shared address, contacts
// from an import, one deleted after it unsubscribed and an address the import left out, a campaign with a test sent, a
// verified domain, an image on S3, an API key, a connected app, problem events, suppressions and an alert.
async function customer(email, slug) {
	const user = await signIn(email);
	await collection("auth_accounts").insertOne({ userId: user.userId, providerId: "google", accountId: `google-${slug}`, createdAt: new Date(), updatedAt: new Date() });
	await activate(user);
	await createNewsletter(user, slug);
	await as(user, () =>
		m.contacts.importContacts({
			newsletterId: user.newsletterId,
			consent: true,
			rows: [
				{ email: `reader@${slug}.org`, status: "active" },
				{ email: `other@${slug}.org`, status: "active" },
				{ email: `left@${slug}.org`, status: "unsubscribed" },
				{ email: `info@${slug}.org`, status: "active" },
			],
		})
	);
	const left = await m.Contact.findOne({ accountId: user.accountId, email: `left@${slug}.org` }).lean();
	assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(left._id))), { ok: true });
	user.campaignId = await createCampaign(user);
	assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(user.campaignId)), { ok: true });
	user.domain = `${slug}.dev`;
	await addVerifiedDomain(user, user.domain);
	user.imageUrl = await uploadImage(user);
	user.apiKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "full" })))).key;
	await connectApp(user);
	await m.Event.create({ accountId: user.accountId, type: "bounce", email: `reader@${slug}.org` });
	await m.Suppression.create({ accountId: user.accountId, email: `gone@${slug}.org`, reason: "bounce" });
	await m.Alert.create({ accountId: user.accountId, key: `test-${slug}`, title: "Test", lastSentAt: new Date() });
	await m.Notification.create({ accountId: user.accountId, key: `test-${slug}`, kind: "import-done", title: "Imported 2 new contacts", at: new Date() });
	await m.PageView.create({ accountId: user.accountId, campaignId: user.campaignId, hour: new Date("2026-11-02T10:00:00Z"), views: 3 });
	user.account = await m.Account.findById(user.accountId).lean();
	return user;
}

const ACCOUNT_MODELS = ["Newsletter", "Contact", "ContactImport", "LeftOutContact", "DeletedContact", "Campaign", "Message", "Event", "Suppression", "Upload", "Domain", "ApiKey", "Alert", "Notification", "PageView"];

async function countData(user) {
	const counts = {};
	for (const name of ACCOUNT_MODELS) counts[name] = await m[name].countDocuments({ accountId: user.accountId });
	const owned = { userId: user.userId };
	for (const name of OAUTH_COLLECTIONS) counts[name] = await collection(name).countDocuments(owned);
	counts.sessions = await collection("sessions").countDocuments(owned);
	counts.signInMethods = await collection("auth_accounts").countDocuments(owned);
	counts.user = await collection("users").countDocuments({ _id: user.userId });
	counts.account = await m.Account.countDocuments({ _id: user.accountId });
	return counts;
}

before(async () => {
	app = await startTestApp({ ...S3, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		account: await import("../app/(account)/account/actions.js"),
		restore: await import("../app/restore/actions.js"),
		signin: await import("../app/signin/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		uploadsRoute: await import("../app/api/uploads/route.js"),
		purgeRoute: await import("../app/api/jobs/purge-account/route.js"),
		auth: await import("../lib/auth.js"),
		deletion: await import("../lib/account-deletion.js"),
		state: await import("../lib/account-state.js"),
		billing: await import("../lib/billing.js"),
		archive: await import("../lib/archive-data.js"),
		publicNewsletters: await import("../lib/public-newsletters.js"),
		sending: await import("../lib/sending.js"),
		registry: await import("../lib/actions/registry.js"),
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		ContactImport: (await import("../models/ContactImport.js")).default,
		DeletedContact: (await import("../models/DeletedContact.js")).default,
		DeletionRecord: (await import("../models/DeletionRecord.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Event: (await import("../models/Event.js")).default,
		LeftOutContact: (await import("../models/LeftOutContact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		Notification: (await import("../models/Notification.js")).default,
		PageView: (await import("../models/PageView.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
		Upload: (await import("../models/Upload.js")).default,
	};
});

after(() => app?.stop());

describe("what blocks a deletion", () => {
	test("a plan that's active, trialing or past due: no code goes out, and a code from before doesn't delete either", async () => {
		const user = await signIn("paying@example.com");
		const codeBeforePlan = await sendCode(user);
		for (const subscriptionStatus of ["active", "trialing", "past_due"]) {
			await activate(user, { subscriptionStatus });
			const blockers = await m.deletion.getDeletionBlockers(user.account);
			assert.deepEqual({ hasPlan: blockers.hasPlan, campaigns: blockers.campaigns.length }, { hasPlan: true, campaigns: 0 }, subscriptionStatus);
			const emails = platformEmails.length;
			assert.deepEqual(await as(user, () => m.account.sendDeletionCode()), BLOCKED, subscriptionStatus);
			assert.equal(platformEmails.length, emails, "no code sent");
			assert.deepEqual(await deleteWith(user, { code: codeBeforePlan }), BLOCKED, subscriptionStatus);
		}
		assert.equal((await m.Account.findById(user.accountId).lean()).deletion, undefined);

		await cancelPlan(user);
		assert.equal(await m.deletion.getDeletionBlockers(await m.Account.findById(user.accountId).lean()), null);
		assert.deepEqual(await deleteWith(user, { code: codeBeforePlan }), { redirect: "/signin?deleted=1" }, "the code wasn't used up while blocked");
	});

	test("a campaign sending or scheduled, until it's paused or unscheduled; drafts, paused and sent ones don't block", async () => {
		const user = await signIn("campaigns@example.com");
		await createNewsletter(user, "campaign-news");
		const scheduled = await createCampaign(user, "Next week");
		const sending = await createCampaign(user, "Going out");
		const others = await Promise.all(["Draft", "Paused", "Sent"].map((subject) => createCampaign(user, subject)));
		await m.Campaign.updateOne({ accountId: user.accountId, _id: scheduled }, { $set: { status: "scheduled", scheduledAt: new Date(Date.now() + DAY_MS) } });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: sending }, { $set: { status: "sending" } });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: others[1] }, { $set: { status: "paused" } });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: others[2] }, { $set: { status: "sent", sentAt: new Date() } });

		const blockers = await m.deletion.getDeletionBlockers(user.account);
		assert.equal(blockers.hasPlan, false);
		assert.deepEqual(blockers.campaigns.map(({ subject, status }) => `${subject}: ${status}`).sort(), ["Going out: sending", "Next week: scheduled"]);
		assert.deepEqual(await as(user, () => m.account.sendDeletionCode()), BLOCKED);

		await activate(user);
		assert.deepEqual(await as(user, () => m.campaigns.pauseCampaign(sending)), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.unscheduleCampaign(scheduled)), { ok: true });
		await cancelPlan(user);
		assert.equal(await m.deletion.getDeletionBlockers(await m.Account.findById(user.accountId).lean()), null);
		await deleteAccount(user);
	});
});

describe("the confirmation", () => {
	test("takes a fresh code sent for deleting, never a sign-in code, someone else's code, an old one or a mistyped email", async () => {
		const user = await signIn("code@example.com");
		const someone = await signIn("someone-else@example.com");

		assert.deepEqual(await deleteWith(user, { code: "123456" }), WRONG_CODE, "no code asked for yet");
		await as(user, () => m.signin.sendSigninCode(null, form({ email: user.email })));
		const signinCode = platformEmails.findLast(({ to }) => to.includes(user.email)).subject.slice(0, 6);
		assert.deepEqual(await deleteWith(user, { code: signinCode }), WRONG_CODE, "a sign-in code doesn't delete");
		assert.deepEqual(await deleteWith(user, { code: await sendCode(someone) }), WRONG_CODE, "someone else's code");

		const code = await sendCode(user);
		const email = platformEmails.at(-1);
		assert.deepEqual(email.to, [user.email]);
		assert.match(email.text, /If you didn't ask for it, don't share it/);
		const stored = await collection("verifications").findOne({ identifier: `email-verification-otp-${user.email}` });
		assert.equal(stored.value.includes(code), false, "stored hashed");

		assert.deepEqual(await deleteWith(user, { code, email: "code@example.org" }), { error: "Type your email address to confirm" });
		assert.deepEqual(await deleteWith(user, { code: "12345" }), { error: "Enter the 6-digit code" });
		await collection("verifications").updateOne({ _id: stored._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
		assert.deepEqual(await deleteWith(user, { code }), WRONG_CODE, "expired after 5 minutes");
		assert.equal((await m.Account.findById(user.accountId).lean()).deletion, undefined);

		const fresh = await sendCode(user);
		assert.deepEqual(await deleteWith(user, { code: fresh, email: "  Code@Example.com " }), { redirect: "/signin?deleted=1" });
		const again = await signIn(user.email);
		assert.equal(await as(again, () => catchRedirect(m.restore.restoreDeletedAccount())), "/");
		assert.deepEqual(await deleteWith(again, { code: fresh }), WRONG_CODE, "a code works once");
	});

	test("a wrong code three times ends it, and codes are limited per account", async () => {
		const user = await signIn("tries@example.com");
		const code = await sendCode(user);
		const wrong = code === "000000" ? "111111" : "000000";
		for (let attempt = 0; attempt < 3; attempt++) assert.deepEqual(await deleteWith(user, { code: wrong }), WRONG_CODE);
		assert.deepEqual(await deleteWith(user, { code }), WRONG_CODE, "dead after 3 wrong tries");
		await sendCode(user);
		await sendCode(user);
		assert.deepEqual(await as(user, () => m.account.sendDeletionCode()), { error: "Too many codes. Try again in 15 minutes." });
	});

	test("isn't an action, so no API key or connected app can delete an account or change its profile", () => {
		for (const { name } of m.registry.ACTIONS) assert.doesNotMatch(name, /account|profile|user/, name);
	});
});

describe("a deleted account", () => {
	test("stops at once: every session, its API keys, its connected apps, its signups and archive, even where there's no billing", async () => {
		const user = await signIn("stopped@example.com");
		const otherDevice = await signIn("stopped@example.com");
		const bystander = await signIn("bystander@example.com");
		await activate(user);
		await createNewsletter(user, "stopped-news");
		await addSentIssue(user);
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "full" })));
		await connectApp(user);
		await connectApp(bystander);
		await cancelPlan(user);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		assert.ok(await withEnv({ MAILCHEAP_CLOUD: "" }, () => m.publicNewsletters.findOpenNewsletter({ slug: user.slug })), "open before");
		assert.ok(await withEnv({ MAILCHEAP_CLOUD: "" }, () => m.archive.getArchiveNewsletter(user.slug)), "online before");

		const before = Date.now();
		await deleteAccount(user);

		assert.equal(await as(user, () => m.auth.getCurrentAccount()), null, "signed out here");
		assert.equal(await as(otherDevice, () => m.auth.getCurrentAccount()), null, "and on the other device");
		assert.equal((await callApi("GET", "/api/v1/newsletters", { key })).status, 401);
		assert.ok((await m.ApiKey.findOne({ accountId: user.accountId }).lean()).revokedAt, "the key is revoked");
		for (const name of OAUTH_COLLECTIONS) {
			assert.equal(await collection(name).countDocuments({ userId: user.userId }), 0, name);
			assert.equal(await collection(name).countDocuments({ userId: bystander.userId }), 1, `someone else's ${name} stays`);
		}

		const account = await m.Account.findById(user.accountId).lean();
		assert.equal(m.state.isDeletionPending(account), true);
		assert.equal(m.state.getAccountStatus(account), "deleting");
		for (const cloud of ["true", ""]) {
			await withEnv({ MAILCHEAP_CLOUD: cloud }, async () => {
				assert.equal(m.state.hasActiveSubscription(account), false, `MAILCHEAP_CLOUD=${cloud}`);
				assert.equal(await m.publicNewsletters.findOpenNewsletter({ slug: user.slug }), null, "no more signups");
				assert.equal(await m.archive.getArchiveNewsletter(user.slug), null, "the archive is offline");
				const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: `late-${cloud || "self"}@example.org` });
				const welcome = { ...newsletter, welcome: { enabled: true, subject: "Hi", markdown: "Welcome" } };
				assert.deepEqual(await m.sending.queueWelcomeEmail({ newsletter: welcome, contact }), { skipped: "no active plan" });
			});
		}

		const job = findPurgeJob(user);
		const purgeAt = new Date(job.body.purgeAt).getTime();
		assert.ok(Math.abs(purgeAt - (before + 30 * DAY_MS)) < 60_000, "purged in 30 days");
		assert.equal(new Date(account.deletion.purgeAt).getTime(), purgeAt);
		assert.ok(job.notBefore * 1000 <= before + 7 * DAY_MS, "QStash holds a job 7 days at most, so it wakes up on the way");
		assert.deepEqual(await runPurgeJob(job.body), { waiting: true });
		assert.equal(findPurgeJob(user).body.purgeAt, job.body.purgeAt, "and waits again for the same time");

		const record = await m.DeletionRecord.findOne({ accountId: user.accountId }).lean();
		assert.ok(record.emailHash && record.requestedAt && !record.purgedAt);
		assert.doesNotMatch(JSON.stringify(record), /stopped/);
	});

	test("can be restored by signing in within the grace period, and the purge job then does nothing", async () => {
		const user = await signIn("restored@example.com");
		await createNewsletter(user, "restored-news");
		await addSentIssue(user);
		await deleteAccount(user);
		const job = findPurgeJob(user);

		const again = await signIn(user.email);
		assert.equal(await as(again, () => catchRedirect(m.auth.requireAccount())), "/restore", "the dashboard waits for the answer");
		assert.equal(await as(again, () => catchRedirect(m.restore.restoreDeletedAccount())), "/");
		const { account } = await as(again, () => m.auth.requireAccount());
		assert.equal(String(account._id), String(user.accountId), "the same account");
		assert.equal(account.deletion, undefined);
		assert.equal(await m.Newsletter.countDocuments({ accountId: user.accountId }), 1, "with its data");
		assert.equal(await m.DeletionRecord.countDocuments({ accountId: user.accountId }), 0, "it wasn't deleted after all");
		assert.ok(await withEnv({ MAILCHEAP_CLOUD: "" }, () => m.archive.getArchiveNewsletter(user.slug)), "the archive is back where no plan is needed");

		assert.deepEqual(await runPurgeJob(job.body), { skipped: "not set to be purged at this time" });
		assert.equal((await countData(user)).account, 1);
	});

	test("once its purge has started, can't be restored", async () => {
		const user = await signIn("too-late@example.com");
		await deleteAccount(user);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { "deletion.purgeStartedAt": new Date() } });
		const again = await signIn(user.email);
		assert.deepEqual(await as(again, () => m.restore.restoreDeletedAccount()), { error: "Your account is being deleted, so it can't be restored anymore." });
		assert.equal(await as(again, () => catchRedirect(m.auth.requireAccount())), "/restore");
	});
});

describe("the purge", () => {
	test("deletes that account's data, at the provider, in DNS and on S3 too, keeps everyone else's, and keeps a deletion record", async () => {
		const doomed = await customer("doomed@example.com", "doomed-news");
		const kept = await customer("kept@example.com", "kept-news");
		const [doomedNewsletter, keptNewsletter] = await Promise.all(
			[doomed, kept].map((user) => m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean())
		);
		const [doomedUpload, keptUpload] = await Promise.all([doomed, kept].map((user) => m.Upload.findOne({ accountId: user.accountId }).lean()));
		const [doomedDomain, keptDomain] = await Promise.all([doomed, kept].map((user) => m.Domain.findOne({ accountId: user.accountId }).lean()));
		const keptCounts = await countData(kept);
		assert.deepEqual(Object.keys(keptCounts).filter((name) => keptCounts[name] === 0), [], "one of everything");
		assert.ok(doomedNewsletter.sharedSender.dnsRecordIds.length > 0 && objects.some(({ Key }) => Key === doomedUpload.pathname));

		await cancelPlan(doomed);
		await deleteAccount(doomed);
		const invalidationCount = invalidations.length;
		assert.deepEqual(await purgeNow(doomed), { purged: true });

		assert.deepEqual(
			await countData(doomed),
			Object.fromEntries(Object.keys(keptCounts).map((name) => [name, 0])),
			"nothing of it stays in the database"
		);
		assert.equal(await collection("verifications").countDocuments({ identifier: { $regex: doomed.email } }), 0, "nor its codes");
		assert.ok(deletedObjects.some(({ Key }) => Key === doomedUpload.pathname), "its image is gone from S3");
		assert.deepEqual(
			invalidations.slice(invalidationCount).map(({ DistributionId, InvalidationBatch }) => ({ DistributionId, Paths: InvalidationBatch.Paths })),
			[{ DistributionId: "E2TESTDISTRIBUTION", Paths: { Quantity: 1, Items: [`/accounts/${doomed.accountId}/*`] } }],
			"and from the CDN's cache, with one invalidation of its folder"
		);
		assert.deepEqual(invalidations.at(-1).config, {
			region: "us-east-1",
			credentials: { accessKeyId: "images-key-id", secretAccessKey: "images-secret" },
		});
		assert.equal(ses.identities.has(doomedDomain.domain), false, "its domain is gone from SES");
		assert.equal(ses.identities.has(doomedNewsletter.sharedSender.domain), false, "and its shared address's subdomain");
		assert.equal(ses.tenants.has(`mc-${doomed.accountId}`), false, "and its tenant");
		assert.equal(ses.configurationSets.has(`mc-${doomed.accountId}`), false);
		for (const id of doomedNewsletter.sharedSender.dnsRecordIds) assert.equal(dnsRecords.has(id), false, "its DNS records are gone");

		assert.deepEqual(await countData(kept), keptCounts, "everyone else's data stays");
		assert.ok(objects.some(({ Key }) => Key === keptUpload.pathname));
		assert.ok(ses.identities.has(keptDomain.domain) && ses.identities.has(keptNewsletter.sharedSender.domain) && ses.tenants.has(`mc-${kept.accountId}`));
		for (const id of keptNewsletter.sharedSender.dnsRecordIds) assert.ok(dnsRecords.has(id));
		assert.equal((await callApi("GET", "/api/v1/newsletters", { key: kept.apiKey })).status, 200);

		const record = await m.DeletionRecord.findOne({ accountId: doomed.accountId }).lean();
		assert.deepEqual(Object.keys(record).sort(), ["__v", "_id", "accountCreatedAt", "accountId", "emailHash", "purgedAt", "requestedAt"]);
		assert.equal(String(record.accountCreatedAt), String(doomed.account.createdAt));
		assert.doesNotMatch(JSON.stringify(record), /doomed/, "a hash, never the email or anything the account held");

		const admins = platformEmails.length;
		const returning = await signIn(doomed.email);
		assert.notEqual(String(returning.accountId), String(doomed.accountId), "signing in again opens a new account");
		assert.ok(
			platformEmails.slice(admins).some(({ to, subject }) => to.includes("admin@example.com") && subject === "[MailCheap] A deleted account's email signed up again"),
			"and the admins hear of it"
		);
	});

	test("waits while a plan is active again, and a step that fails is tried again the next day", async () => {
		const user = await customer("stuck@example.com", "stuck-news");
		await cancelPlan(user);
		await deleteAccount(user);

		await activate(user);
		const held = await purgeNow(user);
		assert.match(held.postponed, /plan is active again/);
		assert.equal((await countData(user)).Contact, 2, "nothing deleted");
		await cancelPlan(user);

		const upload = await m.Upload.findOne({ accountId: user.accountId }).lean();
		refusedDeletes.add(upload.pathname);
		const failed = await purgeNow(user);
		assert.match(failed.postponed, /S3 didn't delete 1 images: AccessDenied/);
		const retry = findPurgeJob(user);
		assert.ok(retry.notBefore * 1000 > Date.now() + DAY_MS - 60_000, "tomorrow");
		assert.equal(await m.Upload.countDocuments({ accountId: user.accountId }), 1, "kept, so the next try deletes the file");
		assert.equal((await countData(user)).user, 0, "the rest went ahead");
		assert.ok(
			platformEmails.some(({ to, subject }) => to.includes("admin@example.com") && subject === "[MailCheap] Account purge postponed"),
			"the admins hear of it"
		);

		refusedDeletes.clear();
		assert.deepEqual(await runPurgeJob(retry.body), { purged: true });
		assert.equal((await countData(user)).Upload, 0);
	});

	test("an invalidation CloudFront refuses is tried again the next day, until the CDN's cache is cleared", async () => {
		const user = await signIn("cdn-refused@example.com");
		await uploadImage(user);
		await deleteAccount(user);
		const path = `/accounts/${user.accountId}/*`;

		refusedDistributions.add(S3.IMAGES_CLOUDFRONT_DISTRIBUTION_ID);
		const failed = await purgeNow(user);
		assert.match(failed.postponed, /CloudFront didn't invalidate \/accounts\/\w+\/\*: AccessDenied User is not authorized/);
		assert.ok(failed.postponed.includes(path));
		const retry = findPurgeJob(user);
		assert.ok(retry.notBefore * 1000 > Date.now() + DAY_MS - 60_000, "tomorrow");
		assert.ok(
			platformEmails.some(({ to, text }) => to.includes("admin@example.com") && text.includes(`CloudFront didn't invalidate ${path}`)),
			"the admins hear of it"
		);
		assert.equal(await m.Upload.countDocuments({ accountId: user.accountId }), 1);

		refusedDistributions.clear();
		const count = invalidations.length;
		assert.deepEqual(await runPurgeJob(retry.body), { purged: true });
		assert.deepEqual(invalidations.slice(count).map(({ InvalidationBatch }) => InvalidationBatch.Paths.Items), [[path]]);
		assert.equal((await countData(user)).account, 0);
	});

	test("without a CloudFront distribution (self-hosted, or images on Vercel Blob), deletes the images and invalidates nothing", async () => {
		const user = await signIn("no-cdn@example.com");
		const imageUrl = await withEnv({ IMAGES_S3_BUCKET: "" }, () => uploadImage(user));
		assert.ok(imageUrl.startsWith("https://blob.example.com/accounts/"));
		await deleteAccount(user);

		const count = invalidations.length;
		assert.deepEqual(await withEnv({ IMAGES_CLOUDFRONT_DISTRIBUTION_ID: "" }, () => purgeNow(user)), { purged: true });
		assert.ok(deletedBlobs.includes(imageUrl), "its image is gone from Vercel Blob");
		assert.equal(invalidations.length, count);
	});

	test("on PostShiba: the tenant is suspended at once, resumed on restore, and deleted with its domains by the purge", async () => {
		const fake = createFakePostshiba();
		const uninstall = fake.install();
		try {
			await withEnv(POSTSHIBA_ENV, async () => {
				const user = await signIn("ps-delete@example.com");
				await m.billing.applySubscription(user.account, {
					id: "sub_ps_delete",
					status: "active",
					customer: "cus_ps_delete",
					items: { data: [{ price: { lookup_key: "starter_month" }, current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
				});
				await createNewsletter(user, "ps-delete-news");
				assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "ps-delete.dev" }))), { ok: true, domain: "ps-delete.dev" });
				const { tenantId } = (await m.Account.findById(user.accountId).lean()).postshiba;
				const tenantDomains = () => [...fake.state.domains.values()].filter((domain) => domain.tenant_id === tenantId).map(({ name }) => name).sort();
				assert.deepEqual(tenantDomains(), ["ps-delete-news.mailcheapmail.com", "ps-delete.dev"]);
				await cancelPlan(user);

				await deleteAccount(user);
				assert.equal(fake.state.tenants.get(tenantId).suspended, true, "PostShiba refuses its mail at once");
				const again = await signIn(user.email);
				await as(again, () => catchRedirect(m.restore.restoreDeletedAccount()));
				assert.equal(fake.state.tenants.get(tenantId).suspended, false, "and sends it again once restored");

				await deleteAccount(again);
				assert.deepEqual(await purgeNow(user), { purged: true });
				assert.equal(fake.state.tenants.has(tenantId), false, "the tenant is gone");
				assert.deepEqual(tenantDomains(), []);
				assert.equal([...fake.state.domains.values()].some(({ name }) => name.includes("ps-delete")), false, "deleted, not moved to the team's default tenant");
			});
		} finally {
			uninstall();
		}
	});
});
