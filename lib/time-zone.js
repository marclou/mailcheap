// Days and hours on the dashboard follow the browser's timezone, saved in a cookie by CookieTimezone.
export const TIME_ZONE_COOKIE = "tz";
export const DEFAULT_TIME_ZONE = "UTC";

const DAY_MS = 24 * 60 * 60 * 1000;
const keyFormats = new Map();

export function resolveTimeZone(value) {
	if (typeof value !== "string" || !value || value.length > 64) return DEFAULT_TIME_ZONE;
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		return DEFAULT_TIME_ZONE;
	}
}

function keyFormat(timeZone) {
	if (!keyFormats.has(timeZone)) {
		keyFormats.set(
			timeZone,
			new Intl.DateTimeFormat("en-US", {
				timeZone,
				hourCycle: "h23",
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			})
		);
	}
	return keyFormats.get(timeZone);
}

function zonedParts(date, timeZone) {
	const parts = Object.fromEntries(
		keyFormat(timeZone)
			.formatToParts(date)
			.map(({ type, value }) => [type, Number(value)])
	);
	return { ...parts, hour: parts.hour % 24 };
}

// "2026-10-08": the calendar day of an instant in a timezone, the format $dateToString produces.
export function toDateKey(date, timeZone) {
	const { year, month, day } = zonedParts(date, timeZone);
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function hourIn(date, timeZone) {
	return zonedParts(date, timeZone).hour;
}

export function shiftDateKey(key, days) {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

function offsetMs(date, timeZone) {
	const { year, month, day, hour, minute, second } = zonedParts(date, timeZone);
	return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant a calendar day starts in a timezone, DST included.
export function startOfDateKey(key, timeZone) {
	const [year, month, day] = key.split("-").map(Number);
	const midnight = Date.UTC(year, month - 1, day);
	const guess = midnight - offsetMs(new Date(midnight), timeZone);
	return new Date(midnight - offsetMs(new Date(guess), timeZone));
}

// "GMT+3", or "UTC". ICU 78 (Node 26) writes a zero offset as "GMT+0" where older versions write "GMT".
const ZERO_OFFSET_PATTERN = /^GMT(?:[+\-−]0(?::00)?)?$/;

export function timeZoneLabel(timeZone, date = new Date()) {
	const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
		.formatToParts(date)
		.find(({ type }) => type === "timeZoneName")?.value;
	return !name || ZERO_OFFSET_PATTERN.test(name) ? "UTC" : name;
}

// "Oct 8" for a date key, whatever the server's timezone.
export function formatDateKey(key, options = { month: "short", day: "numeric" }) {
	return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}
