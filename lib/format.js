const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCentsFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const WINDOWS = { "1 m": "a minute", "1 h": "an hour", "1 d": "a day" };

export function formatNumber(value) {
	return numberFormat.format(value || 0);
}

// "$19", "$1,490"
export function formatUsd(value) {
	return usdFormat.format(value);
}

// "$0.95", "$15.83"
export function formatUsdCents(value) {
	return usdCentsFormat.format(value);
}

// 0.0008 -> "0.08%"
export function formatPercent(rate) {
	return `${Number((rate * 100).toFixed(2))}%`;
}

// "1 contact", "2,239 contacts"
export function formatCount(value, noun) {
	return `${formatNumber(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function formatCompact(value) {
	return compactFormat.format(value || 0);
}

// A rate limit's window, in Upstash's format: "1 h" -> "an hour".
export function formatWindow(value) {
	return WINDOWS[value] ?? value;
}

// The format helpers return null for a missing value; pages show it with TextEmpty.
export function formatRate(part, total, digits = 1) {
	const value = Number(part);
	if (!total || part === undefined || part === null || !Number.isFinite(value)) return null;
	return `${((value / total) * 100).toFixed(digits)}%`;
}

// "One idea a week" -> "One idea a week."; "Who's in?" stays as it is.
export function formatSentence(text) {
	const sentence = String(text ?? "").replace(/\s+/g, " ").trim();
	return !sentence || /[.!?…]["'”’)]*$/.test(sentence) ? sentence : `${sentence}.`;
}

// "+1,204", "−32", "0"
export function formatSigned(value) {
	const sign = value > 0 ? "+" : value < 0 ? "−" : "";
	return `${sign}${formatNumber(Math.abs(value))}`;
}

// "+8%" for a count; for a rate, the difference between the two rates: 41.8% then 39.1% is "−2.7%".
export function formatChange(value, { digits = 0 } = {}) {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	const rounded = Number(value.toFixed(digits));
	const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
	return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

// The difference between two rates in percentage points: 0.042 -> "+4.2 pts", -0.004 -> "−0.4 pts", 0.0001 -> "0 pts".
export function formatPoints(delta, digits = 1) {
	if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
	const rounded = Number((delta * 100).toFixed(digits));
	if (rounded === 0) return "0 pts";
	return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)} pts`;
}

// "Tue 9 AM", or "Tue 9:30 AM" in a timezone with a half-hour offset.
export function formatWeekdayHour(value, timeZone) {
	const date = new Date(value);
	const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone });
	const minutes = Number(new Intl.DateTimeFormat("en-US", { minute: "numeric", timeZone }).format(date));
	const time = date.toLocaleTimeString("en-US", { hour: "numeric", ...(minutes && { minute: "2-digit" }), timeZone });
	return `${weekday} ${time}`;
}

// "2 PM" for 14.
export function formatHour(hour) {
	return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });
}

export function currentYear() {
	return new Date().getFullYear();
}

export function formatDate(value) {
	if (!value) return null;
	return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// "Wed, Oct 7, 4:00 PM" in the browser's timezone; on the server it would be UTC.
export function formatSendTime(value) {
	return new Date(value).toLocaleString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatRelative(value, now = Date.now()) {
	if (!value) return null;
	const seconds = Math.round((now - new Date(value).getTime()) / 1000);
	if (seconds < 60) return "just now";
	const units = [
		["year", 31536000],
		["month", 2592000],
		["day", 86400],
		["hour", 3600],
		["minute", 60],
	];
	const [unit, size] = units.find(([, size]) => seconds >= size);
	const amount = Math.floor(seconds / size);
	return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}
