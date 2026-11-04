import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getContactHistory } from "../lib/contact-history.js";
import { flagUrl, getCountryName, readCountry } from "../lib/countries.js";
import { getClickUrl } from "../lib/tracking.js";
import { activate, addAuthor, as, callApi, catchNotFound, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { runWithRequest } from "./stubs/next-headers.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const HOUR = 3_600_000;

describe("a contact's country", () => {
	test("comes from Vercel's header, as a two-letter code with a name", () => {
		const read = (value) => readCountry(new Headers(value === undefined ? {} : { "x-vercel-ip-country": value }));
		assert.equal(read("FR"), "FR");
		assert.equal(read(" de "), "DE");
		for (const value of ["XX", "ZZ", "T1", "FRA", "", "<b>"]) assert.equal(read(value), null, value);
		assert.equal(read(), null, "elsewhere than on Vercel, nothing");
		assert.equal(readCountry(null), null);
		assert.equal(getCountryName("JP"), "Japan");
		assert.equal(getCountryName("jp"), null);
		assert.equal(flagUrl("FR"), "https://flagcdn.com/fr.svg");
	});
});

describe("a contact's history", () => {
	const added = new Date("2026-03-01T10:00:00Z");
	const later = (minutes) => new Date(added.getTime() + minutes * 60_000);
	const types = (contact) => getContactHistory({ createdAt: added, subscribedAt: added, ...contact }).map(({ type }) => type);

	test("tells how they came in, confirmed, changed status and left, newest first", () => {
		assert.deepEqual(types({}), ["added"]);
		assert.deepEqual(types({ confirmedAt: later(3) }), ["confirmed", "added"]);
		assert.deepEqual(types({ unsubscribedAt: later(600) }), ["unsubscribed", "added"], "unsubscribed on their own");
		assert.deepEqual(types({ subscribedAt: later(60 * 24 * 30) }), ["signed-up-again", "added"], "back through a form");
		const stopped = getContactHistory({ createdAt: added, undeliverableAt: later(10), undeliverableReason: "no-mail-server" });
		assert.deepEqual(stopped[0], { type: "stopped", at: later(10), reason: "no-mail-server" });
	});

	test("a recorded change isn't told twice by the dates it moved", () => {
		const madeActive = getContactHistory({
			createdAt: added,
			confirmedAt: later(5),
			statusChanges: [{ from: "pending", to: "active", at: later(5), via: "dashboard", consent: true }],
		});
		assert.deepEqual(madeActive.map(({ type }) => type), ["status", "added"]);
		assert.deepEqual(madeActive[0], { type: "status", at: later(5), from: "pending", to: "active", via: "dashboard", consent: true, source: null, reason: null });
		const unsubscribed = { unsubscribedAt: later(600), statusChanges: [{ from: "active", to: "unsubscribed", at: later(600), via: "link" }] };
		assert.deepEqual(types(unsubscribed), ["status", "added"]);
		assert.deepEqual(types({ subscribedAt: new Date("2024-01-01"), unsubscribedAt: later(0) }), ["added"], "imported as unsubscribed");
	});

	test("every recorded change shows in order, and one only a later change reveals shows dated before it", () => {
		const roundTrip = getContactHistory({
			createdAt: added,
			subscribedAt: later(9000),
			statusChanges: [
				{ from: "active", to: "unsubscribed", at: later(600), via: "link" },
				{ from: "unsubscribed", to: "active", at: later(9000), via: "dashboard", consent: true },
			],
		});
		assert.deepEqual(roundTrip.map(({ to, via }) => [to, via]), [["active", "dashboard"], ["unsubscribed", "link"], [undefined, undefined]]);
		assert.ok(roundTrip.every(({ before }) => !before), "nothing missing");

		const revealed = getContactHistory({
			createdAt: added,
			source: "dashboard",
			subscribedAt: later(9000),
			statusChanges: [{ from: "unsubscribed", to: "active", at: later(9000), via: "dashboard", consent: true }],
		});
		assert.deepEqual(revealed.map(({ type, to }) => [type, to ?? null]), [["status", "active"], ["status", "unsubscribed"], ["added", null]]);
		assert.deepEqual([revealed[1].via, revealed[1].before], [null, later(9000)], "an unsubscribe nobody recorded, before the resubscribe");
		assert.ok(revealed[1].at < later(9000) && revealed[1].at > added);

		const kept = getContactHistory({
			createdAt: added,
			statusChanges: [{ from: "dormant", to: "active", at: later(60), via: "keep" }],
		});
		assert.deepEqual(kept.map(({ to }) => to), ["active", "dormant", undefined], "went dormant before answering the last-chance email");

		const imported = getContactHistory({
			createdAt: added,
			source: "import",
			statusChanges: [{ from: "unsubscribed", to: "active", at: later(60), via: "dashboard", consent: true }],
		});
		assert.equal(imported.length, 2, "an import can bring a contact in unsubscribed");
		const legacy = getContactHistory({
			createdAt: added,
			unsubscribedAt: later(600),
			statusChanges: [{ from: "unsubscribed", to: "bounced", at: later(700), via: "bounce" }],
		});
		assert.deepEqual(legacy.map(({ type }) => type), ["status", "unsubscribed", "added"], "a kept date explains it");
	});
});

describe("the contact page and its data", () => {
	let app;
	let m;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			archive: await import("../app/archive/actions.js"),
			confirm: await import("../app/confirm/actions.js"),
			clickRoute: await import("../app/c/[token]/route.js"),
			embed: await import("../app/api/embed/[id]/route.js"),
			contactPage: await import("../app/(app)/contacts/[id]/page.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			keep: await import("../app/keep/actions.js"),
			unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
			confirmation: await import("../lib/confirmation.js"),
			events: await import("../lib/email-events.js"),
			formTokens: await import("../lib/signup-form-token.js"),
			globalSuppressions: await import("../lib/global-suppressions.js"),
			lastChance: await import("../lib/last-chance.js"),
			linkStats: await import("../lib/link-stats.js"),
			unsubscribeTokens: await import("../lib/unsubscribe.js"),
			TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
			Campaign: (await import("../models/Campaign.js")).default,
			CampaignLink: (await import("../models/CampaignLink.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
			Segment: (await import("../models/Segment.js")).default,
		};
	});

	after(() => app?.stop());

	async function customer(email, fields = {}) {
		const user = await signIn(email);
		await activate(user);
		user.slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on", ...fields })))
		);
		user.newsletterId = url.split("/").at(-1);
		await addAuthor(user);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Full", level: "full" })))).key;
		return user;
	}

	const findContact = (user, email) => m.Contact.findOne({ accountId: user.accountId, newsletterId: user.newsletterId, email }).lean();

	function visit(country, run) {
		return runWithRequest({ headers: { "x-forwarded-for": `198.18.1.${Math.floor(Math.random() * 250)}`, "x-vercel-ip-country": country } }, run);
	}

	async function click(message, { country, userAgent = BROWSER }) {
		const token = getClickUrl("http://localhost:3000", message._id, "https://example.com/story").split("/").at(-1);
		const request = new Request(`http://localhost:3000/c/${token}`, { headers: { "user-agent": userAgent, "x-vercel-ip-country": country } });
		const response = await m.clickRoute.GET(request, { params: Promise.resolve({ token }) });
		await flushAfter();
		return response;
	}

	async function renderPage(user, id, searchParams = {}) {
		const element = await as(user, () => m.contactPage.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) }));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
	}

	// A sent issue with its email to the contact: opened, and clicked on links when given.
	async function sendIssue(user, contact, { subject, sentAt, links = [] }) {
		const campaign = await m.Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject, status: "sent", sentAt, startedAt: sentAt });
		const keys = links.map((url) => m.linkStats.getLinkKey(m.linkStats.normalizeLink(url)));
		await m.Message.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId: campaign._id,
			contactId: contact._id,
			kind: "campaign",
			email: contact.email,
			status: "delivered",
			sentAt,
			deliveredAt: sentAt,
			openedAt: new Date(sentAt.getTime() + HOUR),
			...(links.length > 0 && { clickedAt: new Date(sentAt.getTime() + 2 * HOUR), clickedLinks: keys }),
		});
		for (const [index, url] of links.entries()) {
			await m.CampaignLink.create({ accountId: user.accountId, campaignId: campaign._id, key: keys[index], url: m.linkStats.normalizeLink(url), clicks: 1, clickers: 1 });
		}
		return campaign;
	}

	test("signups from the website and from the form on another site keep the visitor's country for a new contact", async () => {
		const user = await customer("country-signup@example.com");
		assert.equal((await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { enabled: true }))).ok, true);

		assert.deepEqual(await visit("FR", () => m.archive.subscribe(null, form({ newsletter: user.slug, email: "reader@example.org" }))), { ok: true });
		assert.equal((await findContact(user, "reader@example.org")).country, "FR");
		await visit("DE", () => m.archive.subscribe(null, form({ newsletter: user.slug, email: "reader@example.org" })));
		assert.equal((await findContact(user, "reader@example.org")).country, "FR", "signing up again from elsewhere keeps it");

		await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "older@example.org", status: "active" });
		await visit("DE", () => m.archive.subscribe(null, form({ newsletter: user.slug, email: "older@example.org" })));
		assert.equal((await findContact(user, "older@example.org")).country, undefined, "anyone can type an address that's on the list");

		const token = m.formTokens.createFormToken({ newsletterId: user.newsletterId, origin: "https://site.example" }, Date.now() - 5000);
		const request = new Request(`http://localhost:3000/api/embed/${user.newsletterId}`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": "198.18.2.1", "x-vercel-ip-country": "JP" },
			body: JSON.stringify({ email: "framed@example.org", token }),
		});
		assert.equal((await m.embed.POST(request, { params: Promise.resolve({ id: user.newsletterId }) })).status, 200);
		assert.equal((await findContact(user, "framed@example.org")).country, "JP");

		const byApi = await callApi("POST", "/api/v1/contacts", { key: user.key, body: { email: "api@example.org" }, headers: { "x-vercel-ip-country": "US" } });
		assert.equal(byApi.status, 201);
		assert.equal((await findContact(user, "api@example.org")).country, undefined, "an API call comes from a server, not the person");
		assert.equal((await callApi("GET", "/api/v1/contacts/reader@example.org", { key: user.key })).body.country, "FR");
	});

	test("the confirmation sets the country, and a reader's click fills in a missing one; link scanners don't", async () => {
		const user = await customer("country-clicks@example.com", { requireConfirmation: "on" });
		await visit("US", () => m.archive.subscribe(null, form({ newsletter: user.slug, email: "pending@example.org" })));
		const pending = await findContact(user, "pending@example.org");
		assert.deepEqual([pending.status, pending.country], ["pending", "US"]);
		const confirmToken = m.confirmation.createConfirmToken({ contactId: pending._id, newsletterId: user.newsletterId });
		assert.deepEqual(await visit("BR", () => m.confirm.confirmSubscription(confirmToken)), { ok: true });
		assert.equal((await findContact(user, "pending@example.org")).country, "BR", "only the address's owner confirms");
		assert.deepEqual(await visit("PT", () => m.confirm.confirmSubscription(confirmToken)), { ok: true });
		assert.equal((await findContact(user, "pending@example.org")).country, "BR", "confirming again changes nothing");

		const reader = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "clicker@example.org", status: "active" });
		const campaign = await m.Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject: "Issue", status: "sent" });
		const message = await m.Message.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId: campaign._id,
			contactId: reader._id,
			kind: "campaign",
			email: reader.email,
			status: "delivered",
			sentAt: new Date(Date.now() - HOUR),
		});
		await click(message, { country: "US", userAgent: "Mozilla/5.0 (compatible; Barracuda Sentinel)" });
		assert.equal((await findContact(user, "clicker@example.org")).country, undefined, "a scanner's click says nothing of the reader");
		assert.equal((await click(message, { country: "CA" })).status, 302);
		assert.equal((await findContact(user, "clicker@example.org")).country, "CA");
		await click(message, { country: "GB" });
		assert.equal((await findContact(user, "clicker@example.org")).country, "CA", "the first one stays");
	});

	test("list_contact_emails lists a contact's emails newest first with their issue and clicked links, page by page, in its account only", async () => {
		const user = await customer("contact-emails@example.com");
		const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "jo@example.org", firstName: "Jo", status: "active" });
		const first = await sendIssue(user, contact, { subject: "First issue", sentAt: new Date(Date.now() - 72 * HOUR) });
		const second = await sendIssue(user, contact, {
			subject: "Hi {{first_name|there}}",
			sentAt: new Date(Date.now() - 24 * HOUR),
			links: ["https://example.com/story?utm_source=mailcheap", "https://example.net/shop"],
		});
		await m.Message.create({ accountId: user.accountId, newsletterId: user.newsletterId, kind: "test", campaignId: second._id, email: contact.email });

		const page = await callApi("GET", `/api/v1/contacts/${contact._id}/emails?limit=1`, { key: user.key });
		assert.equal(page.status, 200, JSON.stringify(page.body));
		assert.equal(page.body.emails.length, 1);
		const [latest] = page.body.emails;
		assert.deepEqual(latest.campaign, { id: String(second._id), subject: "Hi {{first_name|there}}" });
		assert.deepEqual([latest.kind, latest.status], ["campaign", "delivered"]);
		assert.deepEqual(latest.clickedLinks.toSorted(), ["https://example.com/story", "https://example.net/shop"]);
		assert.ok(latest.openedAt && latest.clickedAt && latest.sentAt);
		assert.ok(page.body.nextCursor);

		const next = await callApi("GET", `/api/v1/contacts/jo@example.org/emails?cursor=${page.body.nextCursor}`, { key: user.key });
		assert.deepEqual(next.body.emails.map(({ campaign }) => campaign.id), [String(first._id)], "test emails never count as the contact's");
		assert.equal(next.body.nextCursor, null);
		assert.equal((await callApi("GET", `/api/v1/contacts/${contact._id}/emails?cursor=nope`, { key: user.key })).body.error.code, "validation_failed");

		const other = await customer("contact-emails-other@example.com");
		const foreign = await callApi("GET", `/api/v1/contacts/${contact._id}/emails`, { key: other.key });
		assert.equal(foreign.status, 404, "another account's contact isn't found");
	});

	test("the page shows who they are, their emails, history and segments, to its account only", async () => {
		const user = await customer("contact-page@example.com");
		assert.equal((await callApi("POST", "/api/v1/contacts/fields", { key: user.key, body: { label: "Plan", type: "text" } })).status, 201);
		const contact = await m.Contact.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: "jane@example.org",
			firstName: "Jane",
			status: "active",
			source: "website",
			country: "FR",
			tags: ["vip"],
			fields: { plan: "Pro" },
			subscribedAt: new Date(Date.now() - 30 * 24 * HOUR),
			createdAt: new Date(Date.now() - 30 * 24 * HOUR),
			lastOpenAt: new Date(Date.now() - 23 * HOUR),
		});
		await sendIssue(user, contact, {
			subject: "Hello {{first_name|there}}, on {{plan|free}}",
			sentAt: new Date(Date.now() - 24 * HOUR),
			links: ["https://example.com/story"],
		});
		await m.Segment.create([
			{ accountId: user.accountId, newsletterId: user.newsletterId, name: "VIP readers", match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] },
			{ accountId: user.accountId, newsletterId: user.newsletterId, name: "Never opened", match: "all", conditions: [{ field: "opened", op: "never" }] },
		]);

		const html = await renderPage(user, String(contact._id));
		assert.ok(html.includes(">Jane</h1>"), "their first name heads the page");
		assert.ok(html.includes("France") && html.includes("https://flagcdn.com/fr.svg"), "their country, with its flag");
		assert.ok(html.includes("animate-globe-pulse"), "on the globe");
		const header = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)[1];
		assert.match(header, /<span class="sr-only">Status: <\/span>.*?Active/, "their status, a button at the top");
		assert.ok(header.includes('aria-label="More"'), "a ⋯ menu next to it");
		assert.doesNotMatch(header, /Edit fields|Edit tags|Delete contact/, "editing and deleting are in it, not buttons of their own");
		const tabs = [...html.matchAll(/<button([^>]*role="tab"[^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => [
			inner.replace(/<[^>]+>/g, ""),
			attributes.includes('aria-selected="true"'),
		]);
		assert.deepEqual(tabs, [["Activity", true], ["About", false], ["Fields and tags", false]], "the rest in three tabs, Activity open");
		assert.ok(html.includes("aria-label=\"Copy {{first_name}}\"") && html.includes("aria-label=\"Copy {{plan}}\""), "each field with its tag");
		assert.ok(html.includes("Email provider"), "what their inbox is, named");
		assert.ok(html.includes("Hello Jane, on Pro"), "the subject as they got it, with their first name and fields");
		assert.ok(html.includes(`href="/campaigns/`), "each issue links to its report");
		assert.ok(html.includes("example.com/story") && html.includes("google.com/s2/favicons?domain=example.com"), "the link they clicked, with its favicon");
		assert.ok(html.includes("Signed up on your website"));
		assert.ok(html.includes("VIP readers") && !html.includes("Never opened"), "only the segments they're in");
		assert.ok(html.includes(`href="/contacts?tag=vip"`));
		assert.ok(html.includes(`href="/help/contacts#tags"`), "under their tags, how tags work");
		assert.ok(html.includes(">100%<"), "opened their one email");

		const other = await customer("contact-page-other@example.com");
		assert.equal(await catchNotFound(renderPage(other, String(contact._id))), true, "another account gets a 404");
		assert.equal(await catchNotFound(renderPage(user, "not-an-id")), true);
	});

	test("Edit fields and Edit tags each save only what they edit", async () => {
		const user = await customer("contact-dialogs@example.com");
		assert.equal((await callApi("POST", "/api/v1/contacts/fields", { key: user.key, body: { label: "Plan", type: "text" } })).status, 201);
		const contact = await m.Contact.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: "dialogs@example.org",
			firstName: "Jane",
			tags: ["vip"],
			fields: { plan: "Pro" },
		});
		const id = String(contact._id);
		const read = async () => {
			const { firstName, fields, tags } = await findContact(user, "dialogs@example.org");
			return { firstName, fields, tags };
		};

		assert.ok((await as(user, () => m.contacts.updateContactDetails(id, { firstName: "Jo", fields: { plan: "Team" } }))).contact);
		assert.deepEqual(await read(), { firstName: "Jo", fields: { plan: "Team" }, tags: ["vip"] }, "Edit fields leaves the tags");

		assert.ok((await as(user, () => m.contacts.updateContactDetails(id, { tags: ["vip", "beta"] }))).contact);
		assert.deepEqual(await read(), { firstName: "Jo", fields: { plan: "Team" }, tags: ["vip", "beta"] }, "Edit tags leaves the rest");

		assert.ok((await as(user, () => m.contacts.updateContactDetails(id, { tags: [] }))).contact);
		assert.equal((await read()).tags, undefined, "and can take them all off");
	});

	test("the timeline shows the latest emails first, and older ones with what came before them on request", async () => {
		const user = await customer("contact-page-more@example.com");
		const contact = await m.Contact.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: "many@example.org",
			status: "active",
			source: "website",
			createdAt: new Date(Date.now() - 400 * HOUR),
		});
		for (let index = 0; index < 32; index++) {
			await sendIssue(user, contact, { subject: `Issue ${index}`, sentAt: new Date(Date.now() - (300 - index) * HOUR) });
		}
		const first = await renderPage(user, String(contact._id));
		assert.ok(first.includes("Issue 31") && first.includes("Issue 2") && !first.includes("Issue 1<"), "the latest 30");
		assert.ok(first.includes(`href="/contacts/${contact._id}?emails=60"`), "a link to older ones");
		assert.ok(!first.includes("Signed up on your website"), "nothing older than the oldest email shown");

		const all = await renderPage(user, String(contact._id), { emails: "60" });
		assert.ok(all.includes("Issue 0<") && all.includes("Signed up on your website"));
		assert.ok(!all.includes("?emails=90"));
	});

	// The unsubscribe link's page posts its form; a mail app's button posts One-Click (RFC 8058).
	function unsubscribeFrom(user, contact, { isPage }) {
		const token = m.unsubscribeTokens.createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
		const body = new FormData();
		body.set(isPage ? "source" : "List-Unsubscribe", isPage ? "page" : "One-Click");
		return m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", body }));
	}

	function emailTo(user, contact) {
		return m.Message.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			contactId: contact._id,
			kind: "campaign",
			email: contact.email,
			status: "delivered",
			sentAt: new Date(Date.now() - HOUR),
		});
	}

	function providerEvent(user, message, fields) {
		return m.events.handleEmailEvent({ accountId: String(user.accountId), messageId: String(message._id), email: message.email, emails: [message.email], ...fields });
	}

	test("a contact who leaves and comes back, every way, keeps each step in order, and its page shows them all", async () => {
		const user = await customer("history-steps@example.com");
		const signUp = () => visit("FR", () => m.archive.subscribe(null, form({ newsletter: user.slug, email: "steps@example.org" })));
		await signUp();
		const contact = await findContact(user, "steps@example.org");
		const id = String(contact._id);

		await unsubscribeFrom(user, contact, { isPage: true });
		await signUp();
		await unsubscribeFrom(user, contact, { isPage: false });
		assert.deepEqual(await as(user, () => m.contacts.setContactStatus(id, "active", true)), { ok: true });
		assert.deepEqual(await as(user, () => m.contacts.setContactStatus(id, "dormant")), { ok: true });
		const keepToken = m.lastChance.createKeepToken({ contactId: contact._id, newsletterId: user.newsletterId });
		assert.deepEqual(await visit("FR", () => m.keep.keepSending(keepToken)), { ok: true });
		await providerEvent(user, await emailTo(user, contact), { type: "unsubscribe" });

		const { statusChanges } = await findContact(user, "steps@example.org");
		assert.deepEqual(
			statusChanges.map(({ from, to, via }) => [from, to, via]),
			[
				["active", "unsubscribed", "link"],
				["unsubscribed", "active", "signup"],
				["active", "unsubscribed", "mail-app"],
				["unsubscribed", "active", "dashboard"],
				["active", "dormant", "dashboard"],
				["dormant", "active", "keep"],
				["active", "unsubscribed", "provider"],
			]
		);
		assert.equal(statusChanges[1].source, "website");
		assert.equal(statusChanges[3].consent, true);

		const html = await renderPage(user, id);
		for (const text of [
			"With the link in your email",
			"Signed up again on your website",
			"unsubscribe button",
			"Resubscribed by you",
			"Marked dormant by you",
			"Asked to keep getting your emails",
			"Through their email provider",
		]) {
			assert.ok(html.includes(text), text);
		}
		assert.ok(!html.includes("Before "), "nothing is missing");

		const api = await callApi("GET", `/api/v1/contacts/${id}`, { key: user.key });
		assert.deepEqual(api.body.statusChanges.map(({ via }) => via), ["link", "signup", "mail-app", "dashboard", "dashboard", "keep", "provider"]);
		assert.equal(api.body.statusChanges[3].consent, true);
	});

	test("bounces, complaints, imports, the list cleanup and the never-email list keep their changes too", async () => {
		const user = await customer("history-causes@example.com", { fromEmail: "hello@history-causes.mailcheapmail.com" });
		const make = (email, fields = {}) =>
			m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "active", source: "website", ...fields });
		const [bounced, complained, imported, skipped] = await Promise.all(
			["bounced@example.org", "complained@example.org", "imported@example.org", "skipped@example.org"].map((email) => make(email))
		);
		await providerEvent(user, await emailTo(user, bounced), { type: "bounce", bounce: "hard", reason: "550 5.1.1 user unknown" });
		await providerEvent(user, await emailTo(user, complained), { type: "complaint" });
		const result = await as(user, () =>
			m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: [{ email: "imported@example.org", status: "unsubscribed" }] })
		);
		assert.ok(result.importId, JSON.stringify(result));
		await m.globalSuppressions.markUndeliverable(user.accountId, skipped._id);
		await m.globalSuppressions.suppressGlobally({ emails: ["skipped@example.org"], reason: "bounce" });
		assert.deepEqual(await m.globalSuppressions.removeGlobalSuppression("skipped@example.org"), { restored: 1 });

		const changes = async (contact) =>
			(await m.Contact.findOne({ accountId: user.accountId, _id: contact._id }).lean()).statusChanges.map(({ from, to, via }) => [from, to, via]);
		assert.deepEqual(await changes(bounced), [["active", "bounced", "bounce"]]);
		assert.deepEqual(await changes(complained), [["active", "complained", "complaint"]]);
		assert.deepEqual(await changes(imported), [["active", "unsubscribed", "import"]]);
		assert.deepEqual(await changes(skipped), [
			["active", "bounced", "undeliverable"],
			["bounced", "active", "admin"],
		]);

		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { cleanup: { enabled: true } } });
		const quiet = await make("quiet@example.org", {
			subscribedAt: new Date(Date.now() - 100 * 24 * HOUR),
			lastChanceAt: new Date(Date.now() - 20 * 24 * HOUR),
			ignoredIssues: 6,
		});
		const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		const campaignId = url.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(campaignId, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(campaignId, {})), { ok: true });
		assert.deepEqual(await changes(quiet), [["active", "dormant", "cleanup"]], "no answer to the last-chance email");

		const html = await renderPage(user, String(bounced._id));
		assert.ok(html.includes("Stopped: their address bounced"));
		assert.ok((await renderPage(user, String(quiet._id))).includes("No answer to the last-chance email"));
	});
});
