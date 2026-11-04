import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// The contacts list's selection, as the bar under it changes it: the contacts ticked on a page, by ID, or every contact
// the list shows with its filters, on every page, and the whole list without any.
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		actions: await import("../app/(app)/contacts/actions.js"),
		contactsPage: await import("../app/(app)/contacts/page.js"),
		contactsLib: await import("../lib/contacts.js"),
		Contact: (await import("../models/Contact.js")).default,
		Segment: (await import("../models/Segment.js")).default,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		selectEveryone: (await import("../components/ProviderContactSelection.jsx")).selectEveryone,
	};
});

after(() => app?.stop());

async function createNewsletter(owner, slug) {
	const url = await as(owner, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris" }))));
	return url.split("/").at(-1);
}

// Contacts by address and status: their IDs, by address.
async function addContacts(owner, newsletterId, rows) {
	const contacts = await m.Contact.insertMany(
		Object.entries(rows).map(([email, status]) => ({ accountId: owner.accountId, newsletterId, email, status, subscribedAt: new Date() }))
	);
	return Object.fromEntries(contacts.map(({ email, _id }) => [email, String(_id)]));
}

async function statuses(owner, newsletterId) {
	const contacts = await m.Contact.find({ accountId: owner.accountId, newsletterId }).sort({ email: 1 }).lean();
	return Object.fromEntries(contacts.map(({ email, status }) => [email, status]));
}

async function tagsOf(owner, newsletterId, email) {
	const contact = await m.Contact.findOne({ accountId: owner.accountId, newsletterId, email }).lean();
	return contact.tags ?? [];
}

describe("the list's selection", () => {
	test("the contacts ticked on a page get tags, a status and a segment, then go, and no one else", async () => {
		const user = await signIn("selection-ticked@example.com");
		const newsletterId = await createNewsletter(user, "ticked");
		const ids = await addContacts(user, newsletterId, {
			"ana@example.org": "active",
			"ben@example.org": "active",
			"chloe@example.org": "dormant",
			"david@example.org": "unsubscribed",
			"left-out@example.org": "active",
		});
		const picked = { newsletterId, ids: ["ana", "ben", "chloe", "david"].map((name) => ids[`${name}@example.org`]) };

		assert.deepEqual(await as(user, () => m.actions.tagSelectedContacts(picked, ["picked"])), { changed: 4, remaining: 0 });
		assert.deepEqual(await as(user, () => m.actions.untagSelectedContacts({ newsletterId, ids: [ids["ana@example.org"]] }, ["picked"])), {
			changed: 1,
			remaining: 0,
		});
		assert.deepEqual(await tagsOf(user, newsletterId, "ben@example.org"), ["picked"]);
		assert.deepEqual(await tagsOf(user, newsletterId, "left-out@example.org"), []);

		assert.deepEqual(await as(user, () => m.actions.setSelectedStatus(picked, "dormant")), { changed: 2, remaining: 0 });
		assert.deepEqual(await as(user, () => m.actions.setSelectedStatus(picked, "active")), { changed: 3, remaining: 0 }, "the dormant ones");
		assert.deepEqual(await statuses(user, newsletterId), {
			"ana@example.org": "active",
			"ben@example.org": "active",
			"chloe@example.org": "active",
			"david@example.org": "unsubscribed",
			"left-out@example.org": "active",
		});
		const change = (await m.Contact.findOne({ accountId: user.accountId, newsletterId, email: "chloe@example.org" }).lean()).statusChanges.at(-1);
		assert.deepEqual([change.from, change.to, change.via, String(change.userId)], ["dormant", "active", "dashboard", String(user.userId)]);

		const few = { newsletterId, ids: [ids["ben@example.org"], ids["chloe@example.org"]] };
		const segment = await as(user, () => m.actions.segmentSelectedContacts(few, { name: "Picked few", tag: "picked few" }));
		assert.ok(segment.id, JSON.stringify(segment));
		const saved = await m.Segment.findOne({ accountId: user.accountId, _id: segment.id }).lean();
		assert.equal(saved.name, "Picked few");
		assert.deepEqual(
			saved.conditions.map(({ field, op, value }) => ({ field, op, value })),
			[{ field: "tag", op: "has", value: "picked few" }]
		);
		assert.deepEqual(await tagsOf(user, newsletterId, "chloe@example.org"), ["picked", "picked few"]);
		const refused = await as(user, () => m.actions.segmentSelectedContacts(few, { name: "Too long", tag: "x".repeat(41) }));
		assert.ok(refused.error, "a tag longer than tags can be");
		assert.equal(await m.Segment.countDocuments({ accountId: user.accountId, name: "Too long" }), 0);

		assert.deepEqual(await as(user, () => m.actions.deleteSelectedContacts({ newsletterId, ids: [ids["ana@example.org"], ids["david@example.org"]] })), {
			deleted: 2,
			remaining: 0,
		});
		assert.deepEqual(Object.keys(await statuses(user, newsletterId)), ["ben@example.org", "chloe@example.org", "left-out@example.org"]);
	});

	test("every contact the filters show, on every page, and without any, the whole list", async () => {
		const user = await signIn("selection-filtered@example.com");
		const newsletterId = await createNewsletter(user, "filtered");
		const other = await createNewsletter(user, "untouched");
		await addContacts(user, newsletterId, { "one@example.org": "active", "two@example.org": "active", "three@example.org": "pending" });
		await addContacts(user, other, { "one@example.org": "active" });
		await m.Contact.updateMany({ accountId: user.accountId, newsletterId, email: { $ne: "three@example.org" } }, { $set: { tags: ["batch"] } });

		const batch = { newsletterId, filters: { tag: "batch", status: null, query: "" } };
		assert.deepEqual(await as(user, () => m.actions.tagSelectedContacts(batch, ["everyone"])), { changed: 2, remaining: 0 });
		assert.deepEqual(await as(user, () => m.actions.setSelectedStatus({ newsletterId, filters: { status: "pending" } }, "unsubscribed")), {
			changed: 1,
			remaining: 0,
		});
		assert.equal((await statuses(user, newsletterId))["three@example.org"], "unsubscribed");

		const whole = { newsletterId, filters: { status: null, query: "", tag: null, source: null, signedUpSince: null, signedUpBefore: null } };
		assert.deepEqual(await as(user, () => m.actions.setSelectedStatus(whole, "dormant")), { changed: 2, remaining: 0 });
		assert.deepEqual(await as(user, () => m.actions.deleteSelectedContacts(whole)), { deleted: 3, remaining: 0 });
		assert.deepEqual(await statuses(user, newsletterId), {});
		assert.deepEqual(await statuses(user, other), { "one@example.org": "active" }, "the account's other newsletter keeps its contacts");
	});

	test("a big selection gets its tags, and its segment, a few thousand contacts a call", async () => {
		const user = await signIn("selection-big@example.com");
		const newsletterId = await createNewsletter(user, "big");
		const { MAX_CHANGED_AT_ONCE } = m.contactsLib;
		await m.Contact.insertMany(
			Array.from({ length: MAX_CHANGED_AT_ONCE + 2 }, (_, index) => ({ accountId: user.accountId, newsletterId, email: `reader${index}@example.org`, status: "active" }))
		);
		const everyone = { newsletterId, filters: {} };

		assert.deepEqual(await as(user, () => m.actions.tagSelectedContacts(everyone, ["fan"])), { changed: MAX_CHANGED_AT_ONCE, remaining: 2 });
		assert.deepEqual(await as(user, () => m.actions.tagSelectedContacts(everyone, ["fan"])), { changed: 2, remaining: 0 });
		assert.deepEqual(await as(user, () => m.actions.untagSelectedContacts(everyone, ["fan"])), { changed: MAX_CHANGED_AT_ONCE, remaining: 2 });
		assert.deepEqual(await as(user, () => m.actions.untagSelectedContacts(everyone, ["fan"])), { changed: 2, remaining: 0 });
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, tags: "fan" }), 0);

		const segment = () => as(user, () => m.actions.segmentSelectedContacts(everyone, { name: "Everyone", tag: "everyone" }));
		assert.deepEqual(await segment(), { remaining: 2 }, "the segment waits for its last contacts");
		assert.equal(await m.Segment.countDocuments({ accountId: user.accountId }), 0);
		assert.ok((await segment()).id);
		assert.equal(await m.Segment.countDocuments({ accountId: user.accountId, name: "Everyone" }), 1);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, tags: "everyone" }), MAX_CHANGED_AT_ONCE + 2);
	});

	test("another account's newsletter and contacts stay out of reach", async () => {
		const user = await signIn("selection-guarded@example.com");
		const newsletterId = await createNewsletter(user, "guarded");
		const ids = await addContacts(user, newsletterId, { "kept@example.org": "active" });
		const stranger = await signIn("selection-stranger@example.com");
		const theirNewsletter = await createNewsletter(stranger, "stranger");

		for (const attempt of [
			() => m.actions.tagSelectedContacts({ newsletterId, ids: [ids["kept@example.org"]] }, ["x"]),
			() => m.actions.setSelectedStatus({ newsletterId, filters: {} }, "unsubscribed"),
			() => m.actions.deleteSelectedContacts({ newsletterId, filters: {} }),
			() => m.actions.segmentSelectedContacts({ newsletterId, filters: {} }, { name: "Theirs", tag: "theirs" }),
		]) {
			assert.equal((await as(stranger, attempt)).error, "Newsletter not found");
		}
		const byId = await as(stranger, () => m.actions.deleteSelectedContacts({ newsletterId: theirNewsletter, ids: [ids["kept@example.org"]] }));
		assert.deepEqual(byId, { deleted: 0, remaining: 0 }, "an ID from another account isn't found");
		assert.deepEqual(await statuses(user, newsletterId), { "kept@example.org": "active" });
		assert.deepEqual(await tagsOf(user, newsletterId, "kept@example.org"), []);
	});

	test("the list has a box on each contact and one for all of them, and the bar waits for someone to be picked", async () => {
		const user = await signIn("selection-boxes@example.com");
		const newsletterId = await createNewsletter(user, "boxes");
		await addContacts(user, newsletterId, { "boxed@example.org": "active" });
		user.jar.set("newsletter", newsletterId);
		const element = await as(user, () => m.contactsPage.default({ searchParams: Promise.resolve({}) }));
		const html = renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
		assert.match(html, /aria-label="Select boxed@example\.org"/);
		assert.match(html, /aria-label="Select all contacts"/);
		assert.match(html, /<div data-selection-bar="true" class=/);
		assert.match(html, /role="toolbar" aria-label="Selected contacts" inert=""/, "hidden from everyone until a contact is picked");
	});

	test("the box at the top picks every contact the list finds, on every page, and the page's own when they all fit on it", () => {
		const page = ["ana", "ben", "chloe"];
		assert.deepEqual(m.selectEveryone(page, 58_242), { ids: new Set(), isAll: true }, "the list's filters, which the bar counts in full");
		assert.deepEqual(m.selectEveryone(page, 3), { ids: new Set(page), isAll: false }, "by ID, as if each was ticked");
	});
});
