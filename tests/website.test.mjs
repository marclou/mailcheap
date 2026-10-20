import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createConfirmToken } from "../lib/confirmation.js";
import { getNewsletterDraft } from "../lib/newsletter-form.js";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, anonymous, as, callApi, catchNotFound, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { revalidatedPaths } from "./stubs/next-cache.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// A newsletter's website, its archive at <slug>.<shared domain>, starts on for new newsletters, however they're created.
// Until the first issue goes out nothing of it is public: its host answers as for a website that's off, while signups
// and the confirm and unsubscribe links keep working there. The first send puts it online. Newsletters saved before
// keep their setting.
const SHARED_DOMAIN = "mailcheapmail.com";
const HIDDEN = { home: false, issue: false, sitemap: 404, robots: 404 };
const LIVE = { home: true, issue: true, sitemap: 200, robots: 200 };
let app;
let m;

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

async function createNewsletter(user, body) {
	const response = await callApi("POST", "/api/v1/newsletters", { key: user.key, body });
	assert.equal(response.status, 201, JSON.stringify(response.body));
	return response.body;
}

async function callTool(key, name, args) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result;
}

// What a visitor gets from the website: whether its home and an issue's page render, and what its files answer.
async function visitWebsite(slug, post) {
	const params = (more = {}) => ({ params: Promise.resolve({ slug, ...more }) });
	const get = (route, path) => route.GET(new Request(`http://localhost:3000/archive/${slug}/${path}`), params());
	return {
		home: !(await catchNotFound(m.archivePage(params()))),
		issue: !(await catchNotFound(m.issuePage(params({ post })))),
		sitemap: (await get(m.sitemapRoute, "sitemap")).status,
		robots: (await get(m.robotsRoute, "robots")).status,
	};
}

function visitHost(slug, path) {
	const url = `https://${slug}.${SHARED_DOMAIN}${path}`;
	return m.proxy(new m.NextRequest(url, { headers: { host: new URL(url).host } }));
}

async function renderSettings(user, page = m.settingsPage) {
	const element = await as(user, () => page.default());
	return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
}

// The confirm page's link to the website, shown once the reader is in. The page also holds the newsletter's theme.
async function confirmPageArchiveUrl(token) {
	const page = await anonymous(() => m.confirmPage({ searchParams: Promise.resolve({ token }) }));
	const form = [page.props.children].flat().find((child) => child?.props && "archiveUrl" in child.props);
	return form.props.archiveUrl;
}

function unsubscribe({ slug, id }, contact, body) {
	const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: id });
	return m.unsubscribeRoute.POST(new Request(`https://${slug}.${SHARED_DOMAIN}/api/unsubscribe?token=${token}`, { method: "POST", body }));
}

before(async () => {
	app = await startTestApp();
	m = {
		welcome: await import("../app/welcome/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		settingsPage: await import("../app/(app)/newsletters/website/page.js"),
		settingsOverview: await import("../app/(app)/newsletters/page.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../app/archive/actions.js"),
		archivePage: (await import("../app/archive/[slug]/page.js")).default,
		issuePage: (await import("../app/archive/[slug]/p/[post]/page.js")).default,
		sitemapRoute: await import("../app/archive/[slug]/sitemap/route.js"),
		robotsRoute: await import("../app/archive/[slug]/robots/route.js"),
		confirm: await import("../app/confirm/actions.js"),
		confirmPage: (await import("../app/confirm/page.js")).default,
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("new newsletters", () => {
	test("start with their website on, from onboarding, the dashboard, the REST API and MCP, unless they say false", async () => {
		const user = await signIn("website-new@example.com");
		assert.equal(await as(user, () => catchRedirect(m.welcome.completeOnboarding(null, form({ name: "Onboarded notes" })))), "/");
		assert.equal(await as(user, () => catchRedirect(m.newsletters.createNewsletter(null, form({ name: "Added notes" })))), "/newsletters");
		const stored = await m.Newsletter.find({ accountId: user.accountId }).sort({ createdAt: 1 }).lean();
		assert.deepEqual(stored.map(({ slug, archiveEnabled }) => [slug, archiveEnabled]), [["onboarded-notes", true], ["added-notes", true]]);
		const draft = getNewsletterDraft({ newsletter: null, domains: [], sharedDomain: SHARED_DOMAIN });
		assert.equal(draft.isArchiveEnabled, true, "the settings form starts a new one with its switch on");

		const agent = await customer("website-agent@example.com");
		const created = await createNewsletter(agent, { name: "API notes" });
		assert.deepEqual([created.archiveEnabled, created.archiveUrl], [true, `https://api-notes.${SHARED_DOMAIN}/`]);
		assert.equal((await callTool(agent.key, "create_newsletter", { name: "MCP notes" })).structuredContent.archiveEnabled, true);
		assert.equal((await createNewsletter(agent, { name: "Quiet notes", archiveEnabled: false })).archiveEnabled, false);
	});
});

describe("before the first issue", () => {
	test("nothing is public, as when the website is off, while signups, confirm and unsubscribe links keep working", async () => {
		const user = await customer("website-waiting@example.com");
		const waiting = await createNewsletter(user, { name: "Waiting notes" });
		const off = await createNewsletter(user, { name: "Off notes", archiveEnabled: false });
		assert.equal(waiting.archiveEnabled, true);
		assert.deepEqual(await visitWebsite(waiting.slug, "first-issue"), HIDDEN);
		assert.deepEqual(await visitWebsite(off.slug, "first-issue"), HIDDEN, "the same as a website that's off");
		for (const path of ["/unsubscribe?token=token", "/api/unsubscribe?token=token", "/confirm?token=token"]) {
			assert.equal((await visitHost(waiting.slug, path)).headers.get("x-middleware-next"), "1", path);
		}

		const signup = await anonymous(() => m.archive.subscribe(null, form({ newsletter: waiting.slug, email: "early@example.org" })));
		assert.deepEqual([signup.ok, signup.pending], [true, true], "the signup form's action takes signups, as it did");
		await flushAfter();
		const reader = await m.Contact.findOne({ accountId: user.accountId, email: "early@example.org" }).lean();
		const token = createConfirmToken({ contactId: reader._id, newsletterId: waiting.id });
		assert.equal(await confirmPageArchiveUrl(token), null, "the confirm page doesn't link to a website that isn't up");
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
		await flushAfter();

		const other = await m.Contact.create({ accountId: user.accountId, newsletterId: waiting.id, email: "footer@example.org", status: "active" });
		assert.equal((await unsubscribe(waiting, reader, new URLSearchParams({ "List-Unsubscribe": "One-Click" }))).status, 200);
		const page = await unsubscribe(waiting, other, form({ source: "page" }));
		assert.equal(new URL(page.headers.get("location")).searchParams.get("status"), "done", "the footer link's page");
		for (const { _id } of [reader, other]) {
			assert.equal((await m.Contact.findOne({ accountId: user.accountId, _id }).lean()).status, "unsubscribed");
		}
	});
});

describe("the first issue", () => {
	test("puts the website online as it goes out: the send refreshes its cached pages, and the settings link to it", async () => {
		const user = await customer("website-live@example.com");
		const newsletter = await createNewsletter(user, { name: "Live notes", postalAddress: "1 Main St, Paris" });
		const address = `https://live-notes.${SHARED_DOMAIN}`;
		const settings = await renderSettings(user);
		assert.match(settings, /Goes live after your first issue\./);
		assert.doesNotMatch(settings, new RegExp(`href="${address}"`), "the address isn't a link yet");
		assert.match(await renderSettings(user, m.settingsOverview), /Goes live after your first issue</, "the overview says so too");

		const rows = [{ email: "first-reader@example.org", status: "active" }];
		await as(user, () => m.contacts.importContacts({ newsletterId: newsletter.id, consent: true, rows }));
		const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletter.id)))).split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(id, { subject: "First issue", previewText: "Hello", body: "<p>Hello readers</p>" }));
		assert.deepEqual(await visitWebsite(newsletter.slug, "first-issue"), HIDDEN, "a draft isn't an issue");

		const revalidatedBefore = revalidatedPaths.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		assert.ok(
			revalidatedPaths.slice(revalidatedBefore).some(([path, type]) => path === "/archive/[slug]" && type === "layout"),
			"the archive's cached pages regenerate on their next visit"
		);
		const { status, archiveSlug } = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(status, "sending");
		assert.deepEqual(await visitWebsite(newsletter.slug, archiveSlug), LIVE);
		const sitemap = await m.sitemapRoute.GET(new Request(`${address}/sitemap.xml`), { params: Promise.resolve({ slug: newsletter.slug }) });
		assert.match(await sitemap.text(), new RegExp(`<loc>${address}/p/${archiveSlug}</loc>`));

		const live = await renderSettings(user);
		assert.doesNotMatch(live, /Goes live after your first issue/);
		assert.match(live, new RegExp(`href="${address}"`));
		assert.match(await renderSettings(user, m.settingsOverview), new RegExp(`Live · live-notes\\.${SHARED_DOMAIN.replaceAll(".", "\\.")}<`));
		const pending = await m.Contact.create({ accountId: user.accountId, newsletterId: newsletter.id, email: "later@example.org", status: "pending" });
		assert.equal(await confirmPageArchiveUrl(createConfirmToken({ contactId: pending._id, newsletterId: newsletter.id })), `${address}/`);
	});
});

describe("newsletters saved before", () => {
	test("keep their setting: saving them never turns their website on", async () => {
		const user = await customer("website-saved@example.com");
		const saved = (slug, fields) => ({ accountId: user.accountId, name: slug, slug, fromEmail: `hello@${slug}.${SHARED_DOMAIN}`, ...fields });
		const off = await m.Newsletter.create(saved("saved-off", { archiveEnabled: false }));
		const on = await m.Newsletter.create(saved("saved-on", { archiveEnabled: true }));
		const { insertedId: unset } = await m.Newsletter.collection.insertOne(saved("saved-unset"));

		const load = (_id) => m.Newsletter.findOne({ accountId: user.accountId, _id });
		assert.equal((await load(unset)).archiveEnabled, false, "one that never stored it reads as off");
		for (const [_id, isOn] of [[off._id, false], [on._id, true], [unset, false]]) {
			const updated = await callApi("PATCH", `/api/v1/newsletters/${_id}`, { key: user.key, body: { description: "Still here." } });
			assert.deepEqual([updated.status, updated.body.archiveEnabled], [200, isOn], String(_id));
			const stored = await load(_id).lean();
			assert.equal(Boolean(stored.archiveEnabled), isOn);
			assert.equal(getNewsletterDraft({ newsletter: stored, domains: [], sharedDomain: SHARED_DOMAIN }).isArchiveEnabled, isOn);
		}
	});
});
