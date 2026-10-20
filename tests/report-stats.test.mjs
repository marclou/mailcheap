import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPoints, formatWeekdayHour } from "../lib/format.js";
import { COMPARED_ISSUES, TIMELINE_HOURS, buildTimeline, compareRates, findPeak, hoursToHalf } from "../lib/report-stats.js";

const START = new Date("2026-10-13T09:20:00Z");
const hour = (offset) => new Date(Date.UTC(2026, 9, 13, 9 + offset));

test("opens and clicks land in the clock hour they came in, from the hour the send started", () => {
	const timeline = buildTimeline({
		startedAt: START,
		now: new Date("2026-10-13T12:05:00Z"),
		opens: [
			{ _id: hour(0), count: 40 },
			{ _id: hour(1), count: 25 },
			{ _id: hour(3), count: 3 },
		],
		clicks: [{ _id: hour(1), count: 6 }],
	});
	assert.equal(timeline.start.toISOString(), "2026-10-13T09:00:00.000Z");
	assert.equal(timeline.hours.length, 24, "a fresh send still shows its first day");
	assert.deepEqual(
		timeline.hours.slice(0, 5).map(({ opens, clicks, isFuture }) => [opens, clicks, isFuture]),
		[
			[40, 0, false],
			[25, 6, false],
			[0, 0, false],
			[3, 0, false],
			[0, 0, true],
		]
	);
	assert.deepEqual(timeline.later, { opens: 0, clicks: 0 });
});

test("an older send shows its first three days and sums what came after", () => {
	const timeline = buildTimeline({
		startedAt: START,
		now: new Date("2026-10-20T00:00:00Z"),
		opens: [
			{ _id: hour(2), count: 10 },
			{ _id: hour(TIMELINE_HOURS - 1), count: 1 },
			{ _id: hour(TIMELINE_HOURS), count: 4 },
			{ _id: hour(150), count: 2 },
		],
		clicks: [{ _id: hour(100), count: 1 }],
	});
	assert.equal(timeline.hours.length, TIMELINE_HOURS);
	assert.equal(timeline.hours.at(-1).opens, 1);
	assert.ok(timeline.hours.every(({ isFuture }) => !isFuture));
	assert.deepEqual(timeline.later, { opens: 6, clicks: 1 });
});

test("an event stamped before the send started counts in its first hour", () => {
	const timeline = buildTimeline({ startedAt: START, now: hour(5), opens: [{ _id: hour(-2), count: 2 }] });
	assert.equal(timeline.hours[0].opens, 2);
});

test("the peak is the hour with the most opens, the earliest of equals, and none without opens", () => {
	assert.equal(findPeak([{ opens: 3 }, { opens: 9 }, { opens: 9 }, { opens: 1 }]), 1);
	assert.equal(findPeak([{ opens: 0 }, { opens: 0 }]), null);
});

test("half of the opens is counted with the ones after the timeline", () => {
	const hours = [{ opens: 30 }, { opens: 20 }, { opens: 10 }];
	assert.equal(hoursToHalf({ hours, later: { opens: 0 } }), 1);
	assert.equal(hoursToHalf({ hours, later: { opens: 40 } }), 2);
	assert.equal(hoursToHalf({ hours, later: { opens: 100 } }), null, "half came after the chart's last hour");
	assert.equal(hoursToHalf({ hours: [{ opens: 0 }], later: { opens: 0 } }), null);
});

test("rates compare with the earlier issues pooled, so a tiny send barely moves the average", () => {
	const comparison = compareRates({ sent: 100, delivered: 100, opened: 50, clicked: 10 }, [
		{ sent: 1000, delivered: 1000, opened: 400, clicked: 50 },
		{ sent: 3, delivered: 3, opened: 3, clicked: 3 },
	]);
	assert.equal(comparison.issues, 2);
	assert.ok(Math.abs(comparison.average.opened - 403 / 1003) < 1e-9);
	assert.ok(Math.abs(comparison.delta.opened - (0.5 - 403 / 1003)) < 1e-9);
	assert.ok(comparison.delta.clicked > 0);
});

test("no comparison without two earlier issues that reached anyone, or before this one reaches anyone", () => {
	const stats = { sent: 10, delivered: 10, opened: 5, clicked: 1 };
	assert.equal(compareRates(stats, [{ sent: 100, delivered: 100, opened: 40 }]), null);
	assert.equal(compareRates(stats, [{ sent: 100, delivered: 100, opened: 40 }, { sent: 0, delivered: 0 }]), null);
	assert.equal(compareRates({ sent: 0 }, [{ sent: 10, delivered: 10 }, { sent: 10, delivered: 10 }]), null);
	assert.equal(COMPARED_ISSUES, 10);
});

test("a send without delivery reports compares by what it sent", () => {
	const comparison = compareRates({ sent: 50, opened: 25 }, [
		{ sent: 100, opened: 30 },
		{ sent: 100, opened: 30 },
	]);
	assert.ok(Math.abs(comparison.delta.opened - 0.2) < 1e-9);
});

test("differences between rates read in percentage points", () => {
	assert.equal(formatPoints(0.042), "+4.2 pts");
	assert.equal(formatPoints(-0.0041), "−0.4 pts");
	assert.equal(formatPoints(0.0001), "0 pts");
	assert.equal(formatPoints(null), null);
});

test("an hour reads with its weekday in the viewer's timezone, with minutes only where the offset has them", () => {
	assert.equal(formatWeekdayHour("2026-10-13T09:00:00Z", "UTC"), "Tue 9 AM");
	assert.equal(formatWeekdayHour("2026-10-13T09:00:00Z", "Europe/Athens"), "Tue 12 PM");
	assert.equal(formatWeekdayHour("2026-10-13T09:00:00Z", "Asia/Kolkata"), "Tue 2:30 PM");
});
