import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getCleanupSettings } from "../lib/cleanup.js";
import { activate, addVerifiedDomain, as, callApi, catchNotFound, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";

// Jane has two newsletters, Alpha (her first) and Beta, and a stranger has one. The dashboard shows the newsletter
// its cookie names, checked against Jane's account every time; each newsletter's campaigns and contacts only show
// under it; an account has up to 3, sharing the plan; the REST API and MCP use the first when none is named.
let app;
let m;
let jane;
let stranger;
let alpha;
let beta;
let strangerNewsletter;

async function createNewsletter(user, slug) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris" })))
	);
	return url.split("/").at(-1);
}

async function draft(user, newsletterId, subject) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)));
	const id = url.split("/").at(-1);
	assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "", body: "<p>Hello</p>" })), { ok: true });
	return id;
}

async function importReaders(user, newsletterId, emails) {
	const rows = emails.map((email) => ({ email, status: "active" }));
	return as(user, () => m.contacts.importContacts({ newsletterId, consent: true, rows }));
}

function getView(user) {
	return as(user, () => m.selection.getSelectedNewsletter());
}

function select(user, id, pathname) {
	return as(user, () => m.newsletters.selectNewsletter(id, pathname));
}

function open(user, id, next) {
	const url = `http://localhost:3000/newsletters/${id}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
	return as(user, () => m.openRoute.GET(new Request(url), { params: Promise.resolve({ id }) }));
}

async function shownContacts(user) {
	const { account, selected } = await getView(user);
	const { contacts } = await m.contactQueries.findContactsPage(account, { newsletterId: selected._id });
	return contacts.map(({ email }) => email).sort();
}

async function shownCampaigns(user) {
	const { account, selected } = await getView(user);
	const campaigns = await m.campaignQueries.listNewsletterCampaigns(account, selected._id, 200);
	return campaigns.map(({ subject }) => subject);
}

function api(key, method, path, body) {
	return callApi(method, `/api/v1${path}`, { key, body });
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		openRoute: await import("../app/(app)/newsletters/[id]/route.js"),
		addRoute: await import("../app/(app)/newsletters/new/route.js"),
		selection: await import("../lib/selected-newsletter.js"),
		rules: await import("../lib/newsletters.js"),
		contactQueries: await import("../lib/contacts.js"),
		campaignQueries: await import("../lib/campaign-queries.js"),
		getStarted: await import("../lib/get-started.js"),
		usage: await import("../lib/usage.js"),
		accounts: await import("../lib/accounts.js"),
		Account: (await import("../models/Account.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};

	jane = await signIn("jane@example.com");
	stranger = await signIn("stranger@example.com");
	await activate(jane);
	await activate(stranger);
	alpha = await createNewsletter(jane, "alpha");
	beta = await createNewsletter(jane, "beta-letter");
	strangerNewsletter = await createNewsletter(stranger, "stranger");

	assert.equal((await importReaders(jane, alpha, ["a1@example.org", "a2@example.org", "both@example.org"])).created, 3);
	assert.equal((await importReaders(jane, beta, ["b1@example.org", "both@example.org"])).created, 2);
	assert.equal((await importReaders(stranger, strangerNewsletter, ["s1@example.org"])).created, 1);
	await draft(jane, alpha, "Alpha issue");
	await draft(jane, beta, "Beta issue");
	await draft(stranger, strangerNewsletter, "Stranger issue");
	jane.key = (await as(jane, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
});

after(() => app?.stop());

describe("the open newsletter", () => {
	test("without a cookie it's the account's first newsletter", async () => {
		jane.jar.delete(m.rules.NEWSLETTER_COOKIE);
		const { newsletters, selected, savedId } = await getView(jane);
		assert.deepEqual(newsletters.map(({ slug }) => slug), ["alpha", "beta-letter"]);
		assert.equal(String(selected._id), alpha);
		assert.equal(savedId, null);
	});

	test("the menu switches to another of the account's newsletters, on the same section", async () => {
		assert.equal(await catchRedirect(select(jane, beta, `/campaigns/${alpha}`)), "/campaigns");
		assert.equal(jane.jar.get(m.rules.NEWSLETTER_COOKIE), beta);
		assert.equal(String((await getView(jane)).selected._id), beta);

		assert.equal(await catchRedirect(select(jane, alpha, "/newsletters")), "/newsletters");
		assert.deepEqual(await select(jane, beta, "/domains"), { ok: true }, "the account's own pages stay");
		assert.equal(jane.jar.get(m.rules.NEWSLETTER_COOKIE), beta);
		assert.equal(m.rules.getSwitchPath("/contacts"), "/contacts");
		assert.equal(m.rules.getSwitchPath("/"), "/");
		assert.equal(m.rules.getSwitchPath("/api-keys"), null);
		assert.equal(m.rules.getSwitchPath("/newsletters/sender"), "/newsletters/sender", "a settings page stays the same page");
		assert.equal(m.rules.getSwitchPath("/newsletters/design"), "/newsletters/design");
		assert.equal(m.rules.getSwitchPath(`/newsletters/${alpha}`), "/newsletters", "an ID isn't a settings page");
	});

	test("a forged ID is refused: another account's newsletter, or none, never opens", async () => {
		await select(jane, alpha, "/domains");
		for (const id of [strangerNewsletter, "000000000000000000000000", "not-an-id", ""]) {
			assert.deepEqual(await select(jane, id, "/contacts"), { error: "Newsletter not found" }, id);
			assert.equal(await catchNotFound(open(jane, id, "/contacts")), true, id);
		}
		assert.equal(jane.jar.get(m.rules.NEWSLETTER_COOKIE), alpha, "the cookie didn't change");

		jane.jar.set(m.rules.NEWSLETTER_COOKIE, strangerNewsletter);
		const { selected, savedId } = await getView(jane);
		assert.equal(String(selected._id), alpha, "a cookie naming another account's newsletter falls back to Jane's first");
		assert.equal(savedId, strangerNewsletter, "the menu compares with the cookie as read, so it doesn't refresh for it");
		assert.deepEqual(await shownContacts(jane), ["a1@example.org", "a2@example.org", "both@example.org"]);
		jane.jar.set(m.rules.NEWSLETTER_COOKIE, "garbage");
		assert.equal(String((await getView(jane)).selected._id), alpha);
	});

	test("/newsletters/<id> opens the newsletter, then its settings or a safe ?next=", async () => {
		await select(jane, alpha, "/domains");
		assert.equal(await catchRedirect(open(jane, beta, `/campaigns/${beta}`)), `/campaigns/${beta}`);
		assert.equal(jane.jar.get(m.rules.NEWSLETTER_COOKIE), beta);
		assert.equal(await catchRedirect(open(jane, alpha)), "/newsletters");
		assert.equal(jane.jar.get(m.rules.NEWSLETTER_COOKIE), alpha);
		for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
			assert.equal(await catchRedirect(open(jane, beta, next)), "/", next);
		}
	});

	test("a page of another of the account's newsletters goes through it first; other IDs change nothing", async () => {
		await select(jane, alpha, "/domains");
		const view = await getView(jane);
		const path = `/campaigns/${beta}`;
		assert.equal(await catchRedirect(Promise.resolve().then(() => m.selection.openNewsletter(view, beta, path))), m.rules.getNewsletterPagePath(beta, path));
		for (const id of [alpha, strangerNewsletter, "not-an-id", undefined]) {
			assert.equal(m.selection.openNewsletter(view, id, path), undefined, String(id));
		}
	});
});

describe("each newsletter's pages only show its own", () => {
	test("Beta's contacts and campaigns never show under Alpha, nor Alpha's under Beta", async () => {
		await select(jane, alpha, "/domains");
		assert.deepEqual(await shownContacts(jane), ["a1@example.org", "a2@example.org", "both@example.org"]);
		assert.deepEqual(await shownCampaigns(jane), ["Alpha issue"]);

		await select(jane, beta, "/domains");
		assert.deepEqual(await shownContacts(jane), ["b1@example.org", "both@example.org"]);
		assert.deepEqual(await shownCampaigns(jane), ["Beta issue"]);
		const { account } = await getView(jane);
		const counts = await m.contactQueries.findContactsPage(account, { newsletterId: beta, query: "a" });
		assert.equal(counts.totalAll, 0, "searching Beta never finds Alpha's a1 and a2");
	});

	test("new drafts and imports go to the newsletter they name, after it's checked against the account", async () => {
		const id = await draft(jane, beta, "Beta second");
		assert.equal(String((await m.Campaign.findOne({ accountId: jane.accountId, _id: id }).lean()).newsletterId), beta);
		assert.equal((await importReaders(jane, beta, ["b2@example.org"])).created, 1);
		assert.equal(await m.Contact.countDocuments({ accountId: jane.accountId, newsletterId: alpha, email: "b2@example.org" }), 0);

		const before = await m.Contact.countDocuments({ accountId: stranger.accountId });
		assert.deepEqual(await as(jane, () => m.campaigns.createCampaign(strangerNewsletter)), { error: "Newsletter not found" });
		assert.deepEqual(await importReaders(jane, strangerNewsletter, ["spam@example.net"]), { error: "Newsletter not found" });
		assert.deepEqual(await as(jane, () => m.contacts.exportContacts({ newsletterId: strangerNewsletter })), { error: "Newsletter not found" });
		assert.equal(await m.Contact.countDocuments({ accountId: stranger.accountId }), before);
		assert.equal(await m.Campaign.countDocuments({ accountId: jane.accountId, newsletterId: strangerNewsletter }), 0);
	});

	test("Get started opens the open newsletter's draft", async () => {
		const account = await m.Account.findById(jane.accountId).lean();
		const alphaDraft = (await m.Campaign.findOne({ accountId: jane.accountId, newsletterId: alpha, status: "draft" }).lean())._id;
		assert.equal((await m.getStarted.getGetStartedSteps(account, alpha)).draftId, String(alphaDraft));
		const betaDraft = (await m.getStarted.getGetStartedSteps(account, beta)).draftId;
		assert.equal(String((await m.Campaign.findOne({ accountId: jane.accountId, _id: betaDraft }).lean()).newsletterId), beta);
	});
});

describe("the plan is the account's", () => {
	test("subscribers count every newsletter, and a send checks them all", async () => {
		const account = await m.Account.findById(jane.accountId).lean();
		const active = await m.Contact.countDocuments({ accountId: jane.accountId, status: "active" });
		assert.equal(active, 6);
		assert.equal((await m.usage.getUsage(account)).subscribers, active);

		await m.accounts.setLimitOverrides(jane.accountId, { emailsPerMonth: 1000, subscribers: 5 });
		const alphaDraft = await m.Campaign.findOne({ accountId: jane.accountId, newsletterId: alpha, status: "draft" }).lean();
		const sent = await api(jane.key, "POST", `/campaigns/${alphaDraft._id}/send`);
		assert.equal(sent.status, 402, JSON.stringify(sent.body));
		assert.equal(sent.body.error.code, "plan_limit_subscribers");
		assert.match(sent.body.error.message, /You have 6 subscribers and your plan allows 5/, "Alpha alone has 3");
		await m.accounts.setLimitOverrides(jane.accountId, {});
	});
});

describe("up to 3 newsletters", () => {
	test("the dashboard, Add a newsletter's dialog and the REST API all stop at 3, and say so", async () => {
		const user = await signIn("three@example.com");
		await activate(user);
		const first = await createNewsletter(user, "three-one");
		await createNewsletter(user, "three-two");
		await createNewsletter(user, "three-three");
		const limit = m.rules.NEWSLETTER_LIMIT_MESSAGE;
		assert.equal(limit, "An account has up to 3 newsletters");

		const fourth = await as(user, () => m.newsletters.saveNewsletter(null, form({ name: "Four", slug: "three-four" })));
		assert.deepEqual(fourth, { error: limit });
		assert.deepEqual(await as(user, () => m.newsletters.createNewsletter(null, form({ name: "Four" }))), { error: limit });
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const response = await api(key, "POST", "/newsletters", { name: "Four" });
		assert.equal(response.status, 409);
		assert.deepEqual(response.body, { error: { code: "conflict", message: limit } });
		assert.equal(await m.Newsletter.countDocuments({ accountId: user.accountId }), 3);

		const listed = (await api(key, "GET", "/newsletters")).body.newsletters;
		assert.deepEqual(listed.map(({ slug }) => slug), ["three-one", "three-two", "three-three"], "first created first");
		assert.equal(String((await getView(user)).selected._id), first);
	});
});

describe("Add a newsletter's dialog", () => {
	test("its action names it, takes the open newsletter's sender and postal address, opens it, then its settings", async () => {
		const user = await signIn("short@example.com");
		await createNewsletter(user, "short-first");
		const open = await createNewsletter(user, "short-open");
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: open }, { $set: { fromName: "Jo", postalAddress: "2 Side St, Lyon" } });
		assert.deepEqual(await select(user, open, "/domains"), { ok: true });
		assert.deepEqual(await as(user, () => m.newsletters.createNewsletter(null, form({ name: " " }))), { error: "Name your newsletter" });

		const url = await as(user, () => catchRedirect(m.newsletters.createNewsletter(null, form({ name: "Third letter", description: "Two ideas." }))));
		assert.equal(url, "/newsletters");
		const created = await m.Newsletter.findOne({ accountId: user.accountId, slug: "third-letter" }).lean();
		assert.deepEqual(
			[created.name, created.description, created.fromName, created.postalAddress, created.fromEmail],
			["Third letter", "Two ideas.", "Jo", "2 Side St, Lyon", "hello@third-letter.mailcheapmail.com"]
		);
		assert.deepEqual(getCleanupSettings(created), { enabled: true, issues: 6, days: 180 }, "list cleanup starts on");
		assert.equal(user.jar.get(m.rules.NEWSLETTER_COOKIE), String(created._id), "the new newsletter is the open one");
		assert.equal(String((await getView(user)).selected._id), String(created._id));
	});

	test("without a shared domain, it sends from an address on one of the account's domains", async () => {
		const user = await signIn("own-domain@example.com");
		await activate(user);
		await addVerifiedDomain(user, "own-domain.dev");
		await withEnv({ SHARED_DOMAIN: "" }, async () => {
			const add = (fields) => as(user, () => m.newsletters.createNewsletter(null, form(fields)));
			assert.deepEqual(await add({ name: "Own notes" }), { error: "From email is invalid" });
			assert.equal(await catchRedirect(add({ name: "Own notes", fromEmail: "notes@own-domain.dev" })), "/newsletters");
		});
		const created = await m.Newsletter.findOne({ accountId: user.accountId, slug: "own-notes" }).lean();
		assert.equal(created.fromEmail, "notes@own-domain.dev");
	});

	test("/newsletters/new, the page it replaced, opens it on the dashboard", async () => {
		const url = await catchRedirect(Promise.resolve().then(() => m.addRoute.GET()));
		const { pathname, searchParams } = new URL(url, "http://localhost:3000");
		assert.equal(pathname, "/");
		assert.equal(searchParams.has(m.rules.ADD_NEWSLETTER_PARAM), true, "the newsletter menu opens its dialog");
	});
});

describe("the REST API and MCP with several newsletters", () => {
	test("without a newsletter named, actions use the first; lists take every newsletter or the one named", async () => {
		await select(jane, beta, "/domains");
		const added = await api(jane.key, "POST", "/contacts", { email: "site-form@example.org" });
		assert.equal(added.status, 201);
		assert.equal(added.body.newsletterId, alpha, "a site's form keeps reaching the first newsletter, whatever the dashboard shows");
		const created = await api(jane.key, "POST", "/campaigns", { subject: "From an agent" });
		assert.equal(created.body.newsletterId, alpha);
		assert.equal((await api(jane.key, "GET", "/overview")).body.newsletter.slug, "alpha");
		assert.equal((await api(jane.key, "GET", "/overview?newsletter=beta-letter")).body.newsletter.slug, "beta-letter");

		const betaOnly = (await api(jane.key, "GET", "/contacts?newsletter=beta-letter")).body.contacts;
		assert.equal(betaOnly.every(({ newsletterId }) => newsletterId === beta), true);
		const everyone = (await api(jane.key, "GET", "/contacts?limit=100")).body.contacts;
		assert.deepEqual([...new Set(everyone.map(({ newsletterId }) => newsletterId))].sort(), [alpha, beta].sort());
		const betaCampaigns = (await api(jane.key, "GET", "/campaigns?newsletter=beta-letter")).body.campaigns;
		assert.deepEqual(betaCampaigns.map(({ subject }) => subject).sort(), ["Beta issue", "Beta second"]);
	});

	test("an address in two newsletters needs the newsletter named", async () => {
		const ambiguous = await api(jane.key, "GET", "/contacts/both%40example.org");
		assert.equal(ambiguous.status, 400);
		assert.equal(ambiguous.body.error.code, "validation_failed");
		assert.match(ambiguous.body.error.message, /several newsletters/);
		assert.equal((await api(jane.key, "GET", "/contacts/both%40example.org?newsletter=beta-letter")).body.newsletterId, beta);
		const unsubscribed = await api(jane.key, "PATCH", "/contacts/both%40example.org", { newsletter: "alpha", status: "unsubscribed" });
		assert.equal(unsubscribed.body.newsletterId, alpha);
		assert.equal((await m.Contact.findOne({ accountId: jane.accountId, newsletterId: beta, email: "both@example.org" }).lean()).status, "active");
	});

	test("each newsletter has its own shared address and archive, after its slug", async () => {
		const { sharedAddresses } = (await api(jane.key, "GET", "/domains")).body;
		assert.deepEqual(
			sharedAddresses.map(({ newsletterId, fromEmail, archiveHost }) => [newsletterId, fromEmail, archiveHost]),
			[
				[alpha, "hello@alpha.mailcheapmail.com", "alpha.mailcheapmail.com"],
				[beta, "hello@beta-letter.mailcheapmail.com", "beta-letter.mailcheapmail.com"],
			]
		);
	});
});
