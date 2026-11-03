import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { niceScale, toRatio } from "@/lib/charts";
import { formatHour, formatNumber } from "@/lib/format";
import { formatDateKey, formatDateKeyRange } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

const DAY = { month: "short", day: "numeric" };
const WEEKDAY = { weekday: "short", ...DAY };
const HIDDEN_ON_PHONES = "hidden sm:block";

// The emails sent in each bar of the period (lib/overview-series.js buildSendBars), in front of the same stretch of the
// period before as faint bars. unit: what a bar covers, an hour, a day, a week or a month. isLive: the period ends now,
// its last hour under Now.
export default function ChartSends({ bars, unit, isLive = false }) {
	const scale = niceScale([0, ...bars.flatMap(({ sent, previousSent }) => [sent, previousSent])], 3);
	const xOf = (index) => (index + 0.5) / bars.length;
	const sent = bars.reduce((total, bar) => total + bar.sent, 0);
	const year = bars.at(-1).last.slice(0, 4);

	const points = bars.map((bar, index) => ({
		x: xOf(index),
		title: describeBar(bar.first, bar.last, unit, year),
		rows: [
			{ label: "Sent", value: formatNumber(bar.sent), swatch: "bar" },
			bar.previousFirst && {
				label: unit === "hour" ? describeHour(bar.previousFirst, year) : describeBar(bar.previousFirst, bar.previousLast, unit, year),
				value: formatNumber(bar.previousSent),
				swatch: "ghost",
			},
		].filter(Boolean),
	}));
	const xLabels = getXLabels(bars, unit, isLive, year).map((label) => ({ ...label, x: xOf(label.index) }));

	return (
		<ChartFrame scale={scale} xLabels={xLabels} className="h-36 sm:h-44">
			<div
				role="img"
				aria-label={`${formatNumber(sent)} emails sent`}
				className={cn("absolute inset-0 flex items-end", bars.length > 31 ? "gap-px sm:gap-0.5" : "gap-[3px] sm:gap-1.5")}
			>
				{bars.map((bar) => (
					<div key={bar.first} className="relative h-full flex-1">
						<span
							className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-muted-foreground/15"
							style={{ height: `${toRatio(bar.previousSent, scale) * 100}%` }}
						/>
						{bar.sent > 0 && (
							<span
								className="absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[3px] bg-foreground"
								style={{ height: `${toRatio(bar.sent, scale) * 100}%` }}
							/>
						)}
					</div>
				))}
			</div>
			{sent === 0 && (
				<p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
					No emails sent in this period
				</p>
			)}
			<Suspense fallback={null}>
				<ChartHover points={points} band={1 / bars.length} />
			</Suspense>
		</ChartFrame>
	);
}

// A bar's labels under the chart, by its index. Hours: every 6 (12 over two days), a day's first by its date, and Now
// under the last of a period ending now, with room around it, more of it below lg, where the chart can be under 300px
// wide. Days, weeks and months: about five, ending with the last, every other one only on wider screens.
function getXLabels(bars, unit, isLive, year) {
	if (unit === "hour") {
		const every = bars.length > 24 ? 12 : 6;
		const last = bars.length - 1;
		const labels = bars
			.map((bar, index) => ({ index, hour: Number(bar.first.slice(11)) }))
			.filter(({ index, hour }) => hour % every === 0 && (!isLive || last - index > 1))
			.map(({ index, hour }) => ({
				index,
				label: hour === 0 ? formatDay(bars[index].first.slice(0, 10), year) : formatHour(hour),
				className: isLive && last - index < 5 ? "hidden lg:block" : undefined,
			}));
		if (isLive) labels.push({ index: last, label: "Now", isCentered: true, className: "font-medium text-emerald-600 dark:text-emerald-400" });
		return labels;
	}
	const step = unit === "day" ? (bars.length <= 7 ? 1 : 7 * Math.max(1, Math.round(bars.length / 35))) : Math.max(1, Math.round(bars.length / 6));
	const labels = [];
	for (let index = bars.length - 1, position = 0; index >= 0; index -= step, position += 1) {
		const first = bars[index].first;
		labels.push({
			index,
			label: unit === "month" ? formatMonth(first, year) : formatDay(first, year),
			className: position % 2 ? HIDDEN_ON_PHONES : undefined,
		});
	}
	return labels;
}

// "Mon, Oct 27, 2 PM – 3 PM", "Mon, Oct 27", "Oct 6 – Oct 12, 2026", "October 2026", or the days of a month in part.
function describeBar(first, last, unit, year) {
	if (unit === "hour") {
		const hour = Number(first.slice(11));
		return `${formatDay(first.slice(0, 10), year, WEEKDAY)}, ${formatHour(hour)} – ${formatHour((hour + 1) % 24)}`;
	}
	if (unit === "day") return formatDay(first, year, WEEKDAY);
	if (unit === "month" && isWholeMonth(first, last)) return formatDateKey(first, { month: "long", year: "numeric" });
	return formatDateKeyRange(first, last);
}

// "Sun, Oct 26, 2 PM": the same hour of the period before.
function describeHour(key, year) {
	return `${formatDay(key.slice(0, 10), year, WEEKDAY)}, ${formatHour(Number(key.slice(11)))}`;
}

// "Oct 8", with its year when it isn't the year of the chart's last bar.
function formatDay(key, year, options = DAY) {
	return formatDateKey(key, key.startsWith(year) ? options : { ...options, year: "numeric" });
}

function formatMonth(key, year) {
	return formatDateKey(key, key.startsWith(year) ? { month: "short" } : { month: "short", year: "numeric" });
}

function isWholeMonth(first, last) {
	const [year, month] = first.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return first.endsWith("-01") && last === `${first.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
}
