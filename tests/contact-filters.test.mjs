import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	LIST_STATUSES,
	describeSignupDays,
	fromSignupDays,
	readContactFilters,
	toFilterQuery,
	toSignupDays,
} from "../lib/contact-filters.js";
import { readDateKey } from "../lib/time-zone.js";
import { CONTACT_STATUSES } from "../models/Contact.js";
import { activate, as, callApi, catchNotFound, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		rest: await import("../lib/api/rest.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		actions: await import("../app/(app)/contacts/actions.js"),
		exportRoute: await import("../app/api/v1/contacts/export.csv/route.js"),
		contactsPage: await import("../app/(app)/contacts/page.js"),
		segmentsPage: await import("../app/(app)/contacts/segments/page.js"),
		segmentPage: await import("../app/(app)/contacts/segments/[id]/page.js"),
		Contact: (await import("../models/Contact.js")).default,
		DeletedContact: (await import("../models/DeletedContact.js")).default,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
	};
});

after(() => app?.stop());

describe("the contacts lists' filters", () => {
	test("a signup date before a day, after one or between two, both included, reads back as it was picked", () => {
		assert.deepEqual(toSignupDays({ mode: "before", day: "2026-10-01" }), { signedUpSince: null, signedUpBefore: "2026-10-01" });
		assert.deepEqual(toSignupDays({ mode: "after", day: "2026-10-01" }), { signedUpSince: "2026-10-02", signedUpBefore: null }, "after a day leaves it out");
		assert.deepEqual(
			toSignupDays({ mode: "between", day: "2026-09-30", endDay: "2026-10-31" }),
			{ signedUpSince: "2026-09-30", signedUpBefore: "2026-11-01" },
			"between two days takes both"
		);
		const picks = [
			{ mode: "before", day: "2026-10-01", endDay: null },
			{ mode: "after", day: "2026-12-31", endDay: null },
			{ mode: "between", day: "2026-02-28", endDay: "2026-03-01" },
		];
		for (const picked of picks) assert.deepEqual(fromSignupDays(toSignupDays(picked)), picked, picked.mode);
		assert.equal(fromSignupDays({ signedUpSince: null, signedUpBefore: null }), null);

		assert.equal(describeSignupDays({ signedUpBefore: "2026-10-01" }), "Before Oct 1, 2026");
		assert.equal(describeSignupDays({ signedUpSince: "2026-10-02" }), "After Oct 1, 2026");
		assert.equal(describeSignupDays({ signedUpSince: "2026-10-01", signedUpBefore: "2026-10-16" }), "Oct 1 – Oct 15, 2026");
		assert.equal(describeSignupDays({ signedUpSince: "2025-12-20", signedUpBefore: "2026-01-06" }), "Dec 20, 2025 – Jan 5, 2026");
		assert.equal(describeSignupDays({ signedUpSince: "2026-10-01", signedUpBefore: "2026-10-02" }), "Oct 1, 2026", "a single day");
		assert.equal(describeSignupDays({ signedUpSince: "2026-10-01", signedUpBefore: "2026-10-02" }), "Oct 1, 2026", "a single day");
	});

	test("the address gives only filters that exist, and links keep them", () => {
		assert.deepEqual(
			readContactFilters(
				{ q: " Jane ", status: "bounced", tag: " VIP ", source: " api ", signedUpSince: "2026-10-01", signedUpBefore: "2026-02-30" },
				LIST_STATUSES
			),
			{ status: "bounced", query: "jane", tag: "vip", source: "api", signedUpSince: "2026-10-01", signedUpBefore: null }
		);
		assert.deepEqual(readContactFilters({ status: "nope", tag: ["a", "b"], source: " ", signedUpSince: "yesterday" }, LIST_STATUSES), {
			status: null,
			query: "",
			tag: null,
			source: null,
			signedUpSince: null,
			signedUpBefore: null,
		});
		assert.equal(readDateKey("2026-02-29"), null, "2026 has no February 29");
		assert.equal(readDateKey("2028-02-29"), "2028-02-29");
		assert.equal(toFilterQuery({ query: "a b", status: "active", tag: null, signedUpSince: "2026-10-01" }, { page: 2 }), "?q=a+b&status=active&signedUpSince=2026-10-01&page=2");
		assert.equal(toFilterQuery({ query: "" }, { page: false }), "");
	});

	test("the status filter offers every status", () => {
		assert.deepEqual([...LIST_STATUSES].sort(), [...CONTACT_STATUSES].sort());
	});
});

describe("filters and deleting many contacts through the API", () => {
	async function api(key, method, path, body) {
		const response = await callApi(method, `/api/v1${path}`, { key, body });
		if (response.status < 300) {
			const segments = new URL(path, "http://x").pathname.split("/").filter(Boolean).map(decodeURIComponent);
			const { action } = m.rest.matchRoute(method, segments);
			const checked = action.output.safeParse(response.body);
			assert.ok(checked.success, `${action.name} answered outside its schema: ${checked.error?.message}`);
		}
		return response;
	}

	function assertError(response, status, code) {
		assert.equal(response.status, status, JSON.stringify(response.body));
		assert.equal(response.body.error.code, code, response.body.error.message);
		return response.body.error.message;
	}

	async function customer(email) {
		const user = await signIn(email);
		await activate(user);
		user.slug = email.split("@")[0].replace(/[^a-z0-9]/g, "-");
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
		);
		user.newsletterId = url.split("/").at(-1);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Full", level: "full" })))).key;
		return user;
	}

	// Four contacts from different sources, signed up on either side of October 1, one of them bounced.
	function addContacts(user) {
		const ago = (days) => new Date(Date.now() - days * DAY_MS);
		const day = (key) => new Date(`${key}T12:00:00.000Z`);
		const contact = (fields) => ({ accountId: user.accountId, newsletterId: user.newsletterId, status: "active", ...fields });
		return m.Contact.insertMany([
			contact({ email: "form@example.org", source: "website", subscribedAt: day("2026-09-30"), lastOpenAt: ago(3), lastClickAt: ago(3) }),
			contact({ email: "imported@example.org", source: "import", subscribedAt: day("2026-10-01"), lastOpenAt: ago(60) }),
			contact({ email: "listener@example.org", source: "podcast", subscribedAt: day("2026-10-15") }),
			contact({ email: "bounced@example.org", source: "import", status: "bounced", subscribedAt: day("2026-10-16") }),
		]);
	}

	test("list_contacts filters by source and signup days, and the export and tags follow", async () => {
		const user = await customer("filters-api@example.com");
		await addContacts(user);
		const emails = async (query) => (await api(user.key, "GET", `/contacts?${query}`)).body.contacts.map(({ email }) => email).sort();

		assert.deepEqual(await emails("source=import"), ["bounced@example.org", "imported@example.org"]);
		assert.deepEqual(await emails("source=import&status=active"), ["imported@example.org"]);
		assert.deepEqual(await emails("signedUpSince=2026-10-01"), ["bounced@example.org", "imported@example.org", "listener@example.org"], "the day itself counts");
		assert.deepEqual(await emails("signedUpBefore=2026-10-01"), ["form@example.org"], "the day itself doesn't");
		assert.deepEqual(await emails("signedUpSince=2026-10-01&signedUpBefore=2026-10-16"), ["imported@example.org", "listener@example.org"]);
		const { counts } = (await api(user.key, "GET", "/contacts?source=import")).body;
		assert.deepEqual([counts.active, counts.bounced], [1, 1], "the counts follow the filters");
		for (const query of ["signedUpSince=2026-02-30", "signedUpBefore=yesterday", "signedUpSince=2026-1-1"]) {
			assertError(await api(user.key, "GET", `/contacts?${query}`), 400, "validation_failed");
		}

		const exported = await api(user.key, "GET", "/contacts/export?source=import&signedUpBefore=2026-10-16");
		assert.equal(exported.body.count, 1);
		const csv = await (await m.exportRoute.GET(new Request(exported.body.url))).text();
		assert.deepEqual(csv.trim().split("\n").slice(1).map((row) => row.split(",")[0]), ["imported@example.org"], "the file holds what the link counted");
		assertError(await api(user.key, "GET", "/contacts/export?signedUpSince=2026-13-01"), 400, "validation_failed");

		const tagged = await api(user.key, "POST", "/contacts/tag", { newsletter: user.slug, filter: { source: "podcast" }, tags: ["listener"] });
		assert.deepEqual(tagged.body, { matched: 1, changed: 1 });
		assert.deepEqual(await emails("tag=listener"), ["listener@example.org"]);
	});

	test("list_contact_sources has each source with its contacts, most first, and only the account's", async () => {
		const user = await customer("filters-sources@example.com");
		await addContacts(user);
		assert.deepEqual((await api(user.key, "GET", "/contacts/sources")).body.sources, [
			{ name: "import", contacts: 2 },
			{ name: "podcast", contacts: 1 },
			{ name: "website", contacts: 1 },
		]);
		const other = await customer("filters-sources-other@example.com");
		assert.deepEqual((await api(other.key, "GET", "/contacts/sources")).body.sources, []);
	});

	test("delete_contacts deletes what a filter or a list picks in the account, and those who left stay blocked", async () => {
		const user = await customer("filters-delete@example.com");
		const other = await customer("filters-delete-other@example.com");
		await addContacts(user);
		await addContacts(other);

		assertError(await api(user.key, "POST", "/contacts/delete", { newsletter: user.slug, filter: {} }), 400, "validation_failed");
		assertError(await api(user.key, "POST", "/contacts/delete", { filter: { source: "import" } }), 400, "validation_failed");
		assertError(await api(user.key, "POST", "/contacts/delete", { newsletter: user.slug }), 400, "validation_failed");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 4, "nothing went");

		const deleted = await api(user.key, "POST", "/contacts/delete", { newsletter: user.slug, filter: { source: "import" } });
		assert.deepEqual(deleted.body, { deleted: 2, remaining: 0 });
		const left = await m.Contact.find({ accountId: user.accountId }).lean();
		assert.deepEqual(left.map(({ email }) => email).sort(), ["form@example.org", "listener@example.org"]);
		assert.deepEqual((await m.DeletedContact.find({ accountId: user.accountId }).lean()).map(({ status }) => status), ["bounced"], "only the bounced one leaves a trace");
		assert.equal(await m.Contact.countDocuments({ accountId: other.accountId }), 4, "another account's contacts stay");

		const back = await api(user.key, "POST", "/contacts", { newsletter: user.slug, email: "bounced@example.org" });
		assert.equal(back.body.status, "bounced", "added again, the bounced address keeps its status");

		const theirs = await m.Contact.findOne({ accountId: other.accountId, email: "form@example.org" }).lean();
		const byList = await api(user.key, "POST", "/contacts/delete", { contacts: ["listener@example.org", String(theirs._id)] });
		assert.deepEqual(byList.body, { deleted: 1, remaining: 0 });
		assert.ok(await m.Contact.exists({ accountId: other.accountId, _id: theirs._id }), "an ID from another account isn't found");
	});

	test("get_segment says how many of its active contacts opened and clicked lately, next to the whole list", async () => {
		const user = await customer("filters-activity@example.com");
		await addContacts(user);
		const created = await api(user.key, "POST", "/segments", { name: "Not imported", conditions: [{ field: "source", op: "is_not", value: "import" }] });
		const { activity } = (await api(user.key, "GET", `/segments/${created.body.id}`)).body;
		assert.deepEqual(activity, { segment: { contacts: 2, opened: 1, clicked: 1 }, list: { contacts: 3, opened: 1, clicked: 1 } });
	});
});

describe("the contacts and segments pages", () => {
	let user;
	let newsletterId;
	let segmentId;

	async function render(page, props) {
		const element = await as(user, () => page.default(props));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
	}

	before(async () => {
		user = await signIn("filters-pages@example.com");
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Pages news", slug: "filters-pages", postalAddress: "1 Main St, Paris" })))
		);
		newsletterId = url.split("/").at(-1);
		const ago = (days) => new Date(Date.now() - days * DAY_MS);
		const contact = (fields) => ({ accountId: user.accountId, newsletterId, status: "active", ...fields });
		await m.Contact.insertMany([
			contact({ email: "reader@example.org", source: "website", subscribedAt: ago(5), lastOpenAt: ago(1), lastClickAt: ago(1) }),
			contact({ email: "fan@example.org", source: "website", subscribedAt: ago(6), lastOpenAt: ago(2) }),
			contact({ email: "quiet@example.org", source: "import", subscribedAt: ago(400) }),
			contact({ email: "gone@example.org", source: "website", status: "unsubscribed", subscribedAt: ago(30) }),
		]);
		const saved = await as(user, () =>
			m.actions.saveSegment(null, { newsletterId, name: "From the form", match: "all", conditions: [{ field: "source", op: "is", value: "website" }] })
		);
		segmentId = saved.id;
	});

	test("the contacts page filters the list, links to the segments, and has no segment cards or Tag button", async () => {
		const html = await render(m.contactsPage, { searchParams: Promise.resolve({ source: "import" }) });
		assert.match(html, /quiet@example\.org/);
		assert.doesNotMatch(html, /reader@example\.org|fan@example\.org/);
		assert.match(html, /href="\/contacts\/segments"/);
		assert.doesNotMatch(html, /From the form|New segment/, "segments are on their own page");
		assert.doesNotMatch(html, />Tag</, "tags come from a contact's details, imports and the API");

		const since = await render(m.contactsPage, { searchParams: Promise.resolve({ signedUpSince: toDay(ago(10)) }) });
		assert.match(since, /reader@example\.org/);
		assert.doesNotMatch(since, /quiet@example\.org/);
	});

	test("an old link to the list's segment filter opens the segment's page, with the other filters", async () => {
		const target = await catchRedirect(as(user, () => m.contactsPage.default({ searchParams: Promise.resolve({ segment: segmentId, status: "active" }) })));
		assert.equal(target, `/contacts/segments/${segmentId}?status=active`);
	});

	test("the segments page lists each segment with its active contacts and their share of the list", async () => {
		const html = await render(m.segmentsPage, {});
		assert.match(html, new RegExp(`href="/contacts/segments/${segmentId}"`));
		assert.match(html, /From the form/);
		assert.match(html, /Came from the signup form/);
		assert.match(html, />67% of your list</, "2 of the 3 active contacts");
		assert.match(html, />100%</, "both opened lately");
	});

	test("a segment's page has its numbers next to the list's and its contacts of every status", async () => {
		const html = await render(m.segmentPage, { params: Promise.resolve({ id: segmentId }), searchParams: Promise.resolve({}) });
		assert.match(html, /<h1[^>]*>From the form<\/h1>/);
		assert.match(
			html,
			/<a href="\/contacts\/segments" aria-label="Back"[^>]*>[\s\S]*?<\/a><span[^>]*><a href="\/contacts\/segments"[^>]*>Segments<\/a><span aria-hidden="true"[^>]*>\/<\/span><\/span><h1/,
			"the back arrow, then a title under Segments"
		);
		for (const email of ["reader", "fan", "gone"]) assert.match(html, new RegExp(`${email}@example\\.org`));
		assert.doesNotMatch(html, /quiet@example\.org/);
		assert.match(html, /Active contacts/);
		assert.match(html, /None sent to it yet/);
		assert.match(html, /vs your list/, "the segment opens more than the list");

		const active = await render(m.segmentPage, { params: Promise.resolve({ id: segmentId }), searchParams: Promise.resolve({ status: "unsubscribed" }) });
		assert.match(active, /gone@example\.org/);
		assert.doesNotMatch(active, /reader@example\.org/);

		const stranger = await signIn("filters-pages-stranger@example.com");
		await catchNotFound(as(stranger, () => m.segmentPage.default({ params: Promise.resolve({ id: segmentId }), searchParams: Promise.resolve({}) })));
		await catchNotFound(as(user, () => m.segmentPage.default({ params: Promise.resolve({ id: "nope" }), searchParams: Promise.resolve({}) })));
	});

	test("deleting the contacts a segment's page shows leaves everyone else", async () => {
		const result = await as(user, () => m.actions.deleteListedContacts({ newsletterId, segmentId, status: "unsubscribed" }));
		assert.deepEqual(result, { deleted: 1, remaining: 0 });
		const left = await m.Contact.find({ accountId: user.accountId }).lean();
		assert.deepEqual(left.map(({ email }) => email).sort(), ["fan@example.org", "quiet@example.org", "reader@example.org"]);
		const stranger = await signIn("filters-pages-deleter@example.com");
		const theirs = await as(stranger, () => m.actions.deleteListedContacts({ newsletterId, segmentId }));
		assert.ok(theirs.error, "another account can't name this newsletter or segment");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 3);
	});

	test("the filters come as status, signup date, source then tag", async () => {
		await m.Contact.create({ accountId: user.accountId, newsletterId, email: "tagged@example.org", status: "active", source: "import", tags: ["vip"] });
		const html = await render(m.contactsPage, { searchParams: Promise.resolve({}) });
		const pills = [...html.matchAll(/<button[^>]*>(Status|Signed up|Source|Tag)<svg/g)].map(([, label]) => label);
		assert.deepEqual(pills, ["Status", "Signed up", "Source", "Tag"]);
	});
});

function ago(days) {
	return new Date(Date.now() - days * DAY_MS);
}

function toDay(date) {
	return date.toISOString().slice(0, 10);
}
