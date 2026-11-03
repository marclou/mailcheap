import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChartHover from "../components/ChartHover.jsx";
import ChartSends from "../components/ChartSends.jsx";
import ChartSubscribers from "../components/ChartSubscribers.jsx";
import ButtonPeriod from "../components/ButtonPeriod.jsx";
import ListStats from "../components/ListStats.jsx";
import { TooltipProvider } from "../components/ui/tooltip.jsx";
import { linePath, niceScale } from "../lib/charts.js";
import { formatChange, formatHour, formatSigned } from "../lib/format.js";
import {
	MAX_RANGE_DAYS,
	PERIODS,
	PERIOD_DAYS,
	buildHourlySeries,
	buildSendBars,
	buildSubscriberSeries,
	compareCount,
	compareRate,
	getBarUnit,
	getPeriod,
	getPeriodDays,
	getPeriodPoints,
	getRangePeriod,
	periodDayKeys,
	readPeriod,
	splitPeriods,
} from "../lib/overview-series.js";
import {
	countDateKeys,
	formatDateKeyRange,
	hourIn,
	readDateKey,
	resolveTimeZone,
	shiftDateKey,
	startOfDateKey,
	timeZoneLabel,
	toDateKey,
} from "../lib/time-zone.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// The x labels ChartFrame draws under a chart, by their text: the classes that hide some on small screens.
function readXLabels(html) {
	const labels = html.matchAll(/<span class="absolute top-0 leading-none whitespace-nowrap ?([^"]*)" style="([^"]*)">([^<]+)<\/span>/g);
	return [...labels].map(([, className, , label]) => [label, className]);
}

// A list without anyone joining or leaving, over the period ending on today's key, split as the overview splits it.
function quietPeriods(todayKey, days) {
	return splitPeriods(buildSubscriberSeries({ dayKeys: periodDayKeys(todayKey, days), baseline: 10 }), days);
}

function findElement(node, type) {
	if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean) ?? null;
	if (!node || typeof node !== "object") return null;
	return node.type === type ? node : findElement(node.props?.children, type);
}

test("days and hours follow the timezone, DST included", () => {
	const lateEvening = new Date("2026-10-07T21:30:00Z");
	assert.equal(toDateKey(lateEvening, "UTC"), "2026-10-07");
	assert.equal(toDateKey(lateEvening, "Asia/Nicosia"), "2026-10-08");
	assert.equal(hourIn(lateEvening, "Asia/Nicosia"), 0);
	assert.equal(startOfDateKey("2026-10-08", "Asia/Nicosia").toISOString(), "2026-10-07T21:00:00.000Z");
	// Paris leaves summer time on Oct 25, 2026.
	assert.equal(startOfDateKey("2026-10-25", "Europe/Paris").toISOString(), "2026-10-24T22:00:00.000Z");
	assert.equal(startOfDateKey("2026-10-26", "Europe/Paris").toISOString(), "2026-10-25T23:00:00.000Z");
	assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
	assert.equal(timeZoneLabel("Asia/Nicosia", lateEvening), "GMT+3");
	assert.equal(timeZoneLabel("UTC"), "UTC");
});

test("an unknown or missing timezone cookie falls back to UTC", () => {
	assert.equal(resolveTimeZone("Asia/Nicosia"), "Asia/Nicosia");
	assert.equal(resolveTimeZone("Not/A_Zone"), "UTC");
	assert.equal(resolveTimeZone(undefined), "UTC");
});

test("the subscriber curve starts from the earlier events and splits into two periods", () => {
	const dayKeys = periodDayKeys("2026-10-08", 2);
	assert.deepEqual(dayKeys, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);

	const series = buildSubscriberSeries({
		dayKeys,
		baseline: 100,
		joins: { "2026-10-01": 5, "2026-10-07": 3 },
		leaves: { "2026-10-06": 1, "2026-10-09": 2 },
	});
	assert.equal(series.start, 105);
	assert.deepEqual(
		series.days.map(({ total }) => total),
		[105, 104, 107, 107]
	);

	const periods = splitPeriods(series, 2);
	assert.equal(periods.total, 107);
	assert.equal(periods.growth, 3);
	assert.equal(periods.previousGrowth, -1);
	assert.deepEqual(
		periods.current.map(({ key }) => key),
		["2026-10-07", "2026-10-08"]
	);
});

test("?days= picks one of the overview's periods; anything else, or nothing, the last 30 days", () => {
	assert.deepEqual(
		PERIODS.map(({ days, label }) => `${days}: ${label}`),
		["1: Last 24 hours", "7: Last 7 days", "30: Last 30 days", "90: Last 90 days", "365: Last 12 months"]
	);
	assert.equal(PERIOD_DAYS, 30);
	assert.equal(getPeriod("90").days, 90);
	assert.equal(getPeriod(365).span, "12 months");
	assert.equal(getPeriod("1").span, "24 hours");
	for (const value of [undefined, "", "14", "07", "30.5", "abc", ["7", "90"]]) assert.equal(getPeriod(value).days, PERIOD_DAYS, String(value));
});

test("?from= and ?to= pick a custom range of whole days, up to today and 12 months long, else ?days= decides", () => {
	const today = "2026-11-02";
	assert.deepEqual(readPeriod({ from: "2026-10-01", to: "2026-10-15" }, today), {
		days: 15,
		span: "15 days",
		label: "Oct 1 – Oct 15, 2026",
		from: "2026-10-01",
		to: "2026-10-15",
	});
	assert.equal(readPeriod({ from: "2025-12-20", to: "2026-01-05" }, today).label, "Dec 20, 2025 – Jan 5, 2026");
	assert.deepEqual(readPeriod({ from: today, to: today }, today), { days: 1, span: "1 day", label: "Nov 2, 2026", from: today, to: today });
	assert.equal(MAX_RANGE_DAYS, 365);
	assert.equal(readPeriod({ from: shiftDateKey(today, 1 - MAX_RANGE_DAYS), to: today }, today).days, 365, "12 months at most");

	const refused = [
		{ from: "2026-10-01" },
		{ from: "2026-10-15", to: "2026-10-01" },
		{ from: "2026-10-01", to: "2026-11-03" },
		{ from: "2026-02-30", to: "2026-03-01" },
		{ from: shiftDateKey(today, -MAX_RANGE_DAYS), to: today },
		{ from: ["2026-10-01"], to: "2026-10-15" },
	];
	for (const params of refused) assert.equal(readPeriod({ ...params, days: "90" }, today).label, "Last 90 days", JSON.stringify(params));
	assert.equal(readPeriod({}, today).label, "Last 30 days");

	assert.deepEqual(getPeriodDays(getPeriod(7), today), { from: "2026-10-27", to: today }, "the last days end today");
	assert.deepEqual(getPeriodDays(getRangePeriod("2026-10-01", "2026-10-15"), today), { from: "2026-10-01", to: "2026-10-15" });
	assert.equal(countDateKeys("2026-02-27", "2026-03-01"), 3);
	assert.equal(countDateKeys("2028-02-27", "2028-03-01"), 4, "a leap year's February 29 counts");
	assert.equal(readDateKey("2026-10-01"), "2026-10-01");
	assert.equal(readDateKey(" 2026-10-01"), null);
	assert.equal(formatDateKeyRange("2026-10-01", "2026-10-01"), "Oct 1, 2026");
});

test("the subscriber chart's dates spread out with the period, every other one only on wider screens", () => {
	const labels = (days) => readXLabels(renderToStaticMarkup(createElement(ChartSubscribers, quietPeriods("2026-11-02", days))));
	const week = labels(7);
	assert.deepEqual(
		week.map(([label]) => label),
		["Nov 2", "Nov 1", "Oct 31", "Oct 30", "Oct 29", "Oct 28", "Oct 27"],
		"each day of a week"
	);
	assert.deepEqual(
		week.map(([, className]) => className),
		["", "hidden sm:block", "", "hidden sm:block", "", "hidden sm:block", ""]
	);
	assert.deepEqual(labels(30).map(([label]) => label), ["Nov 2", "Oct 26", "Oct 19", "Oct 12", "Oct 5"], "a week apart");
	assert.deepEqual(labels(90).map(([label]) => label), ["Nov 2", "Oct 12", "Sep 21", "Aug 31", "Aug 10"], "3 weeks apart");
	assert.deepEqual(labels(365).map(([label]) => label), ["Nov 2", "Aug 24", "Jun 15", "Apr 6", "Jan 26", "Nov 17, 2025"], "10 weeks apart, a year ago's with its year");
});

test("over 12 months, the chart's dates of another year say which", () => {
	const year = quietPeriods("2026-11-02", 365);
	const html = renderToStaticMarkup(createElement(ChartSubscribers, year));
	assert.match(html, /aria-label="Subscribers from Nov 3, 2025 to Nov 2: 10 to 10"/);
	const { points } = findElement(ChartSubscribers(year), ChartHover).props;
	assert.equal(points.length, 365);
	assert.equal(points[0].title, "Mon, Nov 3, 2025");
	assert.deepEqual(points[0].rows.at(-1), { label: "Nov 3, 2024", value: "10", swatch: "dashed" }, "the same day of the period before");
	assert.equal(points.at(-1).title, "Mon, Nov 2");
	assert.equal(points.at(-1).rows.at(-1).label, "Nov 2, 2025");

	const { points: month } = findElement(ChartSubscribers(quietPeriods("2026-11-02", 30)), ChartHover).props;
	assert.equal(month[0].title, "Sun, Oct 4");
	assert.equal(month[0].rows.at(-1).label, "Sep 4");
});

test("the email stats name the period, and its button says which it is", () => {
	const stats = { sent: 1000, delivered: 990, opened: 420, clicked: 61, bounced: 4, complained: 0 };
	const list = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ListStats, { current: stats, previous: stats, span: "12 months" })));
	assert.match(list, /<span class="sr-only"> \(1,000 in the previous 12 months\)<\/span>/);

	const button = (period) => renderToStaticMarkup(createElement(ButtonPeriod, { period, todayKey: "2026-11-02" }));
	const preset = button(getPeriod(90));
	assert.match(preset, /^<button\b[^>]*data-variant="outline"[^>]*>/, "a regular outline button");
	assert.match(preset, /aria-haspopup="dialog"/);
	assert.doesNotMatch(preset, /data-pending/, "the numbers fade only while another period loads");
	assert.equal(preset.replace(/<[^>]+>/g, ""), "Last 90 days");
	assert.equal(button(getRangePeriod("2026-10-01", "2026-10-15")).replace(/<[^>]+>/g, ""), "Oct 1 – Oct 15, 2026");
});

test("one value draws a flat line across the chart", () => {
	assert.equal(linePath([5], { min: 0, max: 10 }, { width: 100, height: 50 }), "M0,25L100,25");
});

test("hours still to come today have no bar, yesterday's always do", () => {
	const hours = buildHourlySeries({
		rows: [
			{ day: "2026-10-08", hour: 9, count: 5 },
			{ day: "2026-10-07", hour: 9, count: 7 },
			{ day: "2026-10-07", hour: 20, count: 2 },
		],
		todayKey: "2026-10-08",
		currentHour: 16,
	});
	assert.equal(hours.length, 24);
	assert.deepEqual(hours[9], { hour: 9, today: 5, yesterday: 7 });
	assert.deepEqual(hours[16], { hour: 16, today: 0, yesterday: 0 });
	assert.deepEqual(hours[20], { hour: 20, today: null, yesterday: 2 });
});

test("the last 24 hours go hour by hour up to now's, next to the 24 before; a day or two too, the rest day by day", () => {
	const now = new Date("2026-11-02T14:20:00Z");
	const points = (period, timeZone = "UTC") => getPeriodPoints(period, { timeZone, now });

	const day = points(getPeriod(1));
	assert.equal(day.unit, "hour");
	assert.deepEqual([day.previous[0], day.previous.at(-1), day.current[0], day.current.at(-1)], ["2026-10-31 15", "2026-11-01 14", "2026-11-01 15", "2026-11-02 14"]);
	assert.deepEqual([day.previous.length, day.current.length], [24, 24]);
	assert.deepEqual([day.start.toISOString(), day.end.toISOString()], ["2026-10-31T15:00:00.000Z", "2026-11-02T15:00:00.000Z"]);
	const india = points(getPeriod(1), "Asia/Kolkata");
	assert.equal(india.current.at(-1), "2026-11-02 19", "7:50 PM there");
	assert.equal(india.end.toISOString(), "2026-11-02T14:30:00.000Z", "its hours start on the half hour");

	const today = points(getRangePeriod("2026-11-02", "2026-11-02"));
	assert.deepEqual([today.previous.length, today.current.length], [15, 15], "today stops at this hour, next to the same hours of yesterday");
	assert.deepEqual([today.previous[0], today.current.at(-1)], ["2026-11-01 00", "2026-11-02 14"]);
	const paris = points(getRangePeriod("2026-10-24", "2026-10-25"), "Europe/Paris");
	assert.deepEqual([paris.previous.length, paris.current.length], [48, 48], "the night clocks go back, its 2 AM counts once");
	assert.equal(paris.current.filter((key) => key === "2026-10-25 02").length, 1);

	const month = points(getPeriod(30));
	assert.equal(month.unit, "day");
	assert.deepEqual([month.previous.length, month.current.length, month.current.at(-1)], [30, 30, "2026-11-02"]);
	assert.equal(month.end, now);
	assert.equal(points(getRangePeriod("2026-10-01", "2026-10-03")).unit, "day");
});

test("the emails sent chart has a bar for each hour or day, each 7 days past a month, each month past half a year", () => {
	const now = new Date("2026-11-02T14:20:00Z");
	const chart = (period) => {
		const points = getPeriodPoints(period, { timeZone: "UTC", now });
		const counts = { previous: points.previous.map(() => 1), current: points.current.map(() => 2) };
		return { unit: getBarUnit(points), bars: buildSendBars(points, counts) };
	};
	const summary = ({ first, last, sent, previousSent }) => `${first}…${last}: ${sent} vs ${previousSent}`;

	const day = chart(getPeriod(1));
	assert.deepEqual([day.unit, day.bars.length, summary(day.bars.at(-1))], ["hour", 24, "2026-11-02 14…2026-11-02 14: 2 vs 1"]);
	const week = chart(getPeriod(7));
	assert.deepEqual([week.unit, week.bars.length, summary(week.bars[0])], ["day", 7, "2026-10-27…2026-10-27: 2 vs 1"]);
	assert.equal(chart(getPeriod(30)).bars.length, 30);

	const quarter = chart(getPeriod(90));
	assert.deepEqual([quarter.unit, quarter.bars.length], ["week", 13]);
	assert.deepEqual([summary(quarter.bars[0]), summary(quarter.bars.at(-1))], ["2026-08-05…2026-08-11: 14 vs 7", "2026-10-28…2026-11-02: 12 vs 6"]);

	const year = chart(getPeriod(365));
	assert.deepEqual([year.unit, year.bars.length], ["month", 13]);
	assert.deepEqual(
		[summary(year.bars[0]), summary(year.bars[1]), summary(year.bars.at(-1))],
		["2025-11-03…2025-11-30: 56 vs 28", "2025-12-01…2025-12-31: 62 vs 31", "2026-11-01…2026-11-02: 4 vs 2"]
	);
	assert.equal(year.bars[1].previousFirst, "2024-12-01", "the same days of the year before");
});

test("the emails sent chart says when each bar is, Now under the last hour of a period ending now", () => {
	const now = new Date("2026-11-02T14:20:00Z");
	const render = (period, isLive = !period.from) => {
		const points = getPeriodPoints(period, { timeZone: "UTC", now });
		const counts = { previous: points.previous.map(() => 1), current: points.current.map(() => 2) };
		const props = { bars: buildSendBars(points, counts), unit: getBarUnit(points), isLive };
		return { labels: readXLabels(renderToStaticMarkup(createElement(ChartSends, props))), points: findElement(ChartSends(props), ChartHover).props.points };
	};

	const day = render(getPeriod(1));
	assert.deepEqual(day.labels, [
		["6 PM", ""],
		["Nov 2", ""],
		["6 AM", ""],
		["12 PM", "hidden lg:block"],
		["Now", "font-medium text-emerald-600 dark:text-emerald-400"],
	]);
	assert.equal(day.points.at(-1).title, "Mon, Nov 2, 2 PM – 3 PM");
	assert.deepEqual(day.points.at(-1).rows, [
		{ label: "Sent", value: "2", swatch: "bar" },
		{ label: "Sun, Nov 1, 2 PM", value: "1", swatch: "ghost" },
	]);
	assert.deepEqual(render(getRangePeriod("2026-10-15", "2026-10-15")).labels.map(([label]) => label), ["Oct 15", "6 AM", "12 PM", "6 PM"], "no Now in the past");

	const month = render(getPeriod(30));
	assert.deepEqual(month.labels.map(([label]) => label), ["Nov 2", "Oct 26", "Oct 19", "Oct 12", "Oct 5"]);
	assert.equal(month.points[0].title, "Sun, Oct 4");

	const year = render(getPeriod(365));
	assert.deepEqual(year.labels.map(([label]) => label), ["Nov", "Sep", "Jul", "May", "Mar", "Jan", "Nov 2025"]);
	assert.deepEqual(
		[year.points[0].title, year.points[1].title, year.points.at(-1).title],
		["Nov 3 – Nov 30, 2025", "December 2025", "Nov 1 – Nov 2, 2026"]
	);
});

test("over a day or two, the subscriber chart goes hour by hour", () => {
	const now = new Date("2026-11-02T14:20:00Z");
	const points = getPeriodPoints(getPeriod(1), { timeZone: "UTC", now });
	const series = splitPeriods(buildSubscriberSeries({ dayKeys: [...points.previous, ...points.current], baseline: 10 }), points.previous.length);
	assert.deepEqual(
		readXLabels(renderToStaticMarkup(createElement(ChartSubscribers, series))),
		[
			["12 PM", ""],
			["6 AM", "hidden sm:block"],
			["Nov 2", ""],
			["6 PM", "hidden sm:block"],
		]
	);
	const hover = findElement(ChartSubscribers(series), ChartHover).props.points;
	assert.equal(hover.at(-1).title, "Mon, Nov 2, 2 PM");
	assert.equal(hover.at(-1).rows.at(-1).label, "Nov 1, 2 PM");
});

test("changes need something to compare with; rates change by their difference, shown in %", () => {
	assert.equal(compareCount(12, 0), null);
	assert.equal(compareCount(15, 10), 50);
	assert.equal(compareRate(1, 0, 1, 10), null);
	assert.ok(Math.abs(compareRate(99, 100, 98, 100) - 1) < 1e-9);
	assert.equal(formatChange(8.4), "+8%");
	assert.equal(formatChange(compareRate(391, 1000, 418, 1000), { digits: 1 }), "−2.7%");
	assert.equal(formatChange(-0.24, { digits: 1 }), "−0.2%");
	assert.equal(formatChange(0.004, { digits: 1 }), "0.0%");
	assert.equal(formatChange(null), null);
	assert.equal(formatSigned(1204), "+1,204");
	assert.equal(formatSigned(-32), "−32");
	assert.equal(formatSigned(0), "0");
	assert.equal(formatHour(0), "12 AM");
	assert.equal(formatHour(14), "2 PM");
});

test("chart axes round to readable steps around the data", () => {
	const scale = niceScale([2187, 2350]);
	assert.equal(scale.min, 2100);
	assert.equal(scale.max, 2400);
	assert.equal(scale.ticks[1], 2200);
	assert.deepEqual(niceScale([5, 5]).ticks, [4, 5, 6]);
	assert.deepEqual(niceScale([]).ticks, [0, 1]);
	assert.equal(linePath([0, 10], { min: 0, max: 10 }, { width: 100, height: 50 }), "M0,50L100,0");
});

describe("the overview's period", () => {
	const DAY_MS = 86_400_000;
	const HOUR_MS = 3_600_000;
	// Readers who joined that many days ago, and the emails of issues sent that many days ago.
	const JOINED = { 3: 2, 20: 3, 50: 4, 120: 5, 400: 6 };
	const ISSUES = { 20: 100, 50: 50 };
	let app;
	let m;
	let user;
	let key;

	function daysAgo(days) {
		return new Date(Date.now() - days * DAY_MS);
	}

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			overviewPage: await import("../app/(app)/(overview)/page.js"),
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
		user = await signIn("overview-period@example.com");
		await activate(user);
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Period news", slug: "period-news", postalAddress: "1 Main St, Paris" })))
		);
		const newsletterId = new mongoose.Types.ObjectId(url.split("/").at(-1));
		let reader = 0;
		await m.Contact.collection.insertMany(
			Object.entries(JOINED).flatMap(([days, count]) =>
				Array.from({ length: count }, () => {
					const joinedAt = daysAgo(Number(days));
					return { accountId: user.accountId, newsletterId, email: `reader${++reader}@example.org`, status: "active", subscribedAt: joinedAt, createdAt: joinedAt, updatedAt: joinedAt };
				})
			)
		);
		await m.Campaign.collection.insertMany(
			Object.entries(ISSUES).map(([days, sent]) => ({
				accountId: user.accountId,
				newsletterId,
				subject: `Sent ${days} days ago`,
				status: "sent",
				startedAt: daysAgo(Number(days)),
				sentAt: daysAgo(Number(days)),
				stats: { sent, delivered: sent, opened: sent / 2, clicked: sent / 10, bounced: 0, complained: 0 },
			}))
		);
		// The last two days, hour by hour: a reader who joined 5 hours ago, an issue that reached 3 readers 2 hours ago,
		// and a welcome email 30 hours ago.
		const hoursAgo = (hours) => new Date(Date.now() - hours * HOUR_MS);
		const { accountId } = user;
		await m.Contact.collection.insertOne({ accountId, newsletterId, email: `reader${++reader}@example.org`, status: "active", subscribedAt: hoursAgo(5), createdAt: hoursAgo(5) });
		const { insertedId: campaignId } = await m.Campaign.collection.insertOne({
			accountId,
			newsletterId,
			subject: "Sent 2 hours ago",
			status: "sent",
			startedAt: hoursAgo(2),
			sentAt: hoursAgo(2),
			stats: { sent: 3, delivered: 3, opened: 1, clicked: 0, bounced: 0, complained: 0 },
		});
		await m.Message.collection.insertMany([
			...Array.from({ length: 3 }, (_, index) => ({
				accountId,
				newsletterId,
				campaignId,
				contactId: new mongoose.Types.ObjectId(),
				kind: "campaign",
				email: `issue${index}@example.org`,
				status: "sent",
				sentAt: hoursAgo(2),
				createdAt: hoursAgo(2),
			})),
			{ accountId, newsletterId, kind: "welcome", email: "welcome@example.org", status: "sent", sentAt: hoursAgo(30), createdAt: hoursAgo(30) },
		]);
		key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	});

	after(() => app?.stop());

	// Days in UTC, the API's timezone without one, counted back from today.
	function dayAgo(days) {
		return shiftDateKey(toDateKey(new Date(), "UTC"), -days);
	}

	async function readOverview(query = "") {
		const response = await callApi("GET", `/api/v1/overview${query}`, { key });
		assert.equal(response.status, 200, JSON.stringify(response.body));
		const { days, from, to, subscribers, emails, sends } = response.body;
		return {
			days,
			range: [from, to],
			dayCount: subscribers.days.length,
			growth: [subscribers.growth, subscribers.previousGrowth],
			total: subscribers.total,
			sent: [emails.current.sent, emails.previous.sent],
			sends: [sends.per, sends.bars.length, sends.total, sends.previousTotal],
		};
	}

	async function readRefusal(query) {
		const response = await callApi("GET", `/api/v1/overview${query}`, { key });
		assert.equal(response.status, 400, query);
		assert.equal(response.body.error.code, "validation_failed", query);
		return response.body.error.message;
	}

	test("get_overview takes the period in days, 30 without it, and compares it with as many days before", async () => {
		const upToToday = (days) => [dayAgo(days - 1), dayAgo(0)];
		assert.deepEqual(await readOverview(), {
			days: 30,
			range: upToToday(30),
			dayCount: 30,
			growth: [6, 4],
			total: 21,
			sent: [104, 50],
			sends: ["day", 30, 104, 50],
		});
		assert.deepEqual(await readOverview("?days=7"), {
			days: 7,
			range: upToToday(7),
			dayCount: 7,
			growth: [3, 0],
			total: 21,
			sent: [4, 0],
			sends: ["day", 7, 4, 0],
		});
		assert.deepEqual(await readOverview("?days=90"), {
			days: 90,
			range: upToToday(90),
			dayCount: 90,
			growth: [10, 5],
			total: 21,
			sent: [154, 0],
			sends: ["week", 13, 154, 0],
		});
		const year = await readOverview("?days=365");
		assert.deepEqual({ ...year, sends: year.sends.filter((_, index) => index !== 1) }, {
			days: 365,
			range: upToToday(365),
			dayCount: 365,
			growth: [15, 6],
			total: 21,
			sent: [154, 0],
			sends: ["month", 154, 0],
		});
		assert.ok([12, 13].includes(year.sends[1]), "a month each, the first and last in part");

		for (const days of ["14", "0", "abc"]) await readRefusal(`?days=${days}`);
	});

	test("the last 24 hours go hour by hour: who joined, and each email when it went out", async () => {
		const day = await readOverview("?days=1");
		assert.deepEqual({ ...day, range: day.range[1] }, {
			days: 1,
			range: dayAgo(0),
			dayCount: 24,
			growth: [1, 0],
			total: 21,
			sent: [3, 1],
			sends: ["hour", 24, 3, 1],
		});
		assert.ok([dayAgo(1), dayAgo(0)].includes(day.range[0]), "from the same hour yesterday");
		const { body } = await callApi("GET", "/api/v1/overview?days=1", { key });
		assert.match(body.subscribers.days[0].date, /^\d{4}-\d{2}-\d{2} \d{2}$/);
		assert.equal(body.sends.bars.find(({ sent }) => sent).sent, 3, "all in the hour they went out");
	});

	test("or a custom range, from and to, whose subscribers and emails stop on its last day", async () => {
		// The 50 days before the last 10: the issues of 20 and 50 days ago, and who joined then, but not 3 days ago.
		assert.deepEqual(await readOverview(`?from=${dayAgo(59)}&to=${dayAgo(10)}`), {
			days: 50,
			range: [dayAgo(59), dayAgo(10)],
			dayCount: 50,
			growth: [7, 0],
			total: 18,
			sent: [150, 0],
			sends: ["week", 8, 150, 0],
		});
		// 20 days, after the 20 before them: the issue of 50 days ago, and who joined then, in the period before.
		assert.deepEqual(await readOverview(`?from=${dayAgo(30)}&to=${dayAgo(11)}`), {
			days: 20,
			range: [dayAgo(30), dayAgo(11)],
			dayCount: 20,
			growth: [3, 4],
			total: 18,
			sent: [100, 50],
			sends: ["day", 20, 100, 50],
		});

		assert.equal(await readRefusal(`?from=${dayAgo(10)}`), "Give both from and to");
		assert.equal(await readRefusal("?from=2026-02-30&to=2026-03-01"), "from and to should be days, like 2026-10-01");
		assert.equal(await readRefusal(`?from=${dayAgo(5)}&to=${dayAgo(6)}`), "from should be on or before to");
		assert.equal(await readRefusal(`?from=${dayAgo(1)}&to=${dayAgo(-1)}`), "to can't be after today");
		assert.equal(await readRefusal(`?from=${dayAgo(400)}&to=${dayAgo(0)}`), "A period can be up to 365 days");
		assert.equal(await readRefusal(`?days=7&from=${dayAgo(5)}&to=${dayAgo(0)}`), "Give days, or from and to");
	});

	test("the dashboard's overview names its period on a button at the top, the last 30 days unless the address picks another", async () => {
		const label = async (searchParams) => {
			const page = await as(user, () => m.overviewPage.default({ searchParams: Promise.resolve(searchParams) }));
			const header = renderToStaticMarkup(createElement(TooltipProvider, null, page)).match(/<header\b[\s\S]*?<\/header>/)[0];
			return header.match(/<button\b[^>]*aria-haspopup="dialog"[^>]*>([\s\S]*?)<\/button>/)?.[1].replace(/<[^>]+>/g, "");
		};
		assert.equal(await label({ days: "365" }), "Last 12 months");
		assert.equal(await label({ days: "7" }), "Last 7 days");
		assert.equal(await label({}), "Last 30 days");
		assert.equal(await label({ days: "14" }), "Last 30 days");
		assert.equal(await label({ from: dayAgo(59), to: dayAgo(10) }), formatDateKeyRange(dayAgo(59), dayAgo(10)));
		assert.equal(await label({ from: dayAgo(10), to: dayAgo(59) }), "Last 30 days", "a range out of order");
	});
});
