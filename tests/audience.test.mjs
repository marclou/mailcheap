import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { selectAudience } from "../lib/audience.js";
import { buildAudienceQuery } from "../lib/audience-query.js";
import { contacts as contactsTable } from "../lib/schema.js";

const proxy = drizzle(async () => ({ rows: [] }));

const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";

function contact(id, fields = {}) {
	return {
		_id: id,
		email: `${id}@example.com`,
		status: "active",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...fields,
	};
}

const contacts = [
	contact("never-engaged"),
	contact("early-signup", { createdAt: new Date("2025-01-01T00:00:00.000Z") }),
	contact("imported-opener", { imported: { openRate: 0.6 } }),
	contact("imported-clicker", { imported: { clickRate: 0.1, openRate: 0.2 } }),
	contact("imported-top-clicker", { imported: { clickRate: 0.3, openRate: 0.1 } }),
	contact("opened-recently", { lastOpenAt: new Date("2026-09-30T00:00:00.000Z") }),
	contact("opened-in-march", { lastOpenAt: new Date("2026-03-01T00:00:00.000Z") }),
	contact("clicked-in-february", {
		lastClickAt: new Date("2026-02-01T00:00:00.000Z"),
		lastOpenAt: new Date("2026-02-01T00:00:00.000Z"),
	}),
	contact("clicked-recently", { lastClickAt: new Date("2026-09-01T00:00:00.000Z") }),
	contact("unsubscribed", { status: "unsubscribed", lastClickAt: new Date("2026-10-01") }),
	contact("bounced", { status: "bounced" }),
	contact("dormant", { status: "dormant" }),
	contact("suppressed", { lastClickAt: new Date("2026-10-02T00:00:00.000Z") }),
];
const suppressedEmails = ["suppressed@example.com"];

test("the audience is active, unsuppressed contacts, most engaged first", () => {
	const audience = selectAudience(contacts, { suppressedEmails });
	assert.deepEqual(
		audience.map(({ _id }) => _id),
		[
			"clicked-recently",
			"clicked-in-february",
			"opened-recently",
			"opened-in-march",
			"imported-top-clicker",
			"imported-clicker",
			"imported-opener",
			"early-signup",
			"never-engaged",
		]
	);
});

test("audienceLimit keeps the most engaged contacts", () => {
	const audience = selectAudience(contacts, { suppressedEmails, audienceLimit: 3 });
	assert.deepEqual(
		audience.map(({ _id }) => _id),
		["clicked-recently", "clicked-in-february", "opened-recently"]
	);
	for (const audienceLimit of [undefined, null, 0, -1, 2.5, "abc"]) {
		assert.equal(selectAudience(contacts, { suppressedEmails, audienceLimit }).length, 9);
	}
});

test("contacts with equal engagement keep a stable order", () => {
	const twins = [contact("b"), contact("a"), contact("c")];
	assert.deepEqual(
		selectAudience(twins).map(({ _id }) => _id),
		["a", "b", "c"]
	);
	assert.deepEqual(
		twins.map(({ _id }) => _id),
		["b", "a", "c"]
	);
});

test("the SQL query selects the same audience in the same order", () => {
	const query = buildAudienceQuery({ newsletterId, audienceLimit: 500 });
	const { sql, params } = proxy.select().from(contactsTable).where(query.where).orderBy(...query.orderBy).toSQL();
	assert.match(sql, /"newsletter_id" = \$1 and "contacts"."status" = \$2 and not exists/);
	assert.match(sql, /from "suppressions" where "suppressions"."email" = "contacts"."email"/);
	assert.match(
		sql,
		/order by "contacts"."last_click_at" desc nulls last, "contacts"."last_open_at" desc nulls last, "contacts"."imported_click_rate" desc nulls last, "contacts"."imported_open_rate" desc nulls last, "contacts"."created_at" asc, "contacts"."id" asc$/
	);
	assert.deepEqual(params, [newsletterId, "active"]);
	assert.equal(query.limit, 500);
});

test("the SQL query skips invalid limits", () => {
	for (const audienceLimit of [undefined, null, 0, -1, 2.5, "abc"]) {
		assert.equal(buildAudienceQuery({ newsletterId, audienceLimit }).limit, null);
	}
	assert.equal(buildAudienceQuery({ newsletterId, audienceLimit: "250" }).limit, 250);
});
