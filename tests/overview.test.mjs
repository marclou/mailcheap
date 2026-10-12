import assert from "node:assert/strict";
import { test } from "node:test";
import { linePath, niceScale } from "../lib/charts.js";
import { formatChange, formatHour, formatSigned } from "../lib/format.js";
import {
	buildHourlySeries,
	buildSubscriberSeries,
	compareCount,
	compareRate,
	periodDayKeys,
	splitPeriods,
} from "../lib/overview-series.js";
import {
	hourIn,
	resolveTimeZone,
	shiftDateKey,
	startOfDateKey,
	timeZoneLabel,
	toDateKey,
} from "../lib/time-zone.js";

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
	// London in winter is a zero offset too; ICU 78 formats it "GMT+0".
	assert.equal(timeZoneLabel("Europe/London", new Date("2026-01-15T12:00:00Z")), "UTC");
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
