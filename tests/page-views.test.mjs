import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MAX_VIEW_DAYS, MIN_VIEW_DAYS, toPageViews } from "../lib/report-stats.js";
import { jsonRequest, startTestApp } from "./helpers/app.mjs";

// An issue's page views (lib/page-views.js): the website's beacon counts each reader once a day (app/api/views), in the
// issue's total and in the hour the view came in, and its report charts them day by day since it went on the website.

const NOW = new Date("2026-11-02T15:00:00Z");

test("its days start the day it went on the website, its first month at least, the days to come empty", () => {
	const views = toPageViews({
		campaign: { webViews: 7, startedAt: new Date("2026-10-30T09:00:00Z") },
		rows: [
			{ _id: "2026-10-30", views: 5 },
			{ _id: "2026-11-02", views: 2 },
		],
		timeZone: "UTC",
		now: NOW,
	});
	assert.equal(views.total, 7);
	assert.equal(views.days.length, MIN_VIEW_DAYS);
	assert.deepEqual(views.days.slice(0, 5), [
		{ key: "2026-10-30", views: 5 },
		{ key: "2026-10-31", views: 0 },
		{ key: "2026-11-01", views: 0 },
		{ key: "2026-11-02", views: 2 },
		{ key: "2026-11-03", views: null },
	]);
	assert.equal(views.today, "2026-11-02");
	assert.equal(views.published, "2026-10-30");
	assert.equal(views.since, null);
});

test("views counted before they were by the hour stay in the total, and the days start with the first hour counted", () => {
	const views = toPageViews({
		campaign: { webViews: 650, startedAt: new Date("2026-09-20T09:00:00Z") },
		rows: [
			{ _id: "2026-11-01", views: 40 },
			{ _id: "2026-11-02", views: 10 },
		],
		timeZone: "UTC",
		now: NOW,
	});
	assert.equal(views.total, 650, "with the 600 from before");
	assert.equal(views.days[0].key, "2026-11-01");
	assert.equal(views.since, "2026-11-01");
	assert.equal(views.published, null, "it went out before its first day on the chart");

	const none = toPageViews({ campaign: { webViews: 12, startedAt: new Date("2026-09-20T09:00:00Z") }, rows: [], timeZone: "UTC", now: NOW });
	assert.equal(none.days[0].key, "2026-11-02", "none since: from today");
	assert.equal(none.since, "2026-11-02");
});

test("a page out longer shows its last 90 days, in the reader's timezone", () => {
	const views = toPageViews({
		campaign: { webViews: 3, startedAt: new Date("2026-03-01T09:00:00Z") },
		rows: [
			{ _id: "2026-03-01", views: 1 },
			{ _id: "2026-11-03", views: 2 },
		],
		timeZone: "Asia/Tokyo",
		now: NOW,
	});
	assert.equal(views.days.length, MAX_VIEW_DAYS);
	assert.equal(views.today, "2026-11-03", "already the 3rd in Tokyo");
	assert.deepEqual(views.days.at(-1), { key: "2026-11-03", views: 2 });
	assert.equal(views.total, 3);
	assert.equal(views.published, null);
	assert.equal(views.since, null, "no views from before: the total is the days' and the one before them");
});

describe("the website's beacon", () => {
	let app;
	let m;

	before(async () => {
		app = await startTestApp();
		m = {
			views: await import("../app/api/views/route.js"),
			pageViews: await import("../lib/page-views.js"),
			actions: (await import("../lib/actions/campaigns.js")).campaignActions,
			Campaign: (await import("../models/Campaign.js")).default,
			PageView: (await import("../models/PageView.js")).default,
		};
	});

	after(async () => {
		await app.stop();
	});

	function view(id, { userAgent = "Mozilla/5.0 (Macintosh)", ip = "203.0.113.7", body = { id: String(id) }, type } = {}) {
		const request = jsonRequest("/api/views", { method: "POST", body, headers: { "user-agent": userAgent, "x-forwarded-for": ip } });
		if (type) request.headers.set("content-type", type);
		return m.views.POST(request);
	}

	test("counts a reader's view in the issue's total and in the hour it came in, for its report's days", async () => {
		const accountId = new mongoose.Types.ObjectId();
		const issue = { accountId, newsletterId: new mongoose.Types.ObjectId(), subject: "Club news", status: "sent", sentAt: new Date(), startedAt: new Date() };
		const { _id } = await m.Campaign.create({ ...issue, archiveSlug: "club-news-views" });
		assert.equal((await view(_id)).status, 204);
		await view(_id, { ip: "203.0.113.8" });
		await view(_id, { userAgent: "Googlebot/2.1" });

		const campaign = await m.Campaign.findOne({ accountId, _id }).lean();
		assert.equal(campaign.webViews, 2, "people only");
		const hours = await m.PageView.find({ accountId, campaignId: _id }).lean();
		assert.equal(hours.length, 1);
		assert.equal(hours[0].views, 2);
		assert.equal(hours[0].hour.getTime() % (60 * 60 * 1000), 0, "on the hour");
		const report = await m.pageViews.getPageViews(campaign, "UTC");
		assert.equal(report.total, 2);
		assert.equal(report.days.find(({ key }) => key === report.today).views, 2);
		assert.equal(report.since, null);

		const action = m.actions.find(({ name }) => name === "get_campaign_report");
		const reportOf = async (id) => action.output.parse(await action.handler({ account: { _id: accountId }, input: { id: String(id) } }));
		const { pageViews } = await reportOf(_id);
		assert.deepEqual(pageViews, { total: 2, days: [{ day: report.today, views: 2 }], since: null }, "the API and AI assistants get them too, until today");

		const emailOnly = await m.Campaign.create({ ...issue, archiveSlug: "club-news-email", publishTo: "email" });
		await view(emailOnly._id);
		assert.equal((await m.Campaign.findOne({ accountId, _id: emailOnly._id }).lean()).webViews, 0, "an email-only issue has no page");
		assert.equal(await m.PageView.countDocuments({ accountId, campaignId: emailOnly._id }), 0);
		assert.equal((await reportOf(emailOnly._id)).pageViews, null);
	});

	test("an address counts a few views of a page a day, however many it sends, and only beacons", async () => {
		const accountId = new mongoose.Types.ObjectId();
		const { _id } = await m.Campaign.create({
			accountId,
			newsletterId: new mongoose.Types.ObjectId(),
			subject: "Club news",
			status: "sent",
			sentAt: new Date(),
			archiveSlug: "club-news-limits",
		});
		for (let count = 0; count < 6; count++) assert.equal((await view(_id, { ip: "203.0.113.20" })).status, 204);
		await view(_id, { ip: "203.0.113.21" });
		await view(_id, { ip: "203.0.113.22", type: "text/plain" });
		await view(_id, { ip: "203.0.113.23", body: { id: String(_id), padding: "x".repeat(2_000) } });

		const { webViews } = await m.Campaign.findOne({ accountId, _id }).lean();
		assert.equal(webViews, 4, "3 from the first address, 1 from the next, none from a form post or an oversized body");
		const [hour] = await m.PageView.find({ accountId, campaignId: _id }).lean();
		assert.equal(hour.views, 4);
	});
});
