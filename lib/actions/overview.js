import "server-only";
import * as z from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import { UsageSchema, findFirstNewsletter, findNewsletter, getUsageOutput, newsletterInput } from "@/lib/actions/shared";
import { getEmailStats, getHourlySends, getSends, getSubscriberHistory } from "@/lib/overview-data";
import {
	MAX_RANGE_DAYS,
	PERIODS,
	PERIOD_DAYS,
	buildSendBars,
	getBarUnit,
	getPeriod,
	getPeriodPoints,
	getRangePeriod,
	getRangeProblem,
} from "@/lib/overview-series";
import { SUMMARY_BARS, getLatestSummaryPeriod } from "@/lib/summary";
import { summarizeNewsletter } from "@/lib/summary-data";
import { resolveTimeZone, toDateKey } from "@/lib/time-zone";

const STAT_KEYS = ["sent", "delivered", "opened", "clicked", "bounced", "complained"];
const PERIOD_OPTIONS = PERIODS.map(({ days }) => days);
const dayInput = z.string().trim().max(10);
const PeriodSchema = z.object({
	...Object.fromEntries(STAT_KEYS.map((key) => [key, z.number().int()])),
	rates: z
		.object({ delivered: z.number().nullable(), opened: z.number().nullable(), clicked: z.number().nullable(), bounced: z.number().nullable(), complained: z.number().nullable() })
		.describe("Fractions from 0 to 1: delivered, bounced and complained of sent; opened and clicked of delivered"),
});

function toRate(part, total) {
	return total ? Math.round((part / total) * 10_000) / 10_000 : null;
}

function toPeriod(stats) {
	const reached = stats.delivered || stats.sent;
	return {
		...Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] ?? 0])),
		rates: {
			delivered: toRate(stats.delivered, stats.sent),
			opened: toRate(stats.opened, reached),
			clicked: toRate(stats.clicked, reached),
			bounced: toRate(stats.bounced, stats.sent),
			complained: toRate(stats.complained, stats.sent),
		},
	};
}

// from and to make a custom range, which days can't come with.
function readPeriodInput({ days, from, to }, todayKey) {
	if (!from && !to) return getPeriod(days);
	if (days) throw actionError("validation_failed", "Give days, or from and to");
	const problem = getRangeProblem(from, to, todayKey);
	if (problem) throw actionError("validation_failed", problem);
	return getRangePeriod(from, to);
}

// An account without a newsletter yet gets the plan's usage and nothing else.
function pickNewsletter(account, reference) {
	const fields = { name: 1, slug: 1 };
	return reference ? findNewsletter(account, reference, fields) : findFirstNewsletter(account, fields);
}

const RateSchema = z.number().nullable().describe("A fraction from 0 to 1 of the contacts the issue reached");

function toSummaryIssue(issue) {
	if (!issue) return null;
	return {
		id: issue.id,
		subject: issue.subject,
		startedAt: new Date(issue.startedAt).toISOString(),
		reached: issue.reached,
		rates: { opened: toRate(issue.opened, issue.reached), clicked: toRate(issue.clicked, issue.reached) },
		average: issue.comparison
			? { issues: issue.comparison.issues, openedDelta: round(issue.comparison.opened), clickedDelta: round(issue.comparison.clicked) }
			: null,
		isSettled: issue.isSettled,
		topLink: issue.topLink,
	};
}

function round(value) {
	return Math.round(value * 10_000) / 10_000;
}

export const overviewActions = [
	defineAction({
		name: "get_overview",
		role: "member",
		tryWithoutPlan: true,
		title: "Get the overview",
		group: "Overview",
		description: `The dashboard's overview for one newsletter over a period, the last ${PERIOD_DAYS} days unless days or from and to pick another: subscribers at the end of each day of it (each hour of a period of 2 days or less), its email results against as many days before, the emails it sent per hour, day, week or month by its length, emails sent per hour today and yesterday, and the plan's usage this month, which the account's newsletters share.`,
		http: { method: "GET", path: "/overview" },
		readOnly: true,
		example: { days: 90, timeZone: "Europe/Paris" },
		input: z.object({
			newsletter: newsletterInput,
			days: z
				.literal(PERIOD_OPTIONS)
				.optional()
				.describe(
					`The period: the last ${PERIOD_OPTIONS.slice(0, -1).join(", ")} or ${PERIOD_OPTIONS.at(-1)} days, 1 for the last 24 hours. Default: ${PERIOD_DAYS}.`
				),
			from: dayInput
				.optional()
				.describe(`A custom period's first day instead of days, YYYY-MM-DD in timeZone, with to: up to ${MAX_RANGE_DAYS} days, both included`),
			to: dayInput.optional().describe("A custom period's last day, YYYY-MM-DD in timeZone, today at the latest"),
			timeZone: z.string().max(64).optional().describe("IANA time zone for days and hours, e.g. Europe/Paris. Default: UTC."),
		}),
		output: z.object({
			newsletter: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
			days: z.number().int().describe("The period's length in days"),
			from: z.string().describe("The period's first day, YYYY-MM-DD"),
			to: z.string().describe("The period's last day, YYYY-MM-DD"),
			timeZone: z.string(),
			subscribers: z
				.object({
					total: z.number().int(),
					growth: z.number().int().describe("Change over the period"),
					previousGrowth: z.number().int().describe("Change over as many days before"),
					days: z
						.array(z.object({ date: z.string(), total: z.number().int(), joined: z.number().int(), left: z.number().int() }))
						.describe("Each day of the period, YYYY-MM-DD, or each hour of a period of 2 days or less, YYYY-MM-DD HH, oldest first"),
				})
				.nullable(),
			emails: z
				.object({ current: PeriodSchema, previous: PeriodSchema })
				.nullable()
				.describe("Issues and welcome emails of the period, and of as many days before"),
			sends: z
				.object({
					per: z.enum(["hour", "day", "week", "month"]),
					total: z.number().int(),
					previousTotal: z.number().int(),
					bars: z.array(z.object({ from: z.string(), to: z.string(), sent: z.number().int(), previousSent: z.number().int() })),
				})
				.nullable()
				.describe(
					"Issues and welcome emails sent in each hour, day, week or month of the period, by its length, next to the same stretch of the period before. from and to: a bar's first and last day, YYYY-MM-DD, or hour, YYYY-MM-DD HH"
				),
			hours: z
				.array(z.object({ hour: z.number().int(), today: z.number().int().nullable(), yesterday: z.number().int() }))
				.nullable()
				.describe("Emails sent per hour; hours still to come today are null"),
			usage: UsageSchema,
		}),
		handler: async ({ account, input }) => {
			const timeZone = resolveTimeZone(input.timeZone);
			const now = new Date();
			const period = readPeriodInput(input, toDateKey(now, timeZone));
			const points = getPeriodPoints(period, { timeZone, now });
			const range = { days: period.days, from: points.current[0].slice(0, 10), to: points.current.at(-1).slice(0, 10) };
			const [newsletter, usage] = await Promise.all([pickNewsletter(account, input.newsletter), getUsageOutput(account)]);
			if (!newsletter) return { newsletter: null, ...range, timeZone, subscribers: null, emails: null, sends: null, hours: null, usage };

			const query = { accountId: account._id, newsletterId: newsletter._id, timeZone };
			const [history, stats, counts, hours] = await Promise.all([
				getSubscriberHistory({ ...query, points }),
				getEmailStats({ ...query, days: period.days, from: period.from, to: period.to, now }),
				getSends({ ...query, points }),
				getHourlySends({ ...query, now }),
			]);
			return {
				newsletter: { id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug },
				...range,
				timeZone,
				subscribers: {
					total: history.total,
					growth: history.growth,
					previousGrowth: history.previousGrowth,
					days: history.current.map(({ key, total, joined, left }) => ({ date: key, total, joined, left })),
				},
				emails: { current: toPeriod(stats.current), previous: toPeriod(stats.previous) },
				sends: {
					per: getBarUnit(points),
					total: counts.current.reduce((total, count) => total + count, 0),
					previousTotal: counts.previous.reduce((total, count) => total + count, 0),
					bars: buildSendBars(points, counts).map(({ first, last, sent, previousSent }) => ({ from: first, to: last, sent, previousSent })),
				},
				hours,
				usage,
			};
		},
	}),
	defineAction({
		name: "get_summary",
		role: "member",
		tryWithoutPlan: true,
		title: "Get a summary",
		group: "Overview",
		description: `What MailCheap's summary email says about one newsletter, for its last whole day or week: who joined and who unsubscribed against the period before, the total, new subscribers per day for the last ${SUMMARY_BARS.daily} days or per week for the last ${SUMMARY_BARS.weekly} weeks, the latest issue's open and click rates against the newsletter's average with its most clicked link, and the summary's opening line.`,
		http: { method: "GET", path: "/summary" },
		readOnly: true,
		rateLimit: { limit: 120, window: "1 h" },
		example: { period: "week", timeZone: "Europe/Paris" },
		input: z.object({
			newsletter: newsletterInput,
			period: z.enum(["day", "week"]).optional().describe("day: yesterday. week: the 7 days before the latest Monday. Default: week."),
			timeZone: z.string().max(64).optional().describe("IANA time zone the days start in, e.g. Europe/Paris. Default: UTC."),
		}),
		output: z.object({
			newsletter: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
			period: z.object({ from: z.string().describe("First day, YYYY-MM-DD"), to: z.string().describe("Last day, YYYY-MM-DD"), timeZone: z.string() }),
			summary: z
				.object({
					subscribers: z.object({
						joined: z.number().int(),
						previousJoined: z.number().int().nullable(),
						left: z.number().int().describe("Unsubscribes, bounces and complaints"),
						total: z.number().int().describe("Active subscribers at the end of the period"),
						previousTotal: z.number().int().describe("Active subscribers when it started"),
						unsubscribed: z.number().int(),
						previousUnsubscribed: z.number().int(),
						bars: z.array(z.object({ from: z.string(), to: z.string(), joined: z.number().int(), left: z.number().int() })).describe("Oldest first; the last is this period"),
					}),
					issue: z
						.object({
							id: z.string(),
							subject: z.string(),
							startedAt: z.string(),
							reached: z.number().int(),
							rates: z.object({ opened: RateSchema, clicked: RateSchema }),
							average: z
								.object({ issues: z.number().int(), openedDelta: z.number(), clickedDelta: z.number() })
								.nullable()
								.describe("This issue's rates minus the average of the newsletter's earlier issues, as fractions"),
							isSettled: z.boolean().describe("Three days old or more, so its rates stopped climbing"),
							topLink: z.object({ url: z.string(), clickers: z.number().int() }).nullable(),
						})
						.nullable(),
					line: z.string(),
				})
				.nullable(),
		}),
		handler: async ({ account, input }) => {
			const timeZone = resolveTimeZone(input.timeZone);
			const period = getLatestSummaryPeriod({ frequency: input.period === "day" ? "daily" : "weekly", timeZone });
			const range = { from: period.startKey, to: period.lastKey, timeZone };
			const newsletter = await pickNewsletter(account, input.newsletter);
			if (!newsletter) return { newsletter: null, period: range, summary: null };
			const { subscribers, unsubscribed, previousUnsubscribed, issue, line } = await summarizeNewsletter({ account, newsletter, period });
			return {
				newsletter: { id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug },
				period: range,
				summary: {
					subscribers: {
						joined: subscribers.joined,
						previousJoined: subscribers.previousJoined,
						left: subscribers.left,
						total: subscribers.total,
						previousTotal: subscribers.previousTotal,
						unsubscribed,
						previousUnsubscribed,
						bars: subscribers.bars.map((bar) => ({ from: bar.startKey, to: bar.endKey, joined: bar.joined, left: bar.left })),
					},
					issue: toSummaryIssue(issue),
					line,
				},
			};
		},
	}),
];
