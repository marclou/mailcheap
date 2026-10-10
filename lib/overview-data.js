import "server-only";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { MESSAGE_STATS_COLUMNS } from "@/lib/message-stats";
import {
	PERIOD_DAYS,
	buildHourlySeries,
	buildSubscriberSeries,
	periodDayKeys,
	splitPeriods,
} from "@/lib/overview-series";
import { campaignColumn } from "@/lib/rows";
import { campaigns, contacts, messages, suppressions } from "@/lib/schema";
import { DEFAULT_TIME_ZONE, hourIn, shiftDateKey, startOfDateKey, toDateKey } from "@/lib/time-zone";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAT_KEYS = Object.keys(MESSAGE_STATS_COLUMNS);
const LEFT_STATUSES = ["unsubscribed", "bounced", "complained"];
const IMPORT_SOURCES = ["import"];
// Imports write the unsubscribe time (and suppressions) as they create the contact, so a leave
// recorded within a minute of creation happened before the contact came to Mailcheap, at an unknown date.
const IMPORT_WINDOW_MS = 60_000;
const IMPORT_WINDOW = sql.raw(`interval '${IMPORT_WINDOW_MS} milliseconds'`);
// Expressions with parameters are grouped by their position in the select: Postgres can't tell that the
// same expression with a new $n placeholder in GROUP BY is the selected one.
const BY_FIRST = sql.raw("1");
const BY_FIRST_TWO = [sql.raw("1"), sql.raw("2")];
// Postgres: invalid_parameter_value, raised for a time zone it doesn't know.
const UNKNOWN_TIME_ZONE_CODE = "22023";

// The later of the two: a contact who subscribes again gets a new subscribedAt but keeps an old confirmedAt.
const joinedAt = sql`greatest(${contacts.subscribedAt}, ${contacts.confirmedAt})`;
// Imported rows without a signup date get the import time: those contacts joined earlier, on an unknown
// day, so they count from the start of the chart rather than as a spike on the import day.
const joinedBeforeImport = sql`(${inArray(contacts.source, IMPORT_SOURCES)} and abs(extract(epoch from ${contacts.subscribedAt} - ${contacts.createdAt})) * 1000 < ${IMPORT_WINDOW_MS})`;

function dayOf(date, timeZone) {
	return sql`to_char(${date} at time zone ${timeZone}, 'YYYY-MM-DD')`;
}

// The day a contact joined, or null when it was before the range (or unknown): they're in the starting count.
function joinedDay(rangeStart, timeZone) {
	return sql`case when ${joinedBeforeImport} or ${joinedAt} < ${rangeStart} then null else ${dayOf(joinedAt, timeZone)} end`;
}

function joinedKey(contact, rangeStart, timeZone) {
	const joined = new Date(Math.max(contact.subscribedAt ?? 0, contact.confirmedAt ?? 0));
	const isImportTime =
		IMPORT_SOURCES.includes(contact.source) &&
		Math.abs(contact.subscribedAt - contact.createdAt) < IMPORT_WINDOW_MS;
	return isImportTime || joined < rangeStart ? null : toDateKey(joined, timeZone);
}

// Postgres's time zone list can lag the browser's; such a zone falls back to UTC rather than failing the page.
async function queryInZone(buildQuery, timeZone) {
	try {
		return await buildQuery(timeZone);
	} catch (error) {
		const code = error?.code ?? error?.cause?.code;
		if (code !== UNKNOWN_TIME_ZONE_CODE || timeZone === DEFAULT_TIME_ZONE) throw error;
		return buildQuery(DEFAULT_TIME_ZONE);
	}
}

function hasLeftInMailcheap(leftAt, contact) {
	return Boolean(leftAt) && leftAt.getTime() > contact.createdAt.getTime() + IMPORT_WINDOW_MS;
}

// Active subscribers at the end of each of the last 60 days. Active contacts count from the day they
// joined (confirmed, for confirmed opt-in; CSV imports keep the file's signup date). Contacts who
// left count until they left, when Mailcheap knows the date: unsubscribedAt, or the suppression a bounce
// or complaint created. Pending, dormant and contacts imported as unsubscribed or bounced have no such
// date and are left out of every day.
export async function getSubscriberHistory({ newsletterId, timeZone, now = new Date() }) {
	const db = getDb();
	const dayKeys = periodDayKeys(toDateKey(now, timeZone));
	const rangeStart = startOfDateKey(dayKeys[0], timeZone);
	const ofNewsletter = eq(contacts.newsletterId, newsletterId);

	const [[{ value: activeBefore }], activeJoins, unsubscribes, suppressionRows] = await Promise.all([
		db
			.select({ value: count() })
			.from(contacts)
			.where(and(ofNewsletter, eq(contacts.status, "active"), lt(contacts.subscribedAt, rangeStart))),
		queryInZone((zone) => {
			const day = joinedDay(rangeStart, zone);
			return db
				.select({ day, count: count() })
				.from(contacts)
				.where(and(ofNewsletter, eq(contacts.status, "active"), gte(contacts.subscribedAt, rangeStart)))
				.groupBy(BY_FIRST);
		}, timeZone),
		queryInZone((zone) => {
			const joined = joinedDay(rangeStart, zone);
			const left = dayOf(contacts.unsubscribedAt, zone);
			return db
				.select({ joined, left, count: count() })
				.from(contacts)
				.where(
					and(
						ofNewsletter,
						inArray(contacts.status, LEFT_STATUSES),
						gte(contacts.unsubscribedAt, rangeStart),
						sql`${contacts.unsubscribedAt} > ${contacts.createdAt} + ${IMPORT_WINDOW}`
					)
				)
				.groupBy(...BY_FIRST_TWO);
		}, timeZone),
		// Each recent suppression with this newsletter's contact for the address, in the same round trip.
		db
			.select({
				leftAt: suppressions.createdAt,
				source: contacts.source,
				subscribedAt: contacts.subscribedAt,
				confirmedAt: contacts.confirmedAt,
				unsubscribedAt: contacts.unsubscribedAt,
				createdAt: contacts.createdAt,
			})
			.from(suppressions)
			.innerJoin(
				contacts,
				and(eq(contacts.email, suppressions.email), ofNewsletter, inArray(contacts.status, ["bounced", "complained"]))
			)
			.where(
				and(
					inArray(suppressions.reason, ["bounce", "complaint"]),
					sql`coalesce(${suppressions.detail}, '') not in ${IMPORT_SOURCES}`,
					gte(suppressions.createdAt, rangeStart)
				)
			),
	]);
	const suppressionsWithContact = suppressionRows.map(({ leftAt, ...contact }) => ({ leftAt, contact }));

	let baseline = activeBefore;
	const joins = {};
	const leaves = {};
	function addLeaver(joinedKey, leftKey, count = 1) {
		if (joinedKey) joins[joinedKey] = (joins[joinedKey] ?? 0) + count;
		else baseline += count;
		leaves[leftKey] = (leaves[leftKey] ?? 0) + count;
	}

	for (const { day, count } of activeJoins) {
		if (day) joins[day] = (joins[day] ?? 0) + count;
		else baseline += count;
	}
	for (const { joined, left, count } of unsubscribes) addLeaver(joined, left, count);
	for (const { leftAt, contact } of suppressionsWithContact) {
		if (hasLeftInMailcheap(contact.unsubscribedAt, contact) || !hasLeftInMailcheap(leftAt, contact)) continue;
		addLeaver(joinedKey(contact, rangeStart, timeZone), toDateKey(leftAt, timeZone));
	}

	return splitPeriods(buildSubscriberSeries({ dayKeys, baseline, joins, leaves }));
}

function emptyStats() {
	return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

// Issues and welcome emails of the last 30 days and the 30 days before.
export async function getEmailStats({ newsletterId, now = new Date() }) {
	const db = getDb();
	const since = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
	const previousSince = new Date(now.getTime() - 2 * PERIOD_DAYS * DAY_MS);
	const campaignAt = sql`coalesce(${campaigns.startedAt}, ${campaigns.sentAt})`;
	const period = (field) => sql`case when ${field} >= ${since} then 'current' else 'previous' end`;
	const campaignPeriod = period(campaignAt);
	const welcomePeriod = period(messages.createdAt);

	const [campaignRows, welcomeRows] = await Promise.all([
		db
			.select({
				period: campaignPeriod,
				...Object.fromEntries(
					STAT_KEYS.map((key) => [key, sql`sum(${campaignColumn(`stats.${key}`)})`.mapWith(Number)])
				),
			})
			.from(campaigns)
			.where(and(eq(campaigns.newsletterId, newsletterId), gte(campaignAt, previousSince)))
			.groupBy(BY_FIRST),
		db
			.select({ period: welcomePeriod, ...MESSAGE_STATS_COLUMNS })
			.from(messages)
			.where(
				and(eq(messages.kind, "welcome"), gte(messages.createdAt, previousSince), eq(messages.newsletterId, newsletterId))
			)
			.groupBy(BY_FIRST),
	]);

	const totals = { current: emptyStats(), previous: emptyStats() };
	for (const row of [...campaignRows, ...welcomeRows]) {
		for (const key of STAT_KEYS) totals[row.period][key] += row[key] || 0;
	}
	return totals;
}

// Every email SES accepted for the newsletter (issues, welcome, confirmation and test emails), by hour
// of today and yesterday.
export async function getHourlySends({ newsletterId, timeZone, now = new Date() }) {
	const todayKey = toDateKey(now, timeZone);
	const since = startOfDateKey(shiftDateKey(todayKey, -1), timeZone);
	const rows = await queryInZone((zone) => {
		const day = dayOf(messages.sentAt, zone);
		const hour = sql`extract(hour from ${messages.sentAt} at time zone ${zone})`.mapWith(Number);
		return getDb()
			.select({ day, hour, count: count() })
			.from(messages)
			.where(and(eq(messages.newsletterId, newsletterId), gte(messages.sentAt, since)))
			.groupBy(...BY_FIRST_TWO);
	}, timeZone);
	return buildHourlySeries({ rows, todayKey, currentHour: hourIn(now, timeZone) });
}
