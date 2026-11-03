import "server-only";
import { MESSAGE_STATS_GROUP } from "@/lib/message-stats";
import { PERIOD_DAYS, buildHourlySeries, buildSubscriberSeries, getPeriodPoints, splitPeriods } from "@/lib/overview-series";
import { DEFAULT_TIME_ZONE, hourIn, shiftDateKey, startOfDateKey, toDateKey, toHourKey } from "@/lib/time-zone";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Suppression from "@/models/Suppression";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAT_KEYS = Object.keys(MESSAGE_STATS_GROUP);
const LEFT_STATUSES = ["unsubscribed", "bounced", "complained"];
const IMPORT_SOURCES = ["import"];
// Imports write the unsubscribe time (and suppressions) as they create the contact, so a leave
// recorded within a minute of creation happened before the contact came to MailCheap, at an unknown date.
const IMPORT_WINDOW_MS = 60_000;
const UNKNOWN_TIME_ZONE_CODE = 40485;
// The keys of a period's points (lib/overview-series.js getPeriodPoints), as $dateToString and the page write them.
const POINT_FORMATS = { day: "%Y-%m-%d", hour: "%Y-%m-%d %H" };
// What the email stats count as sent: issues and welcome emails.
const SENT_KINDS = ["campaign", "welcome"];

// The later of the two: a contact who subscribes again gets a new subscribedAt but keeps an old confirmedAt.
const joinedAt = { $max: ["$subscribedAt", "$confirmedAt"] };
// Imported rows without a signup date get the import time: those contacts joined earlier, on an unknown
// day, so they count from the start of the chart rather than as a spike on the import day.
const joinedBeforeImport = {
	$and: [
		{ $in: ["$source", IMPORT_SOURCES] },
		{ $lt: [{ $abs: { $subtract: ["$subscribedAt", "$createdAt"] } }, IMPORT_WINDOW_MS] },
	],
};

function dayOf(date, timeZone, format = POINT_FORMATS.day) {
	return { $dateToString: { date, format, timezone: timeZone } };
}

// The day or hour a contact joined, or null when it was before the range (or unknown): they're in the starting count.
function joinedPoint(rangeStart, timeZone, format) {
	return {
		$cond: [{ $or: [joinedBeforeImport, { $lt: [joinedAt, rangeStart] }] }, null, dayOf(joinedAt, timeZone, format)],
	};
}

function joinedKey(contact, rangeStart, toKey) {
	const joined = new Date(Math.max(contact.subscribedAt ?? 0, contact.confirmedAt ?? 0));
	const isImportTime =
		IMPORT_SOURCES.includes(contact.source) &&
		Math.abs(contact.subscribedAt - contact.createdAt) < IMPORT_WINDOW_MS;
	return isImportTime || joined < rangeStart ? null : toKey(joined);
}

// MongoDB's timezone list can lag the browser's; such a zone falls back to UTC rather than failing the page.
async function aggregateInZone(model, buildPipeline, timeZone) {
	try {
		return await model.aggregate(buildPipeline(timeZone));
	} catch (error) {
		if (error?.code !== UNKNOWN_TIME_ZONE_CODE || timeZone === DEFAULT_TIME_ZONE) throw error;
		return model.aggregate(buildPipeline(DEFAULT_TIME_ZONE));
	}
}

function hasLeftInMailcheap(leftAt, contact) {
	return Boolean(leftAt) && leftAt.getTime() > contact.createdAt.getTime() + IMPORT_WINDOW_MS;
}

// Active subscribers at the end of each of a period's points, its days or its hours (lib/overview-series.js
// getPeriodPoints), and of the period before's: by default each of the `days` up to the day to, today unless given.
// Active contacts count from the day they joined (confirmed, for confirmed opt-in; CSV imports keep the
// file's signup date). Contacts who left count until they left, when MailCheap knows the date: unsubscribedAt, or the
// suppression a bounce or complaint created. Pending, dormant and contacts imported as unsubscribed or bounced have no
// such date and are left out of every day.
export async function getSubscriberHistory({
	accountId,
	newsletterId,
	timeZone,
	days = PERIOD_DAYS,
	now = new Date(),
	to = toDateKey(now, timeZone),
	points = getPeriodPoints({ days, to }, { timeZone, now }),
}) {
	const keys = [...points.previous, ...points.current];
	const rangeStart = points.start;
	const format = POINT_FORMATS[points.unit];
	const toKey = (date) => (points.unit === "hour" ? toHourKey(date, timeZone) : toDateKey(date, timeZone));

	const [activeBefore, activeJoins, unsubscribes, suppressions] = await Promise.all([
		Contact.countDocuments({ accountId, newsletterId, status: "active", subscribedAt: { $lt: rangeStart } }),
		aggregateInZone(
			Contact,
			(zone) => [
				{ $match: { accountId, newsletterId, status: "active", subscribedAt: { $gte: rangeStart } } },
				{ $group: { _id: joinedPoint(rangeStart, zone, format), count: { $sum: 1 } } },
			],
			timeZone
		),
		aggregateInZone(
			Contact,
			(zone) => [
				{
					$match: {
						accountId,
						newsletterId,
						status: { $in: LEFT_STATUSES },
						unsubscribedAt: { $gte: rangeStart },
						$expr: { $gt: ["$unsubscribedAt", { $add: ["$createdAt", IMPORT_WINDOW_MS] }] },
					},
				},
				{
					$group: {
						_id: { joined: joinedPoint(rangeStart, zone, format), left: dayOf("$unsubscribedAt", zone, format) },
						count: { $sum: 1 },
					},
				},
			],
			timeZone
		),
		// Each recent suppression with this newsletter's contact for the address, in the same round trip.
		Suppression.aggregate([
			{
				$match: {
					accountId,
					reason: { $in: ["bounce", "complaint"] },
					detail: { $nin: IMPORT_SOURCES },
					createdAt: { $gte: rangeStart },
				},
			},
			{
				$lookup: {
					from: Contact.collection.collectionName,
					localField: "email",
					foreignField: "email",
					pipeline: [
						{ $match: { newsletterId, status: { $in: ["bounced", "complained"] } } },
						{ $project: { source: 1, subscribedAt: 1, confirmedAt: 1, unsubscribedAt: 1, createdAt: 1 } },
					],
					as: "contact",
				},
			},
			{ $unwind: "$contact" },
			{ $project: { _id: 0, leftAt: "$createdAt", contact: 1 } },
		]),
	]);

	let baseline = activeBefore;
	const joins = {};
	const leaves = {};
	function addLeaver(joinedKey, leftKey, count = 1) {
		if (joinedKey) joins[joinedKey] = (joins[joinedKey] ?? 0) + count;
		else baseline += count;
		leaves[leftKey] = (leaves[leftKey] ?? 0) + count;
	}

	for (const { _id, count } of activeJoins) {
		if (_id) joins[_id] = (joins[_id] ?? 0) + count;
		else baseline += count;
	}
	for (const { _id, count } of unsubscribes) addLeaver(_id.joined, _id.left, count);
	for (const { leftAt, contact } of suppressions) {
		if (hasLeftInMailcheap(contact.unsubscribedAt, contact) || !hasLeftInMailcheap(leftAt, contact)) continue;
		addLeaver(joinedKey(contact, rangeStart, toKey), toKey(leftAt));
	}

	return splitPeriods(buildSubscriberSeries({ dayKeys: keys, baseline, joins, leaves }), points.previous.length);
}

function emptyStats() {
	return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

// Issues and welcome emails of a period and of as many days before: the last `days` up to now, or the whole days
// from and to, both included, in timeZone.
export async function getEmailStats({ accountId, newsletterId, days = PERIOD_DAYS, from, to, timeZone = DEFAULT_TIME_ZONE, now = new Date() }) {
	const since = from ? startOfDateKey(from, timeZone) : new Date(now.getTime() - days * DAY_MS);
	const until = to ? startOfDateKey(shiftDateKey(to, 1), timeZone) : now;
	const previousSince = from ? startOfDateKey(shiftDateKey(from, -days), timeZone) : new Date(now.getTime() - 2 * days * DAY_MS);
	const period = (field) => ({ $cond: [{ $gte: [field, since] }, "current", "previous"] });

	const [campaignRows, welcomeRows] = await Promise.all([
		Campaign.aggregate([
			{ $match: { accountId, newsletterId } },
			{ $project: { at: { $ifNull: ["$startedAt", "$sentAt"] }, stats: 1 } },
			{ $match: { at: { $gte: previousSince, $lt: until } } },
			{
				$group: {
					_id: period("$at"),
					...Object.fromEntries(STAT_KEYS.map((key) => [key, { $sum: `$stats.${key}` }])),
				},
			},
		]),
		Message.aggregate([
			{ $match: { accountId, kind: "welcome", createdAt: { $gte: previousSince, $lt: until }, newsletterId } },
			{ $group: { _id: period("$createdAt"), ...MESSAGE_STATS_GROUP } },
		]),
	]);

	const totals = { current: emptyStats(), previous: emptyStats() };
	for (const row of [...campaignRows, ...welcomeRows]) {
		for (const key of STAT_KEYS) totals[row._id][key] += row[key] || 0;
	}
	return totals;
}

// The issues and welcome emails sent at each of a period's points and the period before's (lib/overview-series.js
// getPeriodPoints), a number for each key. Hour by hour, each email counts when it went out; day by day, an issue's
// emails count on the day it started, as in the email stats, which spares reading every email of a year.
export async function getSends({ accountId, newsletterId, timeZone, points }) {
	const { start, end } = points;
	const rows =
		points.unit === "hour"
			? await aggregateInZone(
					Message,
					(zone) => [
						{ $match: { accountId, newsletterId, kind: { $in: SENT_KINDS }, sentAt: { $gte: start, $lt: end } } },
						{ $group: { _id: dayOf("$sentAt", zone, POINT_FORMATS.hour), count: { $sum: 1 } } },
					],
					timeZone
				)
			: (
					await Promise.all([
						aggregateInZone(
							Campaign,
							(zone) => [
								{ $match: { accountId, newsletterId } },
								{ $project: { at: { $ifNull: ["$startedAt", "$sentAt"] }, sent: "$stats.sent" } },
								{ $match: { at: { $gte: start, $lt: end } } },
								{ $group: { _id: dayOf("$at", zone), count: { $sum: "$sent" } } },
							],
							timeZone
						),
						aggregateInZone(
							Message,
							(zone) => [
								{ $match: { accountId, kind: "welcome", createdAt: { $gte: start, $lt: end }, newsletterId } },
								{ $group: { _id: dayOf("$createdAt", zone), count: MESSAGE_STATS_GROUP.sent } },
							],
							timeZone
						),
					])
				).flat();

	const counts = new Map();
	for (const { _id, count } of rows) counts.set(_id, (counts.get(_id) ?? 0) + (count ?? 0));
	return {
		previous: points.previous.map((key) => counts.get(key) ?? 0),
		current: points.current.map((key) => counts.get(key) ?? 0),
	};
}

// Every email SES accepted for the newsletter (issues, welcome, confirmation and test emails), by hour
// of today and yesterday.
export async function getHourlySends({ accountId, newsletterId, timeZone, now = new Date() }) {
	const todayKey = toDateKey(now, timeZone);
	const since = startOfDateKey(shiftDateKey(todayKey, -1), timeZone);
	const rows = await aggregateInZone(
		Message,
		(zone) => [
			{ $match: { accountId, newsletterId, sentAt: { $gte: since } } },
			{
				$group: {
					_id: { day: dayOf("$sentAt", zone), hour: { $hour: { date: "$sentAt", timezone: zone } } },
					count: { $sum: 1 },
				},
			},
		],
		timeZone
	);
	return buildHourlySeries({
		rows: rows.map(({ _id, count }) => ({ ..._id, count })),
		todayKey,
		currentHour: hourIn(now, timeZone),
	});
}
