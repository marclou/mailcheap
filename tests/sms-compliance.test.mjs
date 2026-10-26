import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSmsEvent, isStopKeyword, STOP_KEYWORDS } from "../lib/sms-events.js";

test("isStopKeyword matches standard telecom opt-out keywords case-insensitively", () => {
	assert.ok(Array.isArray(STOP_KEYWORDS));
	assert.ok(STOP_KEYWORDS.includes("STOP"));
	assert.ok(STOP_KEYWORDS.includes("ARRET"));
	assert.ok(STOP_KEYWORDS.includes("UNSUBSCRIBE"));

	assert.equal(isStopKeyword("STOP"), true);
	assert.equal(isStopKeyword("stop"), true);
	assert.equal(isStopKeyword("  arret  "), true);
	assert.equal(isStopKeyword("Cancel"), true);
	assert.equal(isStopKeyword("QUIT"), true);

	assert.equal(isStopKeyword("Hello there"), false);
	assert.equal(isStopKeyword("Can you stop by tomorrow?"), false);
	assert.equal(isStopKeyword(""), false);
	assert.equal(isStopKeyword(null), false);
});

test("handleSmsEvent ignores unknown or malformed payloads", async () => {
	assert.deepEqual(await handleSmsEvent(null), { handled: false });
	assert.deepEqual(await handleSmsEvent({}), { handled: false });
	assert.deepEqual(await handleSmsEvent("not an object"), { handled: false });
});

test("handleSmsEvent processes non-STOP inbound replies gracefully", async () => {
	const inboundEvent = {
		originationPhoneNumber: "+12025550199",
		messageBody: "Thanks for the discount link!",
	};

	const result = await handleSmsEvent(inboundEvent);
	assert.deepEqual(result, {
		handled: true,
		action: "inbound-reply",
		phone: "+12025550199",
	});
});
