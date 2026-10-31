import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { activate, addVerifiedDomain, anonymous, as, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";

// The dashboard's get-started panel: each newsletter has its own. Its steps count the newsletter's own campaigns and
// contacts, and the account's domain and AI agent; nothing another account has counts. A newsletter's list finishes for
// good once every step but the optional domain is done, and closing it hides it for good, on every device, for that
// newsletter only: the account's other newsletters, and the ones it adds later, keep theirs.
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		welcome: await import("../app/welcome/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		getStarted: await import("../lib/get-started.js"),
		selection: await import("../lib/selected-newsletter.js"),
		Account: (await import("../models/Account.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

async function customer(email, { hasPlan = false } = {}) {
	const user = await signIn(email);
	if (hasPlan) await activate(user);
	user.slug = email.split("@")[0];
	user.newsletterId = await addNewsletter(user, user.slug);
	return user;
}

async function addNewsletter(user, slug) {
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" })
			)
		)
	);
	return url.split("/").at(-1);
}

async function draft(user, subject = "Issue") {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

function addReader(user) {
	const rows = [{ email: `reader@${user.slug}.example.org`, status: "active" }];
	return as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
}

function createKey(user, level) {
	return as(user, () => m.apiKeys.createApiKey(null, form({ name: level, level })));
}

// What Better Auth keeps when someone clicks Allow on the consent page (tests/oauth.test.mjs goes through it).
function connectApp(user) {
	const now = new Date();
	return mongoose.connection.db
		.collection("oauthConsent")
		.insertOne({ clientId: "https://chatgpt.com/connector/mailcheap", userId: user.userId, scopes: ["openid", "mcp"], createdAt: now, updatedAt: now });
}

function tomorrow() {
	return new Date(Date.now() + 86_400_000).toISOString();
}

function loadAccount(user) {
	return m.Account.findById(user.accountId).lean();
}

function loadNewsletter(user, newsletterId = user.newsletterId) {
	return m.Newsletter.findOne({ accountId: user.accountId, _id: newsletterId }).lean();
}

async function isOpen(user, newsletterId = user.newsletterId) {
	return m.getStarted.isGetStartedOpen(await loadAccount(user), await loadNewsletter(user, newsletterId));
}

async function check(user, newsletterId = user.newsletterId) {
	return m.getStarted.getGetStartedSteps(await loadAccount(user), newsletterId);
}

async function doneSteps(user, newsletterId = user.newsletterId) {
	const { steps } = await check(user, newsletterId);
	return steps.filter(({ isDone }) => isDone).map(({ id }) => id);
}

describe("the steps", () => {
	test("a new account has all five to do, subscribers first, the domain one optional and the AI agent last, and sees the list", async () => {
		const user = await customer("gs-new@example.com");
		const { steps, draftId, isFinished } = await check(user);
		assert.deepEqual(
			steps.map(({ id, isDone, isOptional }) => [id, isDone, Boolean(isOptional)]),
			[
				["subscribers", false, false],
				["write", false, false],
				["domain", false, true],
				["send", false, false],
				["agent", false, false],
			]
		);
		assert.equal(draftId, null);
		assert.equal(isFinished, false);
		assert.equal(await isOpen(user), true);
		assert.equal(m.getStarted.isGetStartedOpen(await loadAccount(user), null), false, "no list without a newsletter");
	});

	test("writing: any campaign but a discarded one; the send step opens the draft edited last", async () => {
		const user = await customer("gs-write@example.com");
		const discarded = await draft(user);
		assert.deepEqual(await doneSteps(user), ["write"]);
		await as(user, () => m.campaigns.discardCampaign(discarded));
		assert.deepEqual(await doneSteps(user), [], "a discarded draft is gone");

		const older = await draft(user, "First");
		const newer = await draft(user, "Second");
		assert.equal((await check(user)).draftId, newer);
		await as(user, () => m.campaigns.saveCampaign(older, { subject: "First, edited", previewText: "", body: "<p>Hi</p>" }));
		assert.equal((await check(user)).draftId, older);
	});

	test("subscribers: any contact, which an account adds once it has a plan", async () => {
		const user = await customer("gs-readers@example.com");
		assert.equal((await addReader(user)).code, "subscription_required");
		assert.deepEqual(await doneSteps(user), []);
		await activate(user);
		await addReader(user);
		assert.deepEqual(await doneSteps(user), ["subscribers"]);
	});

	test("an AI agent: a full access key that isn't revoked, or an app connected with OAuth", async () => {
		const user = await customer("gs-agent@example.com", { hasPlan: true });
		await createKey(user, "signups");
		assert.deepEqual(await doneSteps(user), [], "a signups only key can't run an agent");
		await createKey(user, "full");
		assert.deepEqual(await doneSteps(user), ["agent"]);
		const key = await m.ApiKey.findOne({ accountId: user.accountId, level: "full" }).lean();
		assert.deepEqual(await as(user, () => m.apiKeys.revokeApiKey(key._id)), { ok: true });
		assert.deepEqual(await doneSteps(user), [], "a revoked key connects nothing");

		const connected = await customer("gs-chatgpt@example.com");
		await connectApp(connected);
		assert.deepEqual(await doneSteps(connected), ["agent"], "no plan needed: ChatGPT and Claude connect with OAuth");
		assert.deepEqual(await doneSteps(user), [], "another account's app doesn't count");
	});

	test("an own domain: once it's verified; optional with a shared domain, needed without one", async () => {
		const user = await customer("gs-domain@example.com", { hasPlan: true });
		assert.equal((await as(user, () => m.domains.addDomainAction(null, form({ domain: "gs-pending.dev" })))).ok, true);
		assert.deepEqual(await doneSteps(user), [], "not until it's verified");
		await addVerifiedDomain(user, "gs-domain.dev");
		assert.deepEqual(await doneSteps(user), ["domain"]);

		const isOptional = async () => (await check(user)).steps.find(({ id }) => id === "domain").isOptional;
		assert.equal(await isOptional(), true);
		assert.equal(await withEnv({ SHARED_DOMAIN: "" }, isOptional), false);
	});

	test("sending: a campaign scheduled or sent; unscheduling takes it back", async () => {
		const user = await customer("gs-send@example.com", { hasPlan: true });
		await addReader(user);
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() })), { ok: true });
		assert.deepEqual(await doneSteps(user), ["subscribers", "write", "send"]);
		assert.deepEqual(await as(user, () => m.campaigns.unscheduleCampaign(id)), { ok: true });
		assert.deepEqual(await doneSteps(user), ["subscribers", "write"]);
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		assert.deepEqual(await doneSteps(user), ["subscribers", "write", "send"]);
	});

	test("each newsletter counts its own issues, subscribers and sends; the domain and the AI agent count for all", async () => {
		const user = await customer("gs-two@example.com", { hasPlan: true });
		await addReader(user);
		await createKey(user, "full");
		await addVerifiedDomain(user, "gs-two.dev");
		const id = await draft(user);
		await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() }));
		assert.deepEqual(await doneSteps(user), ["subscribers", "write", "domain", "send", "agent"]);

		const second = await addNewsletter(user, "gs-two-b");
		const { steps, draftId, isFinished } = await check(user, second);
		assert.deepEqual(steps.filter(({ isDone }) => isDone).map(({ id }) => id), ["domain", "agent"]);
		assert.equal(draftId, null, "the first newsletter's draft isn't this one's");
		assert.equal(isFinished, false);
	});
});

describe("the list", () => {
	test("finishes once every step but the optional domain is done, stays finished, and the next newsletter has its own", async () => {
		const user = await customer("gs-finish@example.com", { hasPlan: true });
		await addReader(user);
		await createKey(user, "full");
		const id = await draft(user);
		await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() }));

		const withoutSharedDomain = await withEnv({ SHARED_DOMAIN: "" }, () => check(user));
		assert.equal(withoutSharedDomain.isFinished, false, "without a shared domain, newsletters need a domain of their own");
		assert.equal(await isOpen(user), true);

		assert.equal((await check(user)).isFinished, true);
		assert.ok((await loadNewsletter(user)).getStarted.finishedAt instanceof Date);
		assert.equal(await isOpen(user), false);

		const key = await m.ApiKey.findOne({ accountId: user.accountId, level: "full" }).lean();
		await as(user, () => m.apiKeys.revokeApiKey(key._id));
		assert.equal(await isOpen(user), false, "a key revoked later doesn't bring it back");

		const added = await addNewsletter(user, "gs-finish-b");
		assert.equal(await isOpen(user, added), true);
		assert.equal((await loadAccount(user)).onboarding?.checklistFinishedAt, undefined, "nothing's kept on the account");
	});

	test("closed, it's hidden for good on every device for its newsletter alone, and the /welcome answers stay", async () => {
		const user = await signIn("gs-dismiss@example.com");
		await as(user, () => catchRedirect(m.welcome.completeOnboarding(null, form({ name: "Dismissed", listSize: "growth", listSource: "Substack" }))));
		user.newsletterId = String((await m.Newsletter.findOne({ accountId: user.accountId }).lean())._id);
		const sibling = await addNewsletter(user, "gs-dismiss-b");
		assert.equal(await isOpen(user), true);

		assert.deepEqual(await as(user, () => m.welcome.dismissGetStarted(user.newsletterId)), { ok: true });
		const { getStarted } = await loadNewsletter(user);
		assert.ok(getStarted.dismissedAt instanceof Date);
		assert.equal(await isOpen(user, sibling), true, "the account's other newsletter keeps its list");
		const account = await loadAccount(user);
		assert.deepEqual([account.onboarding.listSize, account.onboarding.listSource], ["growth", "Substack"]);
		assert.ok(account.onboarding.completedAt);
		assert.equal(account.onboarding.checklistDismissedAt, undefined);

		const otherDevice = await signIn("gs-dismiss@example.com");
		const { account: seen, selected } = await as(otherDevice, () => m.selection.getSelectedNewsletter());
		assert.equal(String(selected._id), user.newsletterId);
		assert.equal(m.getStarted.isGetStartedOpen(seen, selected), false);

		await as(otherDevice, () => m.welcome.dismissGetStarted(user.newsletterId));
		const again = await loadNewsletter(user);
		assert.equal(again.getStarted.dismissedAt.getTime(), getStarted.dismissedAt.getTime(), "closing again keeps the first date");

		const added = await addNewsletter(user, "gs-dismiss-c");
		assert.equal(await isOpen(user, added), true, "a newsletter added after shows it again");
	});

	test("closed or finished on the account, as before each newsletter had its own, it stays hidden for the newsletters it had then", async () => {
		for (const [field, slug] of [
			["checklistDismissedAt", "gs-was-closed"],
			["checklistFinishedAt", "gs-was-finished"],
		]) {
			const user = await customer(`${slug}@example.com`);
			const hourAgo = new Date(Date.now() - 3_600_000);
			await mongoose.connection.db.collection("newsletters").updateOne({ _id: new mongoose.Types.ObjectId(user.newsletterId) }, { $set: { createdAt: hourAgo } });
			await m.Account.updateOne({ _id: user.accountId }, { $set: { [`onboarding.${field}`]: new Date(Date.now() - 60_000) } });
			assert.equal(await isOpen(user), false, field);

			const added = await addNewsletter(user, `${slug}-b`);
			assert.equal(await isOpen(user, added), true, `${field}: a newsletter added after has its own`);
		}
	});

	test("closing takes one of the account's newsletters: another account's stays as it was", async () => {
		const user = await customer("gs-mine@example.com");
		const stranger = await customer("gs-stranger@example.com");
		assert.deepEqual(await as(stranger, () => m.welcome.dismissGetStarted(user.newsletterId)), { ok: true });
		assert.equal(await isOpen(user), true);
		assert.equal((await loadNewsletter(user)).getStarted?.dismissedAt, undefined);

		for (const id of [undefined, null, "", "not-an-id", { $ne: null }]) {
			assert.deepEqual(await as(user, () => m.welcome.dismissGetStarted(id)), { error: "Couldn't close it" }, JSON.stringify(id));
		}
		assert.equal(await isOpen(user), true);
	});

	test("closing needs a session", async () => {
		assert.equal(await anonymous(() => catchRedirect(m.welcome.dismissGetStarted("0123456789abcdef01234567"))), "/signin");
	});
});
