import assert from "node:assert/strict";
import { test } from "node:test";
import { getAction } from "../lib/actions/registry.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { analyzeSmsContent, formatE164 } from "../lib/sms-utils.js";

test("create_campaign action schema supports channel and smsText", () => {
	const action = getAction("create_campaign");
	assert.ok(action, "create_campaign action must exist in registry");

	const parsed = action.input.safeParse({
		newsletter: "6650f1c2e9b1d4a012345678",
		channel: "sms",
		smsText: "Flash update: new product drop! Reply STOP to opt out.",
	});

	assert.equal(parsed.success, true);
	assert.equal(parsed.data.channel, "sms");
	assert.equal(parsed.data.smsText, "Flash update: new product drop! Reply STOP to opt out.");
});

test("update_campaign action schema supports updating channel and smsText", () => {
	const action = getAction("update_campaign");
	assert.ok(action, "update_campaign action must exist in registry");

	const parsed = action.input.safeParse({
		id: "6650f1c2e9b1d4a012345678",
		channel: "sms",
		smsText: "Updated message body. Reply STOP to opt out.",
	});

	assert.equal(parsed.success, true);
	assert.equal(parsed.data.channel, "sms");
});

test("add_contact action schema supports phone and phoneConsent", () => {
	const action = getAction("add_contact");
	assert.ok(action, "add_contact action must exist in registry");

	const parsed = action.input.safeParse({
		newsletter: "6650f1c2e9b1d4a012345678",
		email: "test@example.com",
		phone: "+33612345678",
		phoneConsent: true,
	});

	assert.equal(parsed.success, true);
	assert.equal(parsed.data.phone, "+33612345678");
	assert.equal(parsed.data.phoneConsent, true);
});

test("update_contact action schema supports phone and smsStatus", () => {
	const action = getAction("update_contact");
	assert.ok(action, "update_contact action must exist in registry");

	const parsed = action.input.safeParse({
		id: "6650f1c2e9b1d4a012345678",
		phone: "+12025550123",
		smsStatus: "active",
	});

	assert.equal(parsed.success, true);
	assert.equal(parsed.data.phone, "+12025550123");
	assert.equal(parsed.data.smsStatus, "active");
});

test("getPresendChecks branches to SMS checks when channel is sms", () => {
	const emptySms = {
		channel: "sms",
		smsText: "",
	};

	const resultEmpty = getPresendChecks({
		campaign: emptySms,
		isSendingEnabled: true,
		isSmsConfigured: true,
	});

	const bodyCheck = resultEmpty.checks.find((c) => c.id === "sms-body");
	assert.ok(bodyCheck, "sms-body check must be present");
	assert.equal(bodyCheck.isOk, false);

	const validSms = {
		channel: "sms",
		smsText: "Urgent issue published! Read here: https://example.com Reply STOP to opt out.",
	};

	const resultValid = getPresendChecks({
		campaign: validSms,
		isSendingEnabled: true,
		isSmsConfigured: true,
	});

	const validBodyCheck = resultValid.checks.find((c) => c.id === "sms-body");
	assert.equal(validBodyCheck.isOk, true);

	const optOutCheck = resultValid.checks.find((c) => c.id === "sms-opt-out");
	assert.equal(optOutCheck.isOk, true);
	assert.equal(resultValid.blocking.length, 0);
});
