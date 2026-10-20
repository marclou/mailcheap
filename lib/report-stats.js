// What a sent campaign's report computes from its messages and from the newsletter's earlier issues. Pure, so the
// page and the API agree and tests can check them.

const HOUR_MS = 60 * 60 * 1000;

// Hours the timeline shows: most opens come in the first three days.
export const TIMELINE_HOURS = 72;
// A send younger than this still shows a whole first day, where its opens are headed.
const TIMELINE_MIN_HOURS = 24;
export const COMPARED_ISSUES = 10;
// Fewer earlier issues than this make no average worth showing.
const MIN_COMPARED_ISSUES = 2;

// First opens and first clicks in each clock hour from the hour the send started, until the third day or now; a
// fresh send's hours to come are marked so the chart leaves them empty. rows: [{ _id: hour start, count }], as
// $dateTrunc groups them. Opens and clicks after the last hour are summed in later.
export function buildTimeline({ startedAt, now = new Date(), opens = [], clicks = [] }) {
	const start = floorHour(new Date(startedAt));
	const elapsed = Math.max(1, Math.floor((now.getTime() - start.getTime()) / HOUR_MS) + 1);
	const length = Math.min(TIMELINE_HOURS, Math.max(TIMELINE_MIN_HOURS, elapsed));
	const hours = Array.from({ length }, (_, index) => ({
		at: new Date(start.getTime() + index * HOUR_MS),
		opens: 0,
		clicks: 0,
		isFuture: index >= elapsed,
	}));
	const later = { opens: 0, clicks: 0 };
	for (const [rows, key] of [
		[opens, "opens"],
		[clicks, "clicks"],
	]) {
		for (const { _id, count } of rows) {
			// An event stamped before the start (a provider's clock) counts in the first hour.
			const index = Math.max(0, Math.floor((new Date(_id).getTime() - start.getTime()) / HOUR_MS));
			if (index < length) hours[index][key] += count;
			else later[key] += count;
		}
	}
	return { start, hours, later };
}

// The hour with the most opens, the earliest of equals; null without opens.
export function findPeak(hours) {
	let peak = null;
	hours.forEach(({ opens }, index) => {
		if (opens > 0 && (peak === null || opens > hours[peak].opens)) peak = index;
	});
	return peak;
}

// How many hours after the start half of all opens had come, counting the ones after the timeline; null without
// opens or when half came later than the timeline shows.
export function hoursToHalf({ hours, later }) {
	const total = hours.reduce((sum, { opens }) => sum + opens, later.opens);
	if (total === 0) return null;
	let seen = 0;
	for (const [index, { opens }] of hours.entries()) {
		seen += opens;
		if (seen * 2 >= total) return index + 1;
	}
	return null;
}

// This send's open and click rates against the earlier issues' pooled rates: all their opens over all the contacts
// they reached, so a test send to three people barely moves it. Null with fewer than two earlier issues that reached
// anyone, or when this one reached nobody yet. delta: this rate minus the average, as a fraction.
export function compareRates(stats, previous) {
	const reached = reachedOf(stats);
	const earlier = previous.filter((item) => reachedOf(item) > 0);
	if (!reached || earlier.length < MIN_COMPARED_ISSUES) return null;
	const earlierReached = sum(earlier.map(reachedOf));
	const average = {
		opened: sum(earlier.map((item) => item.opened ?? 0)) / earlierReached,
		clicked: sum(earlier.map((item) => item.clicked ?? 0)) / earlierReached,
	};
	return {
		issues: earlier.length,
		average,
		delta: {
			opened: (stats.opened ?? 0) / reached - average.opened,
			clicked: (stats.clicked ?? 0) / reached - average.clicked,
		},
	};
}

// The contacts a send reached: delivered when the provider reports deliveries, else sent.
export function reachedOf(stats) {
	return stats?.delivered || stats?.sent || 0;
}

function floorHour(date) {
	return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}
