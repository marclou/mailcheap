import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import { startTestApp, withEnv } from "./helpers/app.mjs";
import { POSTSHIBA, POSTSHIBA_ENV, createFakePostshiba } from "./helpers/postshiba.mjs";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const NOW = new Date("2026-10-17T12:00:00Z");

let app;
let fake;
let m;

async function render(capacity) {
	return renderToStaticMarkup(await m.CardSendingCapacity({ capacity: Promise.resolve(capacity) }));
}

before(async () => {
	app = await startTestApp(POSTSHIBA_ENV);
	fake = createFakePostshiba();
	fake.install();
	m = {
		capacity: await import("../lib/sending-capacity.js"),
		CardSendingCapacity: (await import("../components/CardSendingCapacity.jsx")).default,
	};
	const campaignId = new mongoose.Types.ObjectId();
	const email = (kind, sentAgoMs, fields = {}) => ({
		accountId: new mongoose.Types.ObjectId(),
		newsletterId: new mongoose.Types.ObjectId(),
		campaignId,
		contactId: new mongoose.Types.ObjectId(),
		kind,
		email: "reader@example.org",
		status: "sent",
		sentAt: new Date(NOW.getTime() - sentAgoMs),
		...fields,
	});
	await mongoose.connection.db.collection("messages").insertMany([
		...Array.from({ length: 3 }, () => email("campaign", 10 * MINUTE_MS)),
		email("last-chance", 30 * MINUTE_MS),
		...Array.from({ length: 2 }, () => email("campaign", 5 * HOUR_MS)),
		email("campaign", 25 * HOUR_MS),
		email("campaign", 0, { status: "queued", sentAt: undefined }),
		email("welcome", 20 * MINUTE_MS),
		email("test", 50 * MINUTE_MS),
		email("confirmation", 3 * HOUR_MS),
	]);
});

after(() => app?.stop());

test("two clusters: campaigns and every other email, each against its own caps, from what went out in the last hour and 24 hours", async () => {
	const capacity = await m.capacity.getSendingCapacity({ now: NOW, fresh: true });
	assert.deepEqual(capacity, {
		lanes: [
			{
				label: "Campaigns",
				status: null,
				meters: [
					{ label: "Last hour", used: 4, cap: 40_000 },
					{ label: "Last 24 hours", used: 6, cap: 240_000 },
				],
				perSecond: null,
			},
			{
				label: "Signup and test emails",
				status: null,
				meters: [
					{ label: "Last hour", used: 2, cap: 4000 },
					{ label: "Last 24 hours", used: 3, cap: 24_000 },
				],
				perSecond: null,
			},
		],
	});

	const html = await render(capacity);
	assert.match(html, /Sending capacity/);
	assert.match(html, /Signup and test emails/);
	assert.match(html, /aria-valuetext="6 of 240,000"/);
	assert.doesNotMatch(html, new RegExp(`PostShiba|\\bSES\\b|tenant|cluster|${POSTSHIBA.bulkClusterId}|${POSTSHIBA.transactionalClusterId}`, "i"));
});

test("one cluster carries every email", async () => {
	const capacity = await withEnv({ POSTSHIBA_TRANSACTIONAL_CLUSTER_ID: "" }, () => m.capacity.getSendingCapacity({ now: NOW, fresh: true }));
	assert.deepEqual(
		capacity.lanes.map(({ label, meters }) => [label, meters.map(({ used, cap }) => [used, cap])]),
		[["All emails", [[6, 40_000], [9, 240_000]]]]
	);
});

test("a cluster that can't send says so", async () => {
	const transactional = fake.state.clusters.get(POSTSHIBA.transactionalClusterId);
	const bulk = fake.state.clusters.get(POSTSHIBA.bulkClusterId);
	Object.assign(transactional, { sending_ready: false });
	Object.assign(bulk, { status: "suspended" });
	try {
		const { lanes } = await m.capacity.getSendingCapacity({ now: NOW, fresh: true });
		assert.deepEqual(
			lanes.map(({ status }) => status),
			[
				{ status: "blocked", label: "Suspended" },
				{ status: "paused", label: "Not ready" },
			]
		);
	} finally {
		Object.assign(transactional, { sending_ready: true });
		Object.assign(bulk, { status: "active" });
	}
});

test("when the provider can't be read, the card says so quietly, without its words", async () => {
	fake.fail({ method: "GET", path: /\/clusters\//, status: 500, body: { error: "boom" } });
	const capacity = await m.capacity.getSendingCapacity({ now: NOW, fresh: true });
	assert.deepEqual(capacity, { error: "unreadable" });
	const html = await render(capacity);
	assert.match(html, /Unavailable right now/);
	assert.doesNotMatch(html, /PostShiba|boom|500/);

	const unconfigured = await withEnv({ POSTSHIBA_API_KEY: "" }, () => m.capacity.getSendingCapacity({ now: NOW, fresh: true }));
	assert.deepEqual(unconfigured, { error: "unconfigured" });
});

test("SES: its own count against its daily quota, with its rate", async () => {
	const capacity = await withEnv({ EMAIL_PROVIDER: "ses" }, () => m.capacity.getSendingCapacity({ now: NOW, fresh: true }));
	assert.deepEqual(capacity, {
		lanes: [{ label: "All emails", status: null, meters: [{ label: "Last 24 hours", used: 0, cap: 50_000 }], perSecond: 14 }],
	});
	assert.match(await render(capacity), /Up to 14 a second/);
});
