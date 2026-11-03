import {
	countDateKeys,
	formatDateKeyRange,
	readDateKey,
	shiftDateKey,
	startOfDateKey,
	startOfHour,
	toDateKey,
	toHourKey,
} from "./time-zone.js";

const HOUR_MS = 60 * 60 * 1000;
// The longest period whose emails sent chart has a bar for each hour, day or week, and longer ones one for each month.
// Up to the first, the subscribers chart goes hour by hour too.
export const BAR_DAYS = { hour: 2, day: 31, week: 180 };

// The periods the overview offers, each compared with as many days before it: the last few days up to now, or a
// custom range of whole days, from and to, both included, in the account's timezone. label: its name; span: its
// length, as its labels say it.
export const PERIODS = [
	{ days: 1, span: "24 hours", label: "Last 24 hours" },
	{ days: 7, span: "7 days", label: "Last 7 days" },
	{ days: 30, span: "30 days", label: "Last 30 days" },
	{ days: 90, span: "90 days", label: "Last 90 days" },
	{ days: 365, span: "12 months", label: "Last 12 months" },
];
export const PERIOD_DAYS = 30;
export const MAX_RANGE_DAYS = PERIODS.at(-1).days;

// The period ?days= names, or the default: only one the overview offers.
export function getPeriod(days) {
	return PERIODS.find((period) => String(period.days) === String(days)) ?? PERIODS.find((period) => period.days === PERIOD_DAYS);
}

export function getRangePeriod(from, to) {
	const days = countDateKeys(from, to);
	return { days, span: days === 1 ? "1 day" : `${days} days`, label: formatDateKeyRange(from, to), from, to };
}

// Why from and to can't make a custom range, or null: two days that exist, in order, up to today and MAX_RANGE_DAYS
// at most.
export function getRangeProblem(from, to, todayKey) {
	if (!from || !to) return "Give both from and to";
	if (!readDateKey(from) || !readDateKey(to)) return "from and to should be days, like 2026-10-01";
	if (from > to) return "from should be on or before to";
	if (to > todayKey) return "to can't be after today";
	if (countDateKeys(from, to) > MAX_RANGE_DAYS) return `A period can be up to ${MAX_RANGE_DAYS} days`;
	return null;
}

// The period the overview's address picks: ?from= and ?to=, else ?days=, else the default.
export function readPeriod({ days, from, to }, todayKey) {
	return getRangeProblem(from, to, todayKey) ? getPeriod(days) : getRangePeriod(from, to);
}

// A period's first and last day: a custom range's, or the last days up to today.
export function getPeriodDays(period, todayKey) {
	return period.from ? { from: period.from, to: period.to } : { from: shiftDateKey(todayKey, 1 - period.days), to: todayKey };
}

// The previous period's days, then the current one's; the last key is today.
export function periodDayKeys(todayKey, days = PERIOD_DAYS) {
	return Array.from({ length: days * 2 }, (_, index) => shiftDateKey(todayKey, index - days * 2 + 1));
}

// The points a period's charts show, and as many of the period before: each hour of a period of BAR_DAYS.hour or
// less, else each day, in timeZone, keyed "2026-10-08 14" or "2026-10-08". The last days end with the hour or the day
// now is in, and a range ending today with this hour, next to the same hours the days before. start: when the period
// before begins; end: when the period ends.
export function getPeriodPoints(period, { timeZone, now = new Date() }) {
	if (period.days <= BAR_DAYS.hour) {
		const nextHour = startOfHour(now, timeZone).getTime() + HOUR_MS;
		const currentStart = period.from ? startOfDateKey(period.from, timeZone).getTime() : nextHour - period.days * 24 * HOUR_MS;
		const start = period.from ? startOfDateKey(shiftDateKey(period.from, -period.days), timeZone).getTime() : currentStart - period.days * 24 * HOUR_MS;
		const end = Math.min(period.to ? startOfDateKey(shiftDateKey(period.to, 1), timeZone).getTime() : nextHour, nextHour);
		return {
			unit: "hour",
			start: new Date(start),
			end: new Date(end),
			previous: hourKeys(start, Math.min(currentStart, start + end - currentStart), timeZone),
			current: hourKeys(currentStart, end, timeZone),
		};
	}
	const keys = periodDayKeys(period.to ?? toDateKey(now, timeZone), period.days);
	return {
		unit: "day",
		start: startOfDateKey(keys[0], timeZone),
		end: period.to ? startOfDateKey(shiftDateKey(period.to, 1), timeZone) : now,
		previous: keys.slice(0, period.days),
		current: keys.slice(period.days),
	};
}

// Each hour from start to end, two times on an hour's start. The hour clocks go back over counts once.
function hourKeys(start, end, timeZone) {
	const keys = [];
	for (let time = start; time < end; time += HOUR_MS) {
		const key = toHourKey(new Date(time), timeZone);
		if (key !== keys.at(-1)) keys.push(key);
	}
	return keys;
}

// What a bar of the emails sent chart covers: an hour, a day, a week or a month, by BAR_DAYS.
export function getBarUnit(points) {
	if (points.unit === "hour") return "hour";
	const days = points.current.length;
	return days <= BAR_DAYS.day ? "day" : days <= BAR_DAYS.week ? "week" : "month";
}

// The emails sent chart's bars from a count for each point: an hour's or a day's, 7 days' from the period's first, or a
// calendar month's, next to the same points of the period before. first and last: its first and last point.
export function buildSendBars(points, counts) {
	const unit = getBarUnit(points);
	return groupPoints(points.current, unit).map(([start, end]) => ({
		first: points.current[start],
		last: points.current[end - 1],
		previousFirst: points.previous[start] ?? null,
		previousLast: points.previous[end - 1] ?? null,
		sent: sum(counts.current.slice(start, end)),
		previousSent: sum(counts.previous.slice(start, end)),
	}));
}

// [start, end] index ranges of the points each bar adds up.
function groupPoints(keys, unit) {
	if (unit === "hour" || unit === "day") return keys.map((_, index) => [index, index + 1]);
	if (unit === "week") return Array.from({ length: Math.ceil(keys.length / 7) }, (_, week) => [week * 7, Math.min(keys.length, week * 7 + 7)]);
	const ranges = [];
	keys.forEach((key, index) => {
		if (index > 0 && key.slice(0, 7) === keys[index - 1].slice(0, 7)) ranges.at(-1)[1] = index + 1;
		else ranges.push([index, index + 1]);
	});
	return ranges;
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

// Subscribers at the end of each day: the count when the range starts, plus joins, minus leaves.
// Events dated before the range fold into the starting count; later ones are ignored.
export function buildSubscriberSeries({ dayKeys, baseline, joins = {}, leaves = {} }) {
	const firstKey = dayKeys[0];
	let start = baseline;
	for (const [key, count] of Object.entries(joins)) if (key < firstKey) start += count;
	for (const [key, count] of Object.entries(leaves)) if (key < firstKey) start -= count;

	let total = start;
	const days = dayKeys.map((key) => {
		const joined = joins[key] ?? 0;
		const left = leaves[key] ?? 0;
		total += joined - left;
		return { key, total, joined, left };
	});
	return { start, days };
}

export function splitPeriods({ start, days }, periodDays = PERIOD_DAYS) {
	const previous = days.slice(0, periodDays);
	const current = days.slice(periodDays);
	const previousEnd = previous.at(-1)?.total ?? start;
	return {
		previous,
		current,
		total: current.at(-1)?.total ?? previousEnd,
		growth: (current.at(-1)?.total ?? previousEnd) - previousEnd,
		previousGrowth: previousEnd - start,
	};
}

// 24 hourly buckets of today and yesterday from { day, hour, count } rows. Hours still to come are null.
export function buildHourlySeries({ rows, todayKey, currentHour }) {
	const yesterdayKey = shiftDateKey(todayKey, -1);
	const counts = new Map(rows.map(({ day, hour, count }) => [`${day} ${hour}`, count]));
	return Array.from({ length: 24 }, (_, hour) => ({
		hour,
		today: hour > currentHour ? null : (counts.get(`${todayKey} ${hour}`) ?? 0),
		yesterday: counts.get(`${yesterdayKey} ${hour}`) ?? 0,
	}));
}

// Change of a count in percent, or of a rate in percentage points. Null when there's nothing to compare.
export function compareCount(current, previous) {
	if (!previous) return null;
	return ((current - previous) / previous) * 100;
}

export function compareRate(part, total, previousPart, previousTotal) {
	if (!total || !previousTotal) return null;
	return ((part / total) - (previousPart / previousTotal)) * 100;
}
