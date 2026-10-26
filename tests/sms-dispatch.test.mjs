import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSmsContent, formatE164 } from "../lib/sms-utils.js";

test("SMS segment math: GSM-7 boundaries and concatenation overhead", () => {
	// Exactly 160 GSM chars -> 1 segment
	const text160 = "A".repeat(160);
	const res160 = analyzeSmsContent(text160);
	assert.equal(res160.segments, 1);
	assert.equal(res160.encoding, "GSM-7");
	assert.equal(res160.remainingInSegment, 0);

	// 161 GSM chars -> 2 segments (153 + 8)
	const text161 = "A".repeat(161);
	const res161 = analyzeSmsContent(text161);
	assert.equal(res161.segments, 2);
	assert.equal(res161.encoding, "GSM-7");
	assert.equal(res161.remainingInSegment, 145);

	// Exactly 306 GSM chars (153 * 2) -> 2 segments
	const text306 = "A".repeat(306);
	const res306 = analyzeSmsContent(text306);
	assert.equal(res306.segments, 2);
	assert.equal(res306.remainingInSegment, 0);

	// 307 GSM chars -> 3 segments
	const text307 = "A".repeat(307);
	const res307 = analyzeSmsContent(text307);
	assert.equal(res307.segments, 3);
});

test("SMS segment math: UCS-2 boundaries for non-GSM content", () => {
	// 70 UCS-2 chars -> 1 segment
	const ucs70 = "\u0410".repeat(70);
	const res70 = analyzeSmsContent(ucs70);
	assert.equal(res70.segments, 1);
	assert.equal(res70.encoding, "UCS-2");
	assert.equal(res70.isUcs2, true);

	// 71 UCS-2 chars -> 2 segments (67 + 4)
	const ucs71 = "\u0410".repeat(71);
	const res71 = analyzeSmsContent(ucs71);
	assert.equal(res71.segments, 2);
	assert.equal(res71.encoding, "UCS-2");
	assert.equal(res71.remainingInSegment, 63);
});

test("formatE164 parses various phone inputs into valid E.164 strings", () => {
	const fr = formatE164("06 12 34 56 78", "FR");
	assert.equal(fr?.e164, "+33612345678");
	assert.equal(fr?.country, "FR");

	const us = formatE164("(202) 555-0123", "US");
	assert.equal(us?.e164, "+12025550123");
	assert.equal(us?.country, "US");

	const intl = formatE164("+44 20 7946 0958");
	assert.equal(intl?.e164, "+442079460958");
	assert.equal(intl?.country, "GB");

	assert.equal(formatE164("not-a-number"), null);
	assert.equal(formatE164(""), null);
	assert.equal(formatE164(null), null);
});
