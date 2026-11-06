import { LIMITS } from "./config.js";

// What a send is judged on, in this order at each level: a count out of sent, and its keys in LIMITS. A level without a
// metric's keys never stops a send over it.
const METRICS = [
	{ metric: "bounce", name: "bounce rate", count: "bounced", rate: "bounceRate", min: "minBounces", plural: "bounces" },
	{ metric: "complaint", name: "complaint rate", count: "complained", rate: "complaintRate", min: "minComplaints", plural: "complaints" },
	{ metric: "refusal", name: "Gmail refusal rate", count: "refused", rate: "refusalRate", min: "minRefusals", plural: "refusals" },
];

function findMetric(metric) {
	return METRICS.find((item) => item.metric === metric);
}

export function formatRate(value) {
	return `${(value * 100).toFixed(2)}%`;
}

// "bounce rate", "Gmail refusal rate"
export function getRateName(metric) {
	return findMetric(metric).name;
}

// The level bounces, complaints and Gmail's refusals out of sent reach (LIMITS in lib/config.js), block before pause, then
// in METRICS' order: { level, metric, rate, limit }, or null under all of them. A level needs its rate passed and its
// minimum count reached.
export function judgeRates(counts = {}) {
	const sent = counts.sent ?? 0;
	if (sent === 0) return null;
	for (const level of ["block", "pause"]) {
		for (const { metric, count, rate, min } of METRICS) {
			const limit = LIMITS[level][rate];
			const value = counts[count] ?? 0;
			if (limit !== undefined && value >= LIMITS[level][min] && value / sent > limit) return { level, metric, rate: value / sent, limit };
		}
	}
	return null;
}

// "Bounce rate of 3.00% on this campaign (limit 2.50%)"
export function describeRate({ metric, rate, limit }, where) {
	const name = getRateName(metric);
	return `${name[0].toUpperCase()}${name.slice(1)} of ${formatRate(rate)}${where ? ` ${where}` : ""} (limit ${formatRate(limit)})`;
}

// What blocks the account, for the warnings of the pause level: "5.00% with 10 bounces". Null for what never blocks it.
export function describeBlockLevel(metric) {
	const { rate, min, plural } = findMetric(metric);
	return LIMITS.block[rate] === undefined ? null : `${formatRate(LIMITS.block[rate])} with ${LIMITS.block[min]} ${plural}`;
}
