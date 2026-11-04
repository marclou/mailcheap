import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getSendProblems } from "../lib/campaign-steps.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { PUBLISH_TARGETS, isOnWebsite, readPublishTo } from "../lib/publish-to.js";
import { getIssueWebUrl } from "../lib/sending-rules.js";
import { activate, addAuthor, as, callApi, catchNotFound, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// Each issue goes by email and on the newsletter's website (the default), by email only, or on the website only. An
// email-only issue never shows on the website and its emails have no Read online link; a web-only one goes on the
// website without an email, so it has no recipients and uses no plan emails.
const SHARED_DOMAIN = "mailcheapmail.com";
let app;
let m;

describe("where an issue goes", () => {
	test("campaigns from before the choice go both ways", () => {
		assert.deepEqual(PUBLISH_TARGETS, ["both", "email", "web"]);
		assert.equal(readPublishTo({}), "both");
		assert.equal(readPublishTo({ publishTo: "made-up" }), "both");
		assert.equal(readPublishTo({ publishTo: "web" }), "web");
	});

	test("only an issue that went out, and not by email only, is on the website", () => {
		assert.equal(isOnWebsite({ status: "sent" }), true);
		assert.equal(isOnWebsite({ status: "sending", publishTo: "web" }), true);
		assert.equal(isOnWebsite({ status: "sent", publishTo: "email" }), false);
		assert.equal(isOnWebsite({ status: "draft", publishTo: "web" }), false);
		assert.equal(isOnWebsite({ status: "paused", pauseCode: "content_review" }), false, "held by the content check, it went nowhere");
		assert.equal(isOnWebsite({ status: "paused", pauseCode: "content_rejected", publishTo: "web" }), false);
		assert.equal(isOnWebsite({ status: "paused", pauseCode: "high_rates" }), true, "a send paused halfway went out");
	});

	test("an email-only issue's emails have no Read online link", () => {
		const newsletter = { archiveEnabled: true, slug: "notes" };
		const campaign = { _id: "000000000000000000000001", subject: "Hello", archiveSlug: "hello" };
		assert.match(getIssueWebUrl({ campaign, newsletter }), /\/p\/hello$/);
		assert.match(getIssueWebUrl({ campaign: { ...campaign, publishTo: "web" }, newsletter }), /\/p\/hello$/);
		assert.equal(getIssueWebUrl({ campaign: { ...campaign, publishTo: "email" }, newsletter }), null);
	});

	test("a web-only issue's checks are about its page, and it needs no contacts or plan emails", () => {
		const campaign = { subject: "Hello", previewText: "", body: "<p>Hi</p>", authorId: "000000000000000000000001", publishTo: "web" };
		const rendered = { html: "<p>Hi</p>", bytes: 200_000 };
		const web = getPresendChecks({
			campaign,
			newsletter: { archiveEnabled: false },
			rendered,
			senderProblem: "Verify your domain",
			isSendingEnabled: false,
			planProblem: "This month's emails are used up",
		});
		assert.deepEqual(web.blocking.map(({ id }) => id), ["website"], "only the website being off stops it");
		assert.ok(!web.checks.some(({ id }) => ["unsubscribe", "size", "domain", "address", "plan", "sending"].includes(id)));
		const email = getPresendChecks({ campaign: { ...campaign, publishTo: "email" }, newsletter: { archiveEnabled: false }, rendered, isSendingEnabled: true });
		assert.ok(email.blocking.some(({ id }) => id === "unsubscribe"), "email only keeps every email check");
		assert.ok(!email.checks.some(({ id }) => id === "website"));

		const problems = { hasPlan: true, choice: "now", blocking: [], sendEmails: 0, scheduleRecipients: 0, emailsLeft: 0 };
		assert.deepEqual(getSendProblems({ ...problems, isWebOnly: true }), []);
		assert.deepEqual(getSendProblems(problems).map(({ id }) => id), ["recipients"]);
		assert.deepEqual(getSendProblems({ ...problems, choice: "later", scheduleProblem: "Pick a time", isWebOnly: true }).map(({ id }) => id), ["time"]);
	});
});

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	const response = await callApi("POST", "/api/v1/newsletters", {
		key: user.key,
		body: { name: `${email.split("@")[0]} news`, postalAddress: "1 Main St, Paris" },
	});
	assert.equal(response.status, 201, JSON.stringify(response.body));
	user.newsletter = response.body;
	await addAuthor(user, user.newsletter.id);
	const rows = [0, 1, 2].map((index) => ({ email: `reader${index}@${user.newsletter.slug}.example.org`, status: "active" }));
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletter.id, consent: true, rows }));
	return user;
}

async function draft(user, { subject = "Issue", publishTo } = {}) {
	const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletter.id)))).split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello readers</p>" }));
	if (publishTo) assert.deepEqual(await as(user, () => m.campaigns.setCampaignPublishTo(id, publishTo)), { ok: true });
	return id;
}

const load = (user, id) => m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
const countMessages = (user, id) => m.Message.countDocuments({ accountId: user.accountId, campaignId: id });
const emailsSent = async (user) => (await m.Account.findById(user.accountId).lean()).usage?.emailsSent ?? 0;

// What a visitor gets: whether the issue's page renders, and whether the home page and sitemap list it.
async function visit(user, archiveSlug) {
	const { slug } = user.newsletter;
	const params = (more = {}) => ({ params: Promise.resolve({ slug, ...more }) });
	const sitemap = await m.sitemapRoute.GET(new Request(`https://${slug}.${SHARED_DOMAIN}/sitemap.xml`), params());
	return {
		page: !(await catchNotFound(m.issuePage(params({ post: archiveSlug })))),
		inSitemap: sitemap.status === 200 && (await sitemap.text()).includes(`/p/${archiveSlug}<`),
	};
}

before(async () => {
	app = await startTestApp();
	m = {
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		homePage: (await import("../app/archive/[slug]/page.js")).default,
		issuePage: (await import("../app/archive/[slug]/p/[post]/page.js")).default,
		sitemapRoute: await import("../app/archive/[slug]/sitemap/route.js"),
		slugRoute: await import("../app/p/[slug]/route.js"),
		scheduling: await import("../lib/scheduling.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("web only", () => {
	test("publishes on the website at once: no email, no recipients, no plan emails", async () => {
		const user = await customer("publish-web@example.com");
		const id = await draft(user, { subject: "Web notes", publishTo: "web" });
		const before = await emailsSent(user);

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const campaign = await load(user, id);
		assert.equal(campaign.status, "sent");
		assert.equal(campaign.publishTo, "web");
		assert.ok(campaign.startedAt && campaign.sentAt);
		assert.equal(campaign.archiveSlug, "web-notes");
		assert.equal(await countMessages(user, id), 0, "no email was made");
		assert.equal(campaign.stats.recipients, 0);
		assert.equal(await emailsSent(user), before, "the plan's emails are untouched");
		assert.deepEqual(await visit(user, "web-notes"), { page: true, inSitemap: true });

		const viaApi = await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key });
		assert.equal(viaApi.body.publishTo, "web");
		assert.match(viaApi.body.archiveUrl, /\/p\/web-notes$/);
		const more = await callApi("POST", `/api/v1/campaigns/${id}/send-more`, { key: user.key, body: {} });
		assert.equal(more.status, 409, "a web-only issue has no contacts to send to more");
		assert.match(JSON.stringify(more.body), /doesn't go out by email/);
	});

	test("goes live by itself when scheduled", async () => {
		const user = await customer("publish-web-later@example.com");
		const id = await draft(user, { subject: "Later", publishTo: "web" });
		const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: scheduledAt.toISOString() })), { ok: true });
		assert.equal((await load(user, id)).status, "scheduled");
		assert.deepEqual(await visit(user, "later"), { page: false, inSitemap: false }, "a scheduled issue isn't live yet");

		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
		const { scheduledAt: due } = await load(user, id);
		const result = await m.scheduling.runScheduledSend({ accountId: String(user.accountId), campaignId: id, scheduledAt: due.toISOString() });
		assert.equal(result.started, true, JSON.stringify(result));
		assert.equal((await load(user, id)).status, "sent");
		assert.equal(await countMessages(user, id), 0);
		assert.deepEqual(await visit(user, "later"), { page: true, inSitemap: true });
	});

	test("needs the website on", async () => {
		const user = await customer("publish-web-off@example.com");
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletter.id }, { $set: { archiveEnabled: false } });
		const id = await draft(user, { publishTo: "web" });
		const result = await as(user, () => m.campaigns.sendCampaign(id, {}));
		assert.match(result.error, /Turn on the newsletter's website/);
		assert.equal((await load(user, id)).status, "draft");
	});
});

describe("email only", () => {
	test("goes out by email but never on the website, by its page, its sitemap or the app's /p/ links", async () => {
		const user = await customer("publish-email@example.com");
		const live = await draft(user, { subject: "On the web", publishTo: "web" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(live, {})), { ok: true });
		const id = await draft(user, { subject: "Inbox only", publishTo: "email" });
		await as(user, () => m.campaigns.updateArchiveSlug(id, "inbox-only"));

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const campaign = await load(user, id);
		assert.equal(campaign.status, "sending");
		assert.equal(await countMessages(user, id), 3, "every contact gets it");
		assert.deepEqual(await visit(user, "on-the-web"), { page: true, inSitemap: true }, "the website is live");
		assert.deepEqual(await visit(user, "inbox-only"), { page: false, inSitemap: false });
		const appLink = await m.slugRoute.GET(new Request("http://localhost:3000/p/inbox-only"), { params: Promise.resolve({ slug: "inbox-only" }) });
		assert.equal(appLink.status, 404);

		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletter.id }).lean();
		assert.equal(getIssueWebUrl({ campaign, newsletter }), null, "its emails have no Read online link");
		const viaApi = await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key });
		assert.equal(viaApi.body.publishTo, "email");
		assert.equal(viaApi.body.archiveUrl, null);
	});

	test("both stays the default, through the dashboard and the API", async () => {
		const user = await customer("publish-both@example.com");
		const id = await draft(user, { subject: "Everywhere" });
		assert.equal((await load(user, id)).publishTo, "both");
		const created = await callApi("POST", "/api/v1/campaigns", {
			key: user.key,
			body: { newsletter: user.newsletter.id, subject: "From the API", content: "Hello", publishTo: "web" },
		});
		assert.equal(created.status, 201, JSON.stringify(created.body));
		assert.equal(created.body.publishTo, "web");
		const changed = await callApi("PATCH", `/api/v1/campaigns/${created.body.id}`, { key: user.key, body: { publishTo: "email" } });
		assert.equal(changed.body.publishTo, "email");
		const refused = await callApi("PATCH", `/api/v1/campaigns/${created.body.id}`, { key: user.key, body: { publishTo: "everywhere" } });
		assert.equal(refused.status, 400);

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		const sent = await load(user, id);
		assert.equal(await countMessages(user, id), 3);
		assert.deepEqual(await visit(user, sent.archiveSlug), { page: true, inSitemap: true });
	});
});

// Remove from website: an issue that also went out by email becomes email only, and a web-only one, with nothing left,
// is deleted.
describe("removing an issue from the website", () => {
	const isWebsiteLive = async (user) => !(await catchNotFound(m.homePage({ params: Promise.resolve({ slug: user.newsletter.slug }) })));

	test("an issue that also went out by email stays, as email only, while its page goes offline", async () => {
		const user = await customer("unpublish-both@example.com");
		const kept = await draft(user, { subject: "Still online", publishTo: "web" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(kept, {})), { ok: true });
		const id = await draft(user, { subject: "Both ways" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.toggleArchivePin(id)), { ok: true });
		assert.deepEqual(await visit(user, "both-ways"), { page: true, inSitemap: true });

		assert.deepEqual(await as(user, () => m.campaigns.unpublishCampaign(id)), { ok: true, deleted: false });
		const campaign = await load(user, id);
		assert.equal(campaign.status, "sending", "its send goes on");
		assert.equal(campaign.publishTo, "email");
		assert.equal(campaign.archivePinned, false);
		assert.equal(campaign.archiveSlug, "both-ways", "its address stays taken, so no other issue shows up at its old links");
		assert.deepEqual(await visit(user, "both-ways"), { page: false, inSitemap: false });
		assert.deepEqual(await visit(user, "still-online"), { page: true, inSitemap: true }, "the website stays live with its other issues");
		const appLink = await m.slugRoute.GET(new Request("http://localhost:3000/p/both-ways"), { params: Promise.resolve({ slug: "both-ways" }) });
		assert.equal(appLink.status, 404);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletter.id }).lean();
		assert.equal(getIssueWebUrl({ campaign, newsletter }), null, "the rest of its emails have no Read online link");

		const viaApi = await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key });
		assert.equal(viaApi.status, 200, "it stays in the campaigns");
		assert.deepEqual([viaApi.body.publishTo, viaApi.body.archiveUrl, viaApi.body.archivePinned], ["email", null, false]);
		assert.match((await as(user, () => m.campaigns.unpublishCampaign(id))).error, /isn't on the website/);
	});

	test("a web-only issue leaves the campaigns, and with no issue left the website goes offline", async () => {
		const user = await customer("unpublish-web@example.com");
		const id = await draft(user, { subject: "Only online", publishTo: "web" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		assert.equal(await isWebsiteLive(user), true);

		const removed = await callApi("POST", `/api/v1/campaigns/${id}/unpublish`, { key: user.key });
		assert.equal(removed.status, 200, JSON.stringify(removed.body));
		assert.deepEqual(removed.body, { id, deleted: true });
		const campaign = await load(user, id);
		assert.equal(campaign.status, "canceled", "kept in the database");
		assert.ok(campaign.sentAt);
		assert.equal((await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key })).status, 404);
		const listed = await callApi("GET", "/api/v1/campaigns", { key: user.key });
		assert.ok(!listed.body.campaigns.some((item) => item.id === id), "it left the list");
		assert.deepEqual(await visit(user, "only-online"), { page: false, inSitemap: false });
		assert.equal(await isWebsiteLive(user), false, "as before its first issue, it answers as if it were off");
	});

	test("only an issue on the website, and only by its own account", async () => {
		const user = await customer("unpublish-checks@example.com");
		const stranger = await customer("unpublish-stranger@example.com");
		const notYet = await draft(user, { subject: "Not out yet", publishTo: "web" });
		assert.match((await as(user, () => m.campaigns.unpublishCampaign(notYet))).error, /isn't on the website/);
		const emailOnly = await draft(user, { subject: "Inbox note", publishTo: "email" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(emailOnly, {})), { ok: true });
		assert.match((await as(user, () => m.campaigns.unpublishCampaign(emailOnly))).error, /isn't on the website/);
		const held = await draft(user, { subject: "Held back", publishTo: "web" });
		await m.Campaign.updateOne({ accountId: user.accountId, _id: held }, { $set: { status: "paused", pauseCode: "content_review" } });
		assert.match((await as(user, () => m.campaigns.unpublishCampaign(held))).error, /isn't on the website/, "held by the content check, it never went out");

		const live = await draft(user, { subject: "Mine to remove", publishTo: "web" });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(live, {})), { ok: true });
		assert.equal((await callApi("POST", `/api/v1/campaigns/${live}/unpublish`, { key: stranger.key })).status, 404);
		assert.match((await as(stranger, () => m.campaigns.unpublishCampaign(live))).error, /not found/i);
		assert.equal((await load(user, live)).status, "sent");
		assert.deepEqual(await visit(user, "mine-to-remove"), { page: true, inSitemap: true });
	});
});
