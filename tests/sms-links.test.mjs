import assert from "node:assert/strict";
import { test } from "node:test";
import { generateShortCode } from "../lib/sms-links.js";

test("generateShortCode produces 6-character alphanumeric base62 strings", () => {
	const code = generateShortCode();
	assert.equal(typeof code, "string");
	assert.equal(code.length, 6);
	assert.match(code, /^[0-9a-zA-Z]{6}$/);

	const code2 = generateShortCode();
	assert.notEqual(code, code2);
});

test("generateShortCode respects custom length parameter", () => {
	const code8 = generateShortCode(8);
	assert.equal(code8.length, 8);
	assert.match(code8, /^[0-9a-zA-Z]{8}$/);
});
