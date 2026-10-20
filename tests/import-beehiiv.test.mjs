import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Papa from "papaparse";
import { MAX_CONTACT_FIELDS } from "../lib/contact-fields.js";
import { labelFromColumn, mapColumns, normalizeImportRow, sanitizeImportRow, suggestProfileColumns } from "../lib/csv-import.js";

// beehiiv's full export (Settings > Export data > Export subscribers, full version) with its real header row, in order,
// and made-up values. Its custom fields come after, as columns named after each field.
const BEEHIIV_FULL = [
	"subscriber_id",
	"api_subscription_id",
	"email",
	"tags",
	"status",
	"created_at",
	"updated_at",
	"unsubscribed_at",
	"stripe_customer_id",
	"referred_by",
	"campaign",
	"channel",
	"acquisition_source",
	"referring_url",
	"acquisition_term",
	"acquisition_content",
	"device_type",
	"total_revenue_cents",
	"referral_count",
	"total_sent",
	"total_delivered",
	"total_unique_opened",
	"total_clicked",
	"total_unique_clicked",
	"open_rate",
	"click_rate",
	"last_opened_at",
	"last_clicked_at",
	"Free Tier",
];

function parse(headers, rows) {
	const csv = Papa.unparse({ fields: headers, data: rows.map((row) => headers.map((header) => row[header] ?? "")) });
	const { data, meta } = Papa.parse(csv, { header: true, skipEmptyLines: true });
	return { data, headers: meta.fields, columns: mapColumns(meta.fields) };
}

function targets(headers, rows, fields = []) {
	return Object.fromEntries(suggestProfileColumns(headers, fields, rows).map(({ column, target }) => [column, target]));
}

const ACTIVE = {
	subscriber_id: "0b2f6c1e-0000-4000-8000-000000000001",
	api_subscription_id: "sub_0b2f6c1e-0000-4000-8000-000000000001",
	email: "reader.one@example.com",
	tags: "Early readers, vip",
	status: "active",
	created_at: "2024-03-24 10:23:10 UTC",
	updated_at: "2026-10-01 08:00:00 UTC",
	campaign: "spring-launch",
	channel: "website",
	acquisition_source: "Twitter: twitter.com / social",
	referring_url: "https://writer.example.org/",
	device_type: "smartphone",
	total_revenue_cents: "0",
	referral_count: "0",
	total_sent: "64",
	total_delivered: "63",
	total_unique_opened: "41",
	total_clicked: "9",
	total_unique_clicked: "7",
	open_rate: "65.08",
	click_rate: "11.11",
	last_opened_at: "2026-10-12 07:41:00",
	last_clicked_at: "2026-09-02 18:05:00",
	"Free Tier": "Yes",
	"First Name": "Reader",
	Company: "Example Co",
	Birthday: "1990-05-14",
};
const LEFT = {
	...ACTIVE,
	email: "reader.two@example.com",
	tags: "",
	status: "inactive",
	unsubscribed_at: "2025-06-01 12:00:00 UTC",
	last_clicked_at: "",
};

describe("beehiiv full export", () => {
	const headers = [...BEEHIIV_FULL, "First Name", "Company", "Birthday"];
	const { data, columns } = parse(headers, [ACTIVE, LEFT]);

	test("reads status, signup date, rates, emails received and the opens and clicks on its own", () => {
		const [active, left] = data.map((row) => normalizeImportRow(row, columns));
		assert.equal(active.status, "active");
		assert.equal(left.status, "unsubscribed", "inactive readers never come in as active");
		assert.equal(active.subscribedAt, "2024-03-24T10:23:10.000Z");
		assert.equal(active.emailsReceived, 63);
		assert.ok(Math.abs(active.openRate - 0.6508) < 1e-9);
		assert.ok(Math.abs(active.clickRate - 0.1111) < 1e-9);
		assert.equal(active.lastOpenAt, "2026-10-12T07:41:00.000Z");
		assert.equal(active.lastClickAt, "2026-09-02T18:05:00.000Z");
		assert.equal(active.opens, 41);
		assert.equal(active.clicks, 7);
		assert.equal(left.lastClickAt, undefined);
	});

	test("suggests tags, the first name, a field for each custom field and for where readers came from, and skips the rest", () => {
		assert.deepEqual(targets(headers, data), {
			subscriber_id: "skip",
			api_subscription_id: "skip",
			tags: "tags",
			updated_at: "skip",
			stripe_customer_id: "skip",
			referred_by: "skip",
			campaign: "new:text",
			channel: "new:text",
			acquisition_source: "new:text",
			referring_url: "new:text",
			acquisition_term: "skip",
			acquisition_content: "skip",
			device_type: "skip",
			total_revenue_cents: "skip",
			referral_count: "skip",
			total_sent: "skip",
			total_clicked: "skip",
			"Free Tier": "skip",
			"First Name": "first_name",
			Company: "new:text",
			Birthday: "new:date",
		});
	});

	test("the next import puts the same columns into the fields it made", () => {
		const fields = ["campaign", "channel", "acquisition_source", "referring_url", "Company", "Birthday"].map((column) => ({
			key: column.toLowerCase(),
			label: labelFromColumn(column),
			type: column === "Birthday" ? "date" : "text",
		}));
		const suggested = targets(headers, data, fields);
		assert.equal(suggested.acquisition_source, "field:acquisition_source");
		assert.equal(suggested.Company, "field:company");
		assert.equal(Object.values(suggested).filter((target) => target.startsWith("new:")).length, 0);
	});

	test("new fields only fill the room the account has left, in column order", () => {
		const fields = Array.from({ length: MAX_CONTACT_FIELDS - 2 }, (_, index) => ({ key: `field_${index}`, label: `Field ${index}`, type: "text" }));
		const suggested = targets(headers, data, fields);
		assert.equal(suggested.campaign, "new:text");
		assert.equal(suggested.channel, "new:text");
		assert.equal(suggested.acquisition_source, "skip");
		assert.equal(suggested.Company, "skip");
	});

	test("an empty custom field column isn't worth a field", () => {
		const { data: rows } = parse([...BEEHIIV_FULL, "Nickname"], [ACTIVE]);
		assert.equal(targets([...BEEHIIV_FULL, "Nickname"], rows).Nickname, "skip");
	});

	test("engagement from the file is checked again on the server", () => {
		const future = new Date(Date.now() + 86_400_000).toISOString();
		const row = sanitizeImportRow({ email: "reader.one@example.com", status: "active", lastOpenAt: future, lastClickAt: "2026-09-02T18:05:00.000Z", opens: 41.7, clicks: -3 });
		assert.equal(row.lastOpenAt, undefined, "a date in the future is left out");
		assert.equal(row.lastClickAt.toISOString(), "2026-09-02T18:05:00.000Z");
		assert.equal(row.opens, 41);
		assert.equal(row.clicks, undefined);
	});

	test("field names read like the others", () => {
		assert.equal(labelFromColumn("acquisition_source"), "Acquisition source");
		assert.equal(labelFromColumn("campaign"), "Campaign");
		assert.equal(labelFromColumn("MEMBER_RATING"), "Member rating");
		assert.equal(labelFromColumn("First Name"), "First Name");
	});
});

describe("beehiiv quick export", () => {
	// Export subscribers, quick version: email, status and tier.
	test("brings email and status, and leaves the tier out", () => {
		const headers = ["email", "status", "tier"];
		const { data, columns } = parse(headers, [
			{ email: "quick.one@example.com", status: "active", tier: "free" },
			{ email: "quick.two@example.com", status: "inactive", tier: "free" },
			{ email: "quick.three@example.com", status: "validating", tier: "premium" },
		]);
		assert.deepEqual(
			data.map((row) => normalizeImportRow(row, columns).status),
			["active", "unsubscribed", "dormant"]
		);
		assert.deepEqual(targets(headers, data), { tier: "skip" });
	});
});

describe("other platforms' exports", () => {
	test("Mailchimp: merge fields become fields, its own columns stay out", () => {
		const headers = [
			"Email Address",
			"First Name",
			"Last Name",
			"Address",
			"Phone Number",
			"MEMBER_RATING",
			"OPTIN_TIME",
			"OPTIN_IP",
			"CONFIRM_TIME",
			"CONFIRM_IP",
			"LATITUDE",
			"LONGITUDE",
			"GMTOFF",
			"DSTOFF",
			"TIMEZONE",
			"CC",
			"REGION",
			"LAST_CHANGED",
			"LEID",
			"EUID",
			"NOTES",
			"TAGS",
		];
		const { data } = parse(headers, [
			{ "Email Address": "mc.one@example.com", "First Name": "Mia", "Last Name": "Doe", Address: "1 Main St", "Phone Number": "555-0100", MEMBER_RATING: "2", OPTIN_TIME: "2023-04-21 11:16:57", OPTIN_IP: "192.0.2.1", CONFIRM_TIME: "2023-04-21 11:16:57", LATITUDE: "48.8", LONGITUDE: "2.3", GMTOFF: "1", DSTOFF: "2", TIMEZONE: "Europe/Paris", CC: "FR", REGION: "IDF", LAST_CHANGED: "2023-04-21 11:16:57", LEID: "123", EUID: "abc", NOTES: "Met at a meetup", TAGS: '"Readers"' },
		]);
		const suggested = targets(headers, data);
		assert.deepEqual(
			Object.entries(suggested).filter(([, target]) => target !== "skip"),
			[
				["First Name", "first_name"],
				["Last Name", "new:text"],
				["Address", "new:text"],
				["Phone Number", "new:text"],
				["TAGS", "tags"],
			]
		);
	});

	test("Substack: both exports bring no fields of their own", () => {
		const list = ["email", "active_subscription", "expiry", "plan", "email_disabled", "created_at", "first_payment_at"];
		const page = ["Email", "Name", "Start date", "Subscriber country", "Subscription source (free)", "Activity"];
		const fromList = parse(list, [{ email: "ss.one@example.com", active_subscription: "true", expiry: "2027-01-04T23:26:30.533Z", plan: "paid", email_disabled: "false", created_at: "2022-11-15T07:55:22.660Z", first_payment_at: "2020-01-05T23:30:00.000Z" }]);
		const fromPage = parse(page, [{ Email: "ss.two@example.com", Name: "Sam", "Start date": "2024-05-02", "Subscriber country": "France", "Subscription source (free)": "substack", Activity: "4" }]);
		assert.ok(Object.values(targets(list, fromList.data)).every((target) => target === "skip"));
		assert.deepEqual(targets(page, fromPage.data), {
			Name: "first_name",
			"Subscriber country": "skip",
			"Subscription source (free)": "skip",
			Activity: "skip",
		});
	});

	test("Kit: tags go to tags, its location columns become fields", () => {
		const headers = ["first_name", "email_address", "created_at", "status", "tags", "city", "state", "country"];
		const { data } = parse(headers, [{ first_name: "Pia", email_address: "kit.one@example.com", created_at: "2025-01-15T09:30:00Z", status: "active", tags: "Readers, VIP", city: "Portland", state: "OR", country: "US" }]);
		assert.deepEqual(targets(headers, data), { first_name: "first_name", tags: "tags", city: "new:text", state: "new:text", country: "new:text" });
	});
});
