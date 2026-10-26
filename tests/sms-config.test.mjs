import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getSmsCredentials,
	getSmsRegion,
	getSmsSenderId,
	isSmsConfigured,
} from "../lib/config.js";

test("getSmsCredentials returns explicit SNS credentials when provided", () => {
	const env = {
		SNS_ACCESS_KEY_ID: "sns-key",
		SNS_SECRET_ACCESS_KEY: "sns-secret",
		SES_ACCESS_KEY_ID: "ses-key",
		SES_SECRET_ACCESS_KEY: "ses-secret",
	};

	assert.deepEqual(getSmsCredentials(env), {
		accessKeyId: "sns-key",
		secretAccessKey: "sns-secret",
	});
	assert.equal(isSmsConfigured(env), true);
});

test("getSmsCredentials falls back to SES credentials when SNS keys are omitted", () => {
	const env = {
		SES_ACCESS_KEY_ID: "ses-key-only",
		SES_SECRET_ACCESS_KEY: "ses-secret-only",
	};

	assert.deepEqual(getSmsCredentials(env), {
		accessKeyId: "ses-key-only",
		secretAccessKey: "ses-secret-only",
	});
	assert.equal(isSmsConfigured(env), true);
});

test("getSmsCredentials returns null when credentials are missing or incomplete", () => {
	assert.equal(getSmsCredentials({}), null);
	assert.equal(isSmsConfigured({}), false);

	const incomplete = { SNS_ACCESS_KEY_ID: "only-key" };
	assert.equal(getSmsCredentials(incomplete), null);
	assert.equal(isSmsConfigured(incomplete), false);
});

test("getSmsRegion prioritizes SNS_REGION, falls back to SES_REGION, and defaults to us-east-1", () => {
	assert.equal(getSmsRegion({ SNS_REGION: "eu-west-1", SES_REGION: "us-west-2" }), "eu-west-1");
	assert.equal(getSmsRegion({ SES_REGION: "eu-central-1" }), "eu-central-1");
	assert.equal(getSmsRegion({}), "us-east-1");
});

test("getSmsSenderId returns trimmed alphanumeric sender ID or null", () => {
	assert.equal(getSmsSenderId({ SNS_SENDER_ID: " MailCheap " }), "MailCheap");
	assert.equal(getSmsSenderId({ SNS_SENDER_ID: "   " }), null);
	assert.equal(getSmsSenderId({}), null);
});
