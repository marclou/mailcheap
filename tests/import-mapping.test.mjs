import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	assignColumnTarget,
	describeColumnTarget,
	getColumnTargetOptions,
	normalizeImportRow,
	planColumns,
	readColumnPlan,
	splitImportChunks,
} from "../lib/csv-import.js";

// beehiiv's full export header row, then two custom fields, with made-up values.
const HEADERS = [
	"subscriber_id",
	"email",
	"tags",
	"status",
	"created_at",
	"unsubscribed_at",
	"stripe_customer_id",
	"campaign",
	"acquisition_source",
	"device_type",
	"total_unique_opened",
	"last_opened_at",
	"Free Tier",
	"First Name",
	"Company",
	"Lifetime Value",
];
const ROWS = [
	{
		subscriber_id: "sub_1",
		email: "Ada@Example.org",
		tags: "vip, founders",
		status: "active",
		created_at: "2024-03-01 10:00:00 UTC",
		unsubscribed_at: "",
		stripe_customer_id: "cus_1",
		campaign: "launch",
		acquisition_source: "twitter",
		device_type: "mobile",
		total_unique_opened: "12",
		last_opened_at: "2026-10-01 09:00:00 UTC",
		"Free Tier": "true",
		"First Name": " Ada ",
		Company: "Analytical",
		"Lifetime Value": "120",
	},
	{
		subscriber_id: "sub_2",
		email: "left@example.org",
		tags: "",
		status: "inactive",
		created_at: "2023-01-05 08:00:00 UTC",
		unsubscribed_at: "2025-02-02 08:00:00 UTC",
		stripe_customer_id: "",
		campaign: "",
		acquisition_source: "google",
		device_type: "desktop",
		total_unique_opened: "0",
		last_opened_at: "",
		"Free Tier": "true",
		"First Name": "",
		Company: "",
		"Lifetime Value": "",
	},
];

function targetOf(plan, column) {
	return plan.find((item) => item.column === column)?.target;
}

describe("the import's column plan", () => {
	test("every column gets a destination: recognized ones fold away, custom ones become new fields, platform ones stay out", () => {
		const plan = planColumns(HEADERS, [], ROWS);
		assert.equal(plan.length, HEADERS.length);
		assert.deepEqual(
			plan.filter((item) => item.auto).map(({ column, target }) => [column, target]),
			[
				["email", "email"],
				["tags", "tags"],
				["status", "status"],
				["created_at", "subscribedAt"],
				["unsubscribed_at", "unsubscribedAt"],
				["total_unique_opened", "opens"],
				["last_opened_at", "lastOpenAt"],
				["First Name", "first_name"],
			]
		);
		assert.equal(targetOf(plan, "Company"), "new:text");
		assert.equal(targetOf(plan, "Lifetime Value"), "new:number");
		assert.equal(targetOf(plan, "acquisition_source"), "new:text");
		for (const column of ["subscriber_id", "stripe_customer_id", "device_type", "Free Tier"]) assert.equal(targetOf(plan, column), "skip", column);
		assert.deepEqual(plan.find((item) => item.column === "tags").samples, ["vip, founders"]);
		assert.deepEqual(plan.find((item) => item.column === "status").samples, ["active", "inactive"]);
	});

	test("a column matching one of the account's fields goes into it", () => {
		const plan = planColumns(HEADERS, [{ key: "company", label: "Company", type: "text" }], ROWS);
		assert.equal(targetOf(plan, "Company"), "field:company");
		assert.equal(plan.find((item) => item.column === "Company").auto, true);
	});

	test("a destination only one column can have moves to the column picked last", () => {
		const plan = planColumns(HEADERS, [], ROWS);
		const moved = assignColumnTarget(plan, "Company", "first_name");
		assert.equal(targetOf(moved, "Company"), "first_name");
		assert.equal(targetOf(moved, "First Name"), "skip");
		const newFields = assignColumnTarget(assignColumnTarget(plan, "campaign", "new:text"), "device_type", "new:text");
		assert.equal(targetOf(newFields, "campaign"), "new:text", "new fields are each their own");
		assert.equal(targetOf(newFields, "device_type"), "new:text");
	});

	test("the plan reads into the columns and profile the rows are normalized with, as the preview shows them", () => {
		const fields = [{ key: "company", label: "Company", type: "text" }];
		const { columns, profile } = readColumnPlan(planColumns(HEADERS, fields, ROWS), fields);
		assert.equal(columns.email, "email");
		assert.equal(columns.unsubscribedAt, "unsubscribed_at");
		assert.deepEqual(profile.fields.map(({ key }) => key).sort(), ["acquisition_source", "campaign", "company", "lifetime_value"]);
		const [ada, left] = ROWS.map((row) => normalizeImportRow(row, columns, { profile }));
		assert.equal(ada.email, "ada@example.org");
		assert.equal(ada.firstName, "Ada");
		assert.deepEqual(ada.tags, ["vip", "founders"]);
		assert.equal(ada.fields.company, "Analytical");
		assert.equal(ada.opens, 12);
		assert.equal(left.status, "unsubscribed", "inactive and an unsubscribe date both mean they left");
		assert.equal(left.firstName, undefined);
	});

	test("destinations read in plain words", () => {
		const fields = [{ key: "company", label: "Company", type: "text" }];
		assert.equal(describeColumnTarget("subscribedAt"), "Signup date");
		assert.equal(describeColumnTarget("tags"), "Tags, split by comma");
		assert.equal(describeColumnTarget("skip"), "Don't import");
		assert.equal(describeColumnTarget("field:company", { fields }), "Field: Company");
		assert.equal(describeColumnTarget("new:number", { column: "lifetime_value" }), "New field: Lifetime value (number)");
		const opened = planColumns(HEADERS, [], ROWS).find((item) => item.column === "last_opened_at");
		assert.deepEqual(getColumnTargetOptions(opened).recognized, ["lastOpenAt"]);
		assert.deepEqual(getColumnTargetOptions({ column: "x", target: "skip", auto: false }).recognized, []);
	});
});

describe("the requests a file goes in", () => {
	test("1,000 rows at most per request, fewer when rows are big, every row once and in order", () => {
		const rows = Array.from({ length: 2500 }, (_, index) => ({ email: `reader${index}@example.org`, status: "active" }));
		const chunks = splitImportChunks(rows);
		assert.deepEqual(chunks.map((chunk) => chunk.length), [1000, 1000, 500]);
		assert.deepEqual(chunks.flat(), rows);

		const big = rows.slice(0, 50).map((row) => ({ ...row, fields: { notes: "x".repeat(400) } }));
		const small = splitImportChunks(big, { maxSize: 5000 });
		assert.ok(small.length > 1);
		assert.ok(small.every((chunk) => JSON.stringify(chunk).length <= 5000 + chunk.length));
		assert.deepEqual(small.flat(), big);
		assert.deepEqual(splitImportChunks([]), []);
	});
});
