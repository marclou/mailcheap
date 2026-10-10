import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// The client is server-only. Next resolves that marker with the react-server condition; so does this.
const hooks = `export function resolve(specifier, context, next) {
	return next(specifier, specifier === "server-only" ? { ...context, conditions: [...context.conditions, "react-server"] } : context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { SparkLoopError, createSparkLoop } = await import("../lib/sparkloop.js");

// Each test answers SparkLoop's calls itself and keeps what was asked.
function answer(t, respond) {
	const calls = [];
	t.mock.method(globalThis, "fetch", async (url, init) => {
		calls.push({ url: String(url), ...init });
		return respond(calls.length);
	});
	return calls;
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("calls carry the key in a header, never follow a redirect, and leave out empty filters", async (t) => {
	const calls = answer(t, () => json(200, { offers: [] }));
	const offers = await createSparkLoop("sl_test_key").publication("pub_3f9c2a71d0be").listOffers({ status: "active" });

	assert.deepEqual(offers, { offers: [] });
	assert.equal(
		calls[0].url,
		"https://api.sparkloop.app/v3/publications/pub_3f9c2a71d0be/earn/offers?status=active&expand=stats&per_page=100"
	);
	assert.equal(calls[0].method, "GET");
	assert.equal(calls[0].headers["x-api-key"], "sl_test_key");
	assert.equal(calls[0].redirect, "error");
	assert.equal(calls[0].body, undefined);
});

test("a webhook is created with its fields both ways SparkLoop's docs describe", async (t) => {
	const calls = answer(t, () => json(201, { webhook: { uuid: "wh_1" } }));
	const events = ["new_partner_referral"];
	await createSparkLoop("sl_test_key").createWebhook({ url: "https://mail.example.test/api/webhooks/sparkloop/x", events });

	assert.equal(calls[0].method, "POST");
	assert.match(calls[0].headers["content-type"], /^application\/json/);
	const body = JSON.parse(calls[0].body);
	assert.deepEqual(body, { url: body.url, events, webhook: { url: body.url, events } });
});

test("SparkLoop's errors become short messages, whatever shape they come in", async (t) => {
	const cases = [
		[new Response("", { status: 401 }), "SparkLoop didn't accept the API key", 401],
		[new Response("Retry later", { status: 429 }), "Too many requests to SparkLoop. Try again in a minute.", 429],
		[json(422, { error: " Publication not found " }), "Publication not found", 422],
		[json(400, { error: { code: "bad" } }), "SparkLoop answered 400", 400],
		[new Response("<html>Bad gateway</html>", { status: 502 }), "SparkLoop answered 502", 502],
	];
	const sparkloop = createSparkLoop("sl_test_key");
	for (const [response, message, status] of cases) {
		answer(t, () => response);
		await assert.rejects(sparkloop.getAccount(), (error) => {
			assert.ok(error instanceof SparkLoopError);
			assert.equal(error.message, message);
			assert.equal(error.status, status);
			return true;
		});
		globalThis.fetch.mock.restore();
	}
});

test("an unreachable or slow SparkLoop says so", async (t) => {
	const sparkloop = createSparkLoop("sl_test_key");
	t.mock.method(globalThis, "fetch", async () => {
		throw new TypeError("fetch failed");
	});
	await assert.rejects(sparkloop.getAccount(), { message: "Could not reach SparkLoop", status: 0 });
	globalThis.fetch.mock.restore();

	t.mock.method(globalThis, "fetch", async () => {
		throw new DOMException("The operation timed out.", "TimeoutError");
	});
	await assert.rejects(sparkloop.getAccount(), { message: "SparkLoop took too long to answer", status: 0 });
});

test("ids that don't look like SparkLoop's never reach a URL", (t) => {
	const calls = answer(t, () => json(200, {}));
	const sparkloop = createSparkLoop("sl_test_key");

	for (const value of ["../account", "pub_1/webhooks", "", null, "pub_1?x=1"]) {
		assert.throws(() => sparkloop.publication(value), { message: "Unknown SparkLoop id", status: 400 });
		assert.throws(() => sparkloop.deleteWebhook(value), { message: "Unknown SparkLoop id", status: 400 });
	}
	assert.equal(calls.length, 0);
});
