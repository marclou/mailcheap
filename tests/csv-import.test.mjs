import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CONTACT_FIELDS } from "../lib/contact-fields.js";
import {
	canBeNewField,
	guessFieldType,
	mapColumns,
	normalizeImportRow,
	normalizeRate,
	normalizeStatus,
	sanitizeImportRow,
	suggestProfileColumns,
} from "../lib/csv-import.js";

test("a beehiiv full export keeps its custom fields once they're picked as new fields, then maps them on its own", () => {
	const headers = ["email", "status", "created_at", "utm_source", "referral_code", "First Name", "Company", "Birthday", "Lifetime Value"];
	const row = {
		email: "ada@example.com",
		status: "active",
		created_at: "2024-03-24 10:23:10 UTC",
		utm_source: "twitter",
		referral_code: "AbC123xy",
		"First Name": "Ada",
		Company: "Lovelace Labs",
		Birthday: "1990-05-14",
		"Lifetime Value": "120.50",
	};
	const suggested = Object.fromEntries(suggestProfileColumns(headers).map(({ column, target }) => [column, target]));
	assert.deepEqual(suggested, {
		utm_source: "skip",
		referral_code: "skip",
		"First Name": "first_name",
		Company: "skip",
		Birthday: "skip",
		"Lifetime Value": "skip",
	});
	assert.deepEqual(
		["Company", "Birthday", "Lifetime Value"].map((column) => guessFieldType([row[column]])),
		["text", "date", "number"]
	);

	const profile = {
		firstName: "First Name",
		fields: [
			{ column: "Company", key: "company", type: "text" },
			{ column: "Birthday", key: "birthday", type: "date" },
			{ column: "Lifetime Value", key: "lifetime_value", type: "number" },
		],
	};
	const imported = normalizeImportRow(row, mapColumns(headers), { profile });
	assert.equal(imported.firstName, "Ada");
	assert.deepEqual(imported.fields, { company: "Lovelace Labs", birthday: "1990-05-14", lifetime_value: 120.5 });

	const fields = profile.fields.map(({ column, key, type }) => ({ key, label: column, type }));
	assert.deepEqual(
		suggestProfileColumns(headers, fields)
			.map(({ target }) => target)
			.filter((target) => target.startsWith("field:")),
		["field:company", "field:birthday", "field:lifetime_value"]
	);
});

test("columns picked as new fields count toward the fields limit, and two can't make the same field", () => {
	const fields = Array.from({ length: MAX_CONTACT_FIELDS - 1 }, (_, index) => ({ key: `field_${index}`, label: `Field ${index}`, type: "text" }));
	const columns = [
		{ column: "Company", target: "new:text", newType: "text" },
		{ column: "Country", target: "skip", newType: "text" },
		{ column: "company", target: "skip", newType: "text" },
	];
	assert.equal(canBeNewField(columns[0], columns, fields), true, "a column going into a new field keeps it");
	assert.equal(canBeNewField(columns[1], columns, fields), false, "Company's new field takes the last place");
	assert.equal(canBeNewField(columns[1], columns, fields.slice(1)), true);
	assert.equal(canBeNewField(columns[2], columns, []), false, "company would make the same field as Company");
});

test("maps common export headers", () => {
	const columns = mapColumns(["Email", "Status", "Created At", "Open Rate", "Click Through Rate"]);
	assert.deepEqual(columns, {
		email: "Email",
		status: "Status",
		subscribedAt: "Created At",
		emailsReceived: null,
		openRate: "Open Rate",
		clickRate: "Click Through Rate",
		lastOpenAt: null,
		lastClickAt: null,
		opens: null,
		clicks: null,
		unsubscribedAt: null,
		cleanedAt: null,
		subscribedToEmails: null,
		emailDisabled: null,
	});
});

test("maps statuses and never guesses active for unknown values", () => {
	assert.equal(normalizeStatus("active"), "active");
	assert.equal(normalizeStatus("inactive"), "unsubscribed");
	assert.equal(normalizeStatus("Invalid"), "bounced");
	assert.equal(normalizeStatus("pending"), "dormant");
	assert.equal(normalizeStatus("something-new"), "dormant");
	assert.equal(normalizeStatus(""), "active");
});

test("normalizes rates written as percents or fractions", () => {
	assert.equal(normalizeRate("45.5%"), 0.455);
	assert.equal(normalizeRate("45.5"), 0.455);
	assert.equal(normalizeRate("0.3"), 0.3);
	assert.equal(normalizeRate(""), undefined);
	assert.equal(normalizeRate("abc"), undefined);
	assert.equal(normalizeRate("250%"), 1);
});

test("normalizes a row and applies a stricter status override only", () => {
	const columns = mapColumns(["email", "status", "created_at"]);
	const active = normalizeImportRow(
		{ email: " Jane@Example.com ", status: "active", created_at: "2024-01-02" },
		columns,
		{ status: "dormant" }
	);
	assert.equal(active.email, "jane@example.com");
	assert.equal(active.status, "dormant");
	assert.equal(active.subscribedAt, new Date("2024-01-02").toISOString());

	const unsubscribed = normalizeImportRow({ email: "reader@example.com", status: "inactive" }, columns, {
		status: "dormant",
	});
	assert.equal(unsubscribed.status, "unsubscribed");
	assert.equal(normalizeImportRow({ email: "not-an-email" }, columns), null);
});

test("sanitizes rows coming from the browser", () => {
	assert.equal(sanitizeImportRow({ email: "reader@example.com", status: "admin" }), null);
	assert.equal(sanitizeImportRow({ email: "reader@example.com", status: "__proto__" }), null);
	assert.equal(sanitizeImportRow(null), null);

	const row = sanitizeImportRow({
		email: "Reader@Example.com",
		status: "active",
		subscribedAt: "nope",
		openRate: 7,
		clickRate: -1,
	});
	assert.deepEqual(row, {
		email: "reader@example.com",
		status: "active",
		subscribedAt: undefined,
		emailsReceived: undefined,
		openRate: 1,
		clickRate: undefined,
	});
});
