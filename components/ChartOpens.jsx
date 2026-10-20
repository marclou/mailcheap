import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { niceScale, toRatio } from "@/lib/charts";
import { formatNumber, formatWeekdayHour } from "@/lib/format";
import { findPeak } from "@/lib/report-stats";

// First opens in each hour after a send started, with its first clicks in front, as ChartSends draws today in front
// of yesterday. The hour with the most opens is marked. A fresh send's hours to come stay empty, past a line at now.
export default function ChartOpens({ timeline, timeZone }) {
	const { hours } = timeline;
	const scale = niceScale([0, ...hours.flatMap(({ opens, clicks }) => [opens, clicks])], 3);
	const xOf = (index) => (index + 0.5) / hours.length;
	const peak = findPeak(hours);
	const nowIndex = hours.findIndex(({ isFuture }) => isFuture);
	const opens = hours.reduce((sum, hour) => sum + hour.opens, 0);
	const clicks = hours.reduce((sum, hour) => sum + hour.clicks, 0);

	const points = hours
		.map((hour, index) => ({ ...hour, index }))
		.filter(({ isFuture }) => !isFuture)
		.map(({ at, opens: hourOpens, clicks: hourClicks, index }) => ({
			x: xOf(index),
			title: `${formatWeekdayHour(at, timeZone)} · ${formatAfter(index)}`,
			rows: [
				{ label: "Opens", value: formatNumber(hourOpens), swatch: "ghost" },
				{ label: "Clicks", value: formatNumber(hourClicks), swatch: "bar" },
			],
		}));
	const xLabels = ticksFor(hours.length).map((hour) => ({ x: hour / hours.length, label: tickLabel(hour) }));

	return (
		<ChartFrame scale={scale} xLabels={xLabels} className="h-36 sm:h-44">
			<div
				role="img"
				aria-label={`${formatNumber(opens)} opens and ${formatNumber(clicks)} clicks in the ${formatSpan(hours.length)} after sending${peak === null ? "" : `, most opens at ${formatWeekdayHour(hours[peak].at, timeZone)}`}`}
				className="absolute inset-0 flex items-end gap-px sm:gap-[2px]"
			>
				{hours.map(({ at, opens: hourOpens, clicks: hourClicks, isFuture }, index) => (
					<div key={at.toISOString()} className="relative h-full flex-1">
						{!isFuture && hourOpens > 0 && (
							<span
								className={
									index === peak
										? "absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[2px] bg-muted-foreground/45"
										: "absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[2px] bg-muted-foreground/25"
								}
								style={{ height: `${toRatio(hourOpens, scale) * 100}%` }}
							/>
						)}
						{!isFuture && hourClicks > 0 && (
							<span
								className="absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[2px] bg-foreground"
								style={{ height: `${toRatio(hourClicks, scale) * 100}%` }}
							/>
						)}
						{index === peak && (
							<span
								className="absolute left-1/2 -translate-x-1/2 text-[10px] leading-none font-medium whitespace-nowrap text-foreground"
								style={{ bottom: `calc(${toRatio(hourOpens, scale) * 100}% + 5px)` }}
							>
								Peak
							</span>
						)}
					</div>
				))}
			</div>
			{nowIndex > 0 && (
				<div aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-muted-foreground/40" style={{ left: `${(nowIndex / hours.length) * 100}%` }}>
					<span className="absolute top-0 left-1.5 text-[10px] leading-none text-muted-foreground">Now</span>
				</div>
			)}
			{opens === 0 && clicks === 0 && (
				<p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">No opens yet</p>
			)}
			<Suspense fallback={null}>
				<ChartHover points={points} band={1 / hours.length} />
			</Suspense>
		</ChartFrame>
	);
}

// Axis marks every 6, 12 or 24 hours, depending on how many hours the chart holds.
function ticksFor(length) {
	const step = length <= 24 ? 6 : length <= 48 ? 12 : 24;
	const ticks = [];
	for (let hour = 0; hour <= length; hour += step) ticks.push(hour);
	return ticks;
}

function tickLabel(hour) {
	if (hour === 0) return "Sent";
	if (hour % 24 === 0) return `${hour / 24} day${hour === 24 ? "" : "s"}`;
	return `${hour} h`;
}

function formatAfter(index) {
	return index === 0 ? "first hour" : `${index} h after`;
}

function formatSpan(length) {
	if (length === 24) return "first day";
	return length % 24 === 0 ? `first ${length / 24} days` : `first ${length} hours`;
}
