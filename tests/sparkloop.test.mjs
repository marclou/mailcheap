import assert from "node:assert/strict";
import { test } from "node:test";
import { openSecret, sealSecret } from "../lib/secret-box.js";
import { getScriptTag, isShownOn, openSignupFlow } from "../lib/sparkloop-embed.js";
import { describeGeo, describeOfferPayout } from "../lib/sparkloop-format.js";
import { createWebhookToken, hashWebhookToken, isWebhookToken, readReferral } from "../lib/sparkloop-referrals.js";

process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

test("API keys are sealed, and can't be read with another secret or once changed", () => {
	const sealed = sealSecret("test-api-key-123");
	assert.ok(!sealed.includes("test-api-key-123"));
	assert.notEqual(sealSecret("test-api-key-123"), sealed, "each seal uses a new IV");
	assert.equal(openSecret(sealed), "test-api-key-123");

	const [version, iv, tag, data] = sealed.split(".");
	// The first character: the last one's low bits can be padding, which decodes to the same bytes.
	const flipped = `${data.startsWith("A") ? "B" : "A"}${data.slice(1)}`;
	assert.equal(openSecret([version, iv, tag, flipped].join(".")), null);
	assert.equal(openSecret("garbage"), null);
	assert.equal(openSecret(null), null);

	process.env.SESSION_SECRET = "another-session-secret-with-at-least-32-chars";
	assert.equal(openSecret(sealed), null);
	process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
});

test("the webhook's token is random, stored as a hash, and checked in constant time", () => {
	const { token, hash } = createWebhookToken();
	assert.notEqual(createWebhookToken().token, token);
	assert.equal(hash, hashWebhookToken(token));
	assert.ok(!hash.includes(token));
	assert.equal(isWebhookToken(token, hash), true);
	assert.equal(isWebhookToken(`${token}x`, hash), false);
	assert.equal(isWebhookToken(token, null), false, "no account, no webhook");
	assert.equal(isWebhookToken("", hash), false);
});

test("referrals name the reader and the exact publication they joined", () => {
	const event = {
		type: "new_partner_pending_referral",
		campaign: { id: "partner_campaign_1", publication_id: "pub_3f9c2a71d0be" },
		subscriber: { id: "sub_1", email: " Jane@Example.COM " },
	};
	assert.deepEqual(readReferral(event), { email: "jane@example.com", publicationUuid: "pub_3f9c2a71d0be" });
	assert.deepEqual(readReferral({ ...event, type: "new_partner_referral" }).email, "jane@example.com");
	assert.deepEqual(readReferral({ ...event, type: "reward_unlocked" }), { skip: "event" });
	assert.deepEqual(readReferral({ ...event, subscriber: { email: "not an email" } }), { skip: "email" });
	assert.deepEqual(readReferral({ ...event, campaign: {} }), { skip: "publication" });
	assert.deepEqual(readReferral(null), { skip: "event" });
});

test("the signup flow opens on pages its visibility rules cover", () => {
	const archive = "https://news.example.com/";
	assert.equal(isShownOn({ all_pages: true, page_rules: [] }, archive), true);
	assert.equal(isShownOn({ all_pages: false, page_rules: ["news.example.com"] }, archive), true);
	assert.equal(isShownOn({ all_pages: false, page_rules: ["https://www.news.example.com/*"] }, "https://news.example.com/p/one"), true);
	assert.equal(isShownOn({ all_pages: false, page_rules: ["https://example.com/newsletter"] }, archive), false);
	assert.equal(isShownOn({ all_pages: false, page_rules: [] }, archive), false);
	assert.equal(isShownOn(undefined, archive), true);
});

test("the script tag names the publication", () => {
	assert.equal(
		getScriptTag("pub_3f9c2a71d0be"),
		'<script async src="https://script.sparkloop.app/embed.js?publication_id=pub_3f9c2a71d0be" data-sparkloop></script>'
	);
});

// Archive forms submit without a page load, often before SparkLoop's script has loaded.
test("a signup before SparkLoop's script is ready opens the flow once it loads, and the wait ends", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const opened = [];
	const sl = { trackSubscriber: (email) => opened.push(email) };
	let hasScript = true;
	globalThis.window = {};
	globalThis.document = { querySelector: (selector) => (hasScript && selector === "script[data-sparkloop]" ? {} : null) };
	t.after(() => {
		delete globalThis.window;
		delete globalThis.document;
	});

	openSignupFlow("maya@example.com");
	t.mock.timers.tick(2_000);
	assert.deepEqual(opened, []);
	globalThis.window.SL = sl;
	t.mock.timers.tick(250);
	assert.deepEqual(opened, ["maya@example.com"]);
	t.mock.timers.tick(5_000);
	assert.deepEqual(opened, ["maya@example.com"]);

	openSignupFlow("sam@example.com");
	assert.deepEqual(opened, ["maya@example.com", "sam@example.com"]);

	globalThis.window.SL = undefined;
	openSignupFlow("lee@example.com");
	t.mock.timers.tick(15_000);
	globalThis.window.SL = sl;
	t.mock.timers.tick(1_000);
	assert.deepEqual(opened, ["maya@example.com", "sam@example.com"]);

	hasScript = false;
	openSignupFlow("kai@example.com");
	t.mock.timers.tick(1_000);
	assert.deepEqual(opened, ["maya@example.com", "sam@example.com"]);
});

test("payouts and countries read like the SparkLoop directory", () => {
	assert.equal(describeOfferPayout({ conversion_type: "lead", commissions: [{ type: "fixed_amount", amount: 2 }] }), "$2 per lead");
	assert.equal(describeOfferPayout({ conversion_type: "action", commissions: [{ type: "percentage", amount: 20 }] }), "20% per sale");
	assert.equal(describeOfferPayout({ commissions: [] }), null);
	assert.equal(describeGeo({ allow_worldwide_referrals: true }), "Worldwide");
	assert.equal(describeGeo({ allow_worldwide_referrals: false, allowed_countries: ["us", "ca", "gb", "au"] }), "US, CA, GB +1");
});
