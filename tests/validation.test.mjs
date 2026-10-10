import assert from "node:assert/strict";
import { test } from "node:test";
import { isIdString, isPlainObject, normalizeEmail } from "../lib/validation.js";

test("emails are trimmed and lowercased", () => {
	const accepted = [
		[" Reader@Example.COM ", "reader@example.com"],
		["first.last+news@sub.example.co.uk", "first.last+news@sub.example.co.uk"],
		["o'brien@example.com", "o'brien@example.com"],
		["user@xn--e1afmkfd.xn--80akhbyknj4f", "user@xn--e1afmkfd.xn--80akhbyknj4f"],
		[`${"a".repeat(64)}@example.com`, `${"a".repeat(64)}@example.com`],
	];
	for (const [input, expected] of accepted) assert.equal(normalizeEmail(input), expected);
});

test("addresses SES can't take as a single recipient are rejected", () => {
	const rejected = [
		"",
		"plain",
		"@example.com",
		"user@",
		"user@example",
		"user@@example.com",
		"a,b@example.com",
		"a b@example.com",
		"<a@example.com>",
		"Name <a@example.com>",
		'"quoted"@example.com',
		".start@example.com",
		"end.@example.com",
		"dou..ble@example.com",
		"user@-example.com",
		"user@example-.com",
		"user@example.c",
		"user@example.123",
		"user@exa_mple.com",
		"user\r\n@example.com",
		`${"a".repeat(65)}@example.com`,
		`a@${`${"b".repeat(60)}.`.repeat(5)}com`,
		null,
		42,
		{},
	];
	for (const input of rejected) assert.equal(normalizeEmail(input), null, String(input));
});

test("ObjectId strings are exactly 24 hex characters", () => {
	assert.equal(isIdString("64f1a2b3c4d5e6f7a8b9c0d1"), true);
	assert.equal(isIdString("64F1A2B3C4D5E6F7A8B9C0D1"), true);
	for (const value of ["64f1a2b3c4d5e6f7a8b9c0d", "64f1a2b3c4d5e6f7a8b9c0dz", "aaaaaaaaaaaa", 42, null]) {
		assert.equal(isIdString(value), false, String(value));
	}
});

test("plain objects exclude arrays and null", () => {
	assert.equal(isPlainObject({}), true);
	assert.equal(isPlainObject([]), false);
	assert.equal(isPlainObject(null), false);
	assert.equal(isPlainObject("{}"), false);
});
