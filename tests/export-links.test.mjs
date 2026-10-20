import assert from "node:assert/strict";
import { before, test } from "node:test";
import { getCsvHeader, toCsvRow } from "../lib/contacts-csv.js";
import { EXPORT_LINK_MS, createExportToken, verifyExportToken } from "../lib/export-token.js";
import { mapColumns, suggestProfileColumns } from "../lib/csv-import.js";

const ACCOUNT = "6650f1c2e9b1d4a012345678";
const NEWSLETTER = "6650f1c2e9b1d4a0123456ff";

before(() => {
	process.env.BETTER_AUTH_SECRET = "test-secret-for-export-links-0123456789";
});

test("an export link carries the account and filters, signed, for an hour", () => {
	const now = Date.parse("2026-10-12T10:00:00Z");
	const { token, expiresAt } = createExportToken({ accountId: ACCOUNT, newsletterId: NEWSLETTER, status: "active", query: "jane" }, now);
	assert.equal(expiresAt.getTime(), now + EXPORT_LINK_MS);
	assert.deepEqual(verifyExportToken(token, now + 59 * 60_000), {
		accountId: ACCOUNT,
		newsletterId: NEWSLETTER,
		status: "active",
		query: "jane",
		segmentId: null,
		tag: null,
	});
	assert.equal(verifyExportToken(token, now + 61 * 60_000), null, "expired");
	const segment = createExportToken({ accountId: ACCOUNT, segmentId: "6650f1c2e9b1d4a0123456ee" }, now);
	assert.equal(verifyExportToken(segment.token, now).segmentId, "6650f1c2e9b1d4a0123456ee", "a segment's export keeps it");
	const tagged = createExportToken({ accountId: ACCOUNT, tag: "vip" }, now);
	assert.equal(verifyExportToken(tagged.token, now).tag, "vip", "a tag's export keeps it");

	const [payload, signature] = token.split(".");
	const widened = Buffer.from(JSON.stringify({ a: "6650f1c2e9b1d4a0123456aa", e: Math.floor(now / 1000) + 3600 })).toString("base64url");
	assert.equal(verifyExportToken(`${widened}.${signature}`, now), null, "another account with the same signature");
	assert.equal(verifyExportToken(`${payload}.${signature.slice(0, -1)}A`, now), null);
	assert.equal(verifyExportToken("nonsense", now), null);
	assert.equal(verifyExportToken(undefined, now), null);
});

test("links signed with another secret don't open", () => {
	const { token } = createExportToken({ accountId: ACCOUNT });
	process.env.BETTER_AUTH_SECRET = "another-secret-for-export-links-0123456789";
	try {
		assert.equal(verifyExportToken(token), null);
	} finally {
		process.env.BETTER_AUTH_SECRET = "test-secret-for-export-links-0123456789";
	}
});

test("CSV cells are quoted when needed and never start a formula, the email included", () => {
	// A valid address can begin with a formula character (=cmd|'…'!A1 needs no parentheses), so a
	// contact signed up through the archive form can't carry a formula into the owner's spreadsheet.
	const contact = {
		email: "=cmd|'calc'!a1@example.com",
		status: "active",
		newsletterId: NEWSLETTER,
		source: '=HYPERLINK("http://x","click")',
		subscribedAt: new Date("2026-01-02T03:04:05Z"),
		stats: { sent: 3, opens: 2, clicks: 1 },
	};
	const row = toCsvRow(contact, new Map([[NEWSLETTER, "weekly"]]));
	assert.equal(row, `'=cmd|'calc'!a1@example.com,,active,weekly,"'=HYPERLINK(""http://x"",""click"")",,2026-01-02T03:04:05.000Z,,,,,,3,2,1\r\n`);
	assert.ok(!/^[=+\-@\t\r]/.test(row), "the email cell doesn't open a formula");
	// A plain address is untouched, so an export still re-imports as it was.
	assert.equal(toCsvRow({ email: "jane@example.com", status: "active" }).split(",")[0], "jane@example.com");
});

test("the export's columns are the ones the import reads", () => {
	const headers = getCsvHeader([{ key: "company", label: "Company", type: "text" }]).trim().split(",");
	const columns = mapColumns(headers);
	assert.deepEqual(
		{ email: columns.email, status: columns.status, subscribedAt: columns.subscribedAt, emailsReceived: columns.emailsReceived },
		{ email: "email", status: "status", subscribedAt: "subscribed_at", emailsReceived: "emails_received" }
	);
	assert.deepEqual(
		suggestProfileColumns(headers, [{ key: "company", label: "Company", type: "text" }]).filter(({ target }) => target !== "skip"),
		[
			{ column: "first_name", target: "first_name" },
			{ column: "tags", target: "tags" },
			{ column: "company", target: "field:company" },
		],
		"the first name, the tags and each field go back in where they came from"
	);
});
