import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { checkSegmentRules, compileSegment, describeSegment } from "../lib/segments.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-18T12:00:00.000Z");

function rules(conditions, match = "all") {
	const checked = checkSegmentRules({ match, conditions });
	assert.ok(checked.rules, checked.problem);
	return checked.rules;
}

describe("segment rules", () => {
	test("conditions are checked, and numbers and text come out clean", () => {
		assert.deepEqual(rules([{ field: "opened", op: "within", value: "30" }, { field: "email", op: "ends_with", value: " @Example.ORG " }]), {
			match: "all",
			conditions: [
				{ field: "opened", op: "within", value: 30 },
				{ field: "email", op: "ends_with", value: "@example.org" },
			],
		});
		assert.deepEqual(rules([{ field: "opened", op: "never", value: 5 }]).conditions, [{ field: "opened", op: "never" }], "never takes no value");

		const problems = [
			[{ conditions: [] }, "Add a condition"],
			[{ match: "most", conditions: [{ field: "opened", op: "never" }] }, "match must be all or any"],
			[{ conditions: [{ field: "country", op: "is", value: "FR" }] }, /field must be one of/],
			[{ conditions: [{ field: "opened", op: "since", value: "2026-01-01" }] }, "opened takes within, not_within, never"],
			[{ conditions: [{ field: "opened", op: "within", value: 0 }] }, /whole number of days/],
			[{ conditions: [{ field: "opened", op: "within", value: 1.5 }] }, /whole number of days/],
			[{ conditions: [{ field: "signed_up", op: "since", value: "2026-02-30" }] }, /a date, YYYY-MM-DD/],
			[{ conditions: [{ field: "email", op: "contains", value: "   " }] }, /some text/],
			[{ conditions: Array.from({ length: 11 }, () => ({ field: "opened", op: "never" })) }, "10 conditions at most"],
			[{ conditions: [{ field: "opened", op: "never" }, { field: "clicked", op: "within" }] }, /^Condition 2: clicked within needs/],
		];
		for (const [input, problem] of problems) {
			const result = checkSegmentRules(input);
			assert.equal(result.rules, undefined, JSON.stringify(input));
			if (problem instanceof RegExp) assert.match(result.problem, problem);
			else assert.equal(result.problem, problem);
		}
	});

	test("each condition becomes one filter, dates counted back from now", () => {
		const cutoff = new Date(NOW.getTime() - 30 * DAY_MS);
		const filter = (condition) => compileSegment(rules([condition]), { now: NOW });
		assert.deepEqual(filter({ field: "opened", op: "within", value: 30 }), { lastOpenAt: { $gte: cutoff } });
		assert.deepEqual(filter({ field: "clicked", op: "not_within", value: 30 }), { lastClickAt: { $not: { $gte: cutoff } } }, "never clicked counts");
		assert.deepEqual(filter({ field: "signed_up", op: "not_within", value: 30 }), { subscribedAt: { $lt: cutoff } });
		assert.deepEqual(filter({ field: "opened", op: "never" }), { lastOpenAt: null });
		assert.deepEqual(filter({ field: "missed_issues", op: "less_than", value: 3 }), { ignoredIssues: { $not: { $gte: 3 } } }, "missing counts as 0");
		assert.deepEqual(filter({ field: "signed_up", op: "since", value: "2026-10-01" }), { subscribedAt: { $gte: new Date("2026-10-01T00:00:00.000Z") } });
		assert.deepEqual(filter({ field: "source", op: "is_not", value: "import" }), { source: { $ne: "import" } });
		assert.deepEqual(filter({ field: "email", op: "contains", value: "a+b.c" }), { email: { $regex: "a\\+b\\.c" } }, "text is never a pattern");

		const two = [
			{ field: "opened", op: "never" },
			{ field: "source", op: "is", value: "import" },
		];
		assert.deepEqual(compileSegment(rules(two), { now: NOW }), { $and: [{ lastOpenAt: null }, { source: "import" }] });
		assert.deepEqual(compileSegment(rules(two, "any"), { now: NOW }), { $or: [{ lastOpenAt: null }, { source: "import" }] });
	});

	test("rules read as one sentence", () => {
		const segment = rules(
			[
				{ field: "opened", op: "within", value: 30 },
				{ field: "signed_up", op: "since", value: "2026-10-01" },
				{ field: "source", op: "is", value: "website" },
			],
			"any"
		);
		assert.equal(describeSegment(segment), "Opened in the last 30 days, signed up since Oct 1, 2026 or came from the signup form");
		assert.equal(describeSegment(rules([{ field: "missed_issues", op: "at_least", value: 1 }])), "Missed at least 1 issue in a row");
		assert.equal(describeSegment(rules([{ field: "source", op: "is_not", value: "podcast" }])), 'Didn\'t come from "podcast"');
	});
});

describe("segments through the API", () => {
	let app;
	let m;

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

	// Five contacts whose dates and counts cover every condition, missing values included.
	async function addContacts(user) {
		const ago = (days) => new Date(Date.now() - days * DAY_MS);
		const contact = (fields) => ({ accountId: user.accountId, newsletterId: user.newsletterId, status: "active", ...fields });
		const [fresh, lapsed, cold, newbie, left] = await m.Contact.insertMany([
			contact({ email: "fresh@example.com", source: "website", subscribedAt: ago(10), lastOpenAt: ago(2), lastClickAt: ago(2), ignoredIssues: 0, stats: { sent: 6, opens: 6, clicks: 2 } }),
			contact({ email: "lapsed@example.org", source: "import", subscribedAt: ago(400), lastOpenAt: ago(50), ignoredIssues: 4, stats: { sent: 9, opens: 2, clicks: 0 } }),
			contact({ email: "cold@example.net", source: "import", subscribedAt: ago(200), ignoredIssues: 7, stats: { sent: 7, opens: 0, clicks: 0 } }),
			contact({ email: "new+tag@example.com", subscribedAt: ago(1) }),
			contact({ email: "left@example.com", source: "website", status: "unsubscribed", subscribedAt: ago(30), lastOpenAt: ago(1) }),
		]);
		return { fresh, lapsed, cold, newbie, left };
	}

	before(async () => {
		app = await startTestApp();
		m = {
			rest: await import("../lib/api/rest.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			exportRoute: await import("../app/api/v1/contacts/export.csv/route.js"),
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
	});

	after(() => app?.stop());

	test("each condition picks the active contacts it says, missing values included", async () => {
		const user = await customer("segment-counts@example.com");
		await addContacts(user);
		const yearsAgo = new Date(Date.now() - 300 * DAY_MS).toISOString().slice(0, 10);
		const cases = [
			[[{ field: "opened", op: "within", value: 30 }], 1],
			[[{ field: "opened", op: "not_within", value: 30 }], 3],
			[[{ field: "opened", op: "never" }], 2],
			[[{ field: "clicked", op: "within", value: 7 }], 1],
			[[{ field: "missed_issues", op: "at_least", value: 4 }], 2],
			[[{ field: "missed_issues", op: "less_than", value: 4 }], 2],
			[[{ field: "emails_opened", op: "at_least", value: 2 }], 2],
			[[{ field: "emails_opened", op: "less_than", value: 1 }], 2],
			[[{ field: "signed_up", op: "within", value: 30 }], 2],
			[[{ field: "signed_up", op: "not_within", value: 30 }], 2],
			[[{ field: "signed_up", op: "before", value: yearsAgo }], 1],
			[[{ field: "signed_up", op: "since", value: yearsAgo }], 3],
			[[{ field: "source", op: "is", value: "import" }], 2],
			[[{ field: "source", op: "is_not", value: "import" }], 2],
			[[{ field: "email", op: "contains", value: "+tag" }], 1],
			[[{ field: "email", op: "ends_with", value: "@example.org" }], 1],
		];
		for (const [conditions, expected] of cases) {
			const response = await api(user.key, "POST", "/segments/count", { conditions });
			assert.equal(response.body.contacts, expected, JSON.stringify(conditions));
		}
		const coldAndOld = [
			{ field: "opened", op: "never" },
			{ field: "signed_up", op: "not_within", value: 30 },
		];
		assert.equal((await api(user.key, "POST", "/segments/count", { conditions: coldAndOld })).body.contacts, 1, "all");
		const any = await api(user.key, "POST", "/segments/count", {
			match: "any",
			conditions: [
				{ field: "opened", op: "within", value: 30 },
				{ field: "source", op: "is", value: "import" },
			],
		});
		assert.deepEqual([any.body.contacts, any.body.neverMailed], [3, 3], "any; nobody was emailed yet");
		assertError(await api(user.key, "POST", "/segments/count", { conditions: [{ field: "opened", op: "within" }] }), 400, "validation_failed");
	});

	test("segments are saved, listed, changed and filter the contacts list and its export", async () => {
		const user = await customer("segment-crud@example.com");
		await addContacts(user);
		const created = await api(user.key, "POST", "/segments", { name: "From the form", conditions: [{ field: "source", op: "is", value: "website" }] });
		assert.equal(created.status, 201);
		assert.deepEqual(
			{ name: created.body.name, description: created.body.description, contacts: created.body.contacts },
			{ name: "From the form", description: "Came from the signup form", contacts: 1 }
		);
		const id = created.body.id;
		assert.deepEqual(
			(await api(user.key, "GET", "/segments")).body.segments.map(({ id: listed }) => listed),
			[id]
		);

		const list = await api(user.key, "GET", `/contacts?segment=${id}`);
		assert.deepEqual(list.body.contacts.map(({ email }) => email).sort(), ["fresh@example.com", "left@example.com"], "any status in the list");
		assert.deepEqual([list.body.counts.active, list.body.counts.unsubscribed], [1, 1]);

		const exported = await api(user.key, "GET", `/contacts/export?segment=${id}&status=active`);
		assert.equal(exported.body.count, 1);
		const csv = await (await m.exportRoute.GET(new Request(exported.body.url))).text();
		assert.equal(csv.trim().split("\n").length, 2, "a header and one row");
		assert.match(csv, /fresh@example\.com/);

		const renamed = await api(user.key, "PATCH", `/segments/${id}`, { name: "Engaged" });
		assert.deepEqual([renamed.body.name, renamed.body.description], ["Engaged", "Came from the signup form"], "conditions stay");
		const changed = await api(user.key, "PATCH", `/segments/${id}`, { match: "any", conditions: [{ field: "opened", op: "never" }, { field: "clicked", op: "within", value: 30 }] });
		assert.deepEqual([changed.body.match, changed.body.contacts], ["any", 3]);
		assertError(await api(user.key, "PATCH", `/segments/${id}`, { conditions: [] }), 400, "validation_failed");

		assert.equal((await api(user.key, "DELETE", `/segments/${id}`)).status, 200);
		assertError(await api(user.key, "GET", `/segments/${id}`), 404, "not_found");
		assertError(await api(user.key, "GET", `/contacts?segment=${id}`), 404, "not_found");
		assert.deepEqual((await api(user.key, "GET", "/segments")).body.segments, []);
	});

	test("a campaign sent to a segment reaches exactly its active contacts", async () => {
		const user = await customer("segment-send@example.com");
		const { lapsed, cold, newbie } = await addContacts(user);
		const segment = (await api(user.key, "POST", "/segments", { name: "Quiet", conditions: [{ field: "opened", op: "not_within", value: 30 }] })).body;

		const created = await api(user.key, "POST", "/campaigns", { subject: "Issue", previewText: "Hi", content: "Hello **readers**.", segment: segment.id });
		assert.equal(created.status, 201);
		assert.deepEqual(created.body.segment, { id: segment.id, name: "Quiet", deleted: false });
		assert.deepEqual(created.body.audience, { contacts: 3, neverMailed: 3 });
		assert.equal(created.body.activeContacts, 4);

		const sent = await api(user.key, "POST", `/campaigns/${created.body.id}/send`);
		assert.equal(sent.status, 200, JSON.stringify(sent.body));
		assert.deepEqual([sent.body.segmentId, sent.body.stats.recipients], [segment.id, 3]);
		const messages = await m.Message.find({ accountId: user.accountId, campaignId: created.body.id, kind: "campaign" }).lean();
		assert.deepEqual(
			messages.map(({ contactId }) => String(contactId)).sort(),
			[lapsed, cold, newbie].map(({ _id }) => String(_id)).sort()
		);

		// Sending another draft to everyone instead, from the send call itself.
		const everyone = await api(user.key, "POST", "/campaigns", { subject: "To all", previewText: "Hi", content: "Hello.", segment: segment.id });
		const toAll = await api(user.key, "POST", `/campaigns/${everyone.body.id}/send`, { segment: null });
		assert.deepEqual([toAll.body.segmentId, toAll.body.stats.recipients], [null, 4]);
	});

	test("a segment a campaign waits for can't be deleted, and a deleted one stops its drafts", async () => {
		const user = await customer("segment-delete@example.com");
		await addContacts(user);
		const segment = (await api(user.key, "POST", "/segments", { name: "New", conditions: [{ field: "signed_up", op: "within", value: 30 }] })).body;
		const id = (await api(user.key, "POST", "/campaigns", { subject: "Issue", previewText: "Hi", content: "Hello." })).body.id;

		const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
		const scheduled = await api(user.key, "POST", `/campaigns/${id}/schedule`, { scheduledAt: at, segment: segment.id });
		assert.deepEqual([scheduled.body.status, scheduled.body.segmentId], ["scheduled", segment.id]);
		assert.match(assertError(await api(user.key, "DELETE", `/segments/${segment.id}`), 409, "conflict"), /scheduled or sending campaign/);

		await api(user.key, "POST", `/campaigns/${id}/unschedule`);
		assert.equal((await api(user.key, "DELETE", `/segments/${segment.id}`)).status, 200);
		const draft = await api(user.key, "GET", `/campaigns/${id}`);
		assert.deepEqual(draft.body.segment, { id: segment.id, name: "New", deleted: true });
		assert.deepEqual(draft.body.audience, { contacts: 0, neverMailed: 0 });
		assert.equal(draft.body.sendProblem.code, "send_check_failed");
		assert.equal(assertError(await api(user.key, "POST", `/campaigns/${id}/send`), 422, "send_check_failed"), "Its segment was deleted: pick who gets it");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, campaignId: id }), 0, "nothing was queued");

		await api(user.key, "PATCH", `/campaigns/${id}`, { segment: null });
		const back = await api(user.key, "GET", `/campaigns/${id}`);
		assert.deepEqual([back.body.segment, back.body.sendProblem, back.body.audience.contacts], [null, null, 4]);
	});

	test("segments stay in their account and newsletter", async () => {
		const owner = await customer("segment-owner@example.com");
		const other = await customer("segment-other@example.com");
		const segment = (await api(owner.key, "POST", "/segments", { name: "Mine", conditions: [{ field: "opened", op: "never" }] })).body;

		assertError(await api(other.key, "GET", `/segments/${segment.id}`), 404, "not_found");
		assertError(await api(other.key, "PATCH", `/segments/${segment.id}`, { name: "Taken" }), 404, "not_found");
		assertError(await api(other.key, "DELETE", `/segments/${segment.id}`), 404, "not_found");
		assertError(await api(other.key, "GET", `/contacts?segment=${segment.id}`), 404, "not_found");
		assertError(await api(other.key, "POST", "/campaigns", { subject: "Issue", segment: segment.id }), 404, "not_found");
		assert.deepEqual((await api(other.key, "GET", "/segments")).body.segments, []);
		assert.equal((await api(owner.key, "GET", `/segments/${segment.id}`)).body.name, "Mine", "unchanged");

		const url = await as(owner, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Second", slug: "segment-owner-second", postalAddress: "1 Main St, Paris" })))
		);
		const secondId = url.split("/").at(-1);
		const second = (await api(owner.key, "POST", "/segments", { newsletter: secondId, name: "There", conditions: [{ field: "opened", op: "never" }] })).body;
		const id = (await api(owner.key, "POST", "/campaigns", { subject: "Issue" })).body.id;
		assert.match(assertError(await api(owner.key, "PATCH", `/campaigns/${id}`, { segment: second.id }), 400, "validation_failed"), /another newsletter/);

		// The list and the export refuse a segment of another newsletter than the one asked for, and follow the segment's own.
		for (const path of ["/contacts", "/contacts/export"]) {
			const mismatch = await api(owner.key, "GET", `${path}?newsletter=${owner.newsletterId}&segment=${second.id}`);
			assert.match(assertError(mismatch, 400, "validation_failed"), /another newsletter/, path);
			assert.equal((await api(owner.key, "GET", `${path}?newsletter=${secondId}&segment=${second.id}`)).status, 200, path);
			assert.equal((await api(owner.key, "GET", `${path}?segment=${second.id}`)).status, 200, path);
		}
	});
});
