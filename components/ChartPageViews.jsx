import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { niceScale, toRatio } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import { formatDateKey } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

const WEEKDAY = { weekday: "short", month: "short", day: "numeric" };

// An issue's page views each day (lib/page-views.js), today's brighter, and a dot for each day to come. published: the
// key of the day it went on the website, when the chart starts there. It takes the height its card leaves it.
export default function ChartPageViews({ days, today, published }) {
	const counted = days.filter(({ views }) => views !== null);
	const scale = niceScale([0, ...counted.map(({ views }) => views)], 3);
	const xOf = (index) => (index + 0.5) / days.length;
	const total = counted.reduce((sum, { views }) => sum + views, 0);

	const points = days.map(({ key, views }, index) => ({
		x: xOf(index),
		title: key === published ? `${formatDateKey(key, WEEKDAY)} · Published` : formatDateKey(key, WEEKDAY),
		rows: [{ label: "Views", value: views === null ? "To come" : formatNumber(views), swatch: views === null ? undefined : "bar" }],
	}));
	const step = Math.max(1, Math.round(days.length / 4));
	const labels = [];
	for (let index = 0; index < days.length; index += step) labels.push(index);
	if (days.length - 1 - labels.at(-1) < step / 2) labels.pop();
	labels.push(days.length - 1);
	const xLabels = labels.map((index, position) => ({
		x: xOf(index),
		label: days[index].key === today ? "Today" : formatDateKey(days[index].key),
		className: position > 0 && position < labels.length - 1 ? "hidden sm:block" : undefined,
	}));

	return (
		<ChartFrame scale={scale} xLabels={xLabels} frameClassName="min-h-0 flex-1 grid-rows-[minmax(9rem,1fr)_auto]" className="h-full">
			<div
				role="img"
				aria-label={`${formatNumber(total)} page views from ${formatDateKey(days[0].key)} to ${formatDateKey(today)}`}
				className="absolute inset-0 flex items-end gap-[2px] sm:gap-1"
			>
				{days.map(({ key, views }) => (
					<div key={key} className="relative flex h-full flex-1 items-end justify-center">
						{views === null ? (
							<span className="mb-px size-1 rounded-full bg-foreground/15" />
						) : (
							views > 0 && (
								<span
									className={cn(
										"absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[3px]",
										key === today ? "bg-foreground" : "bg-foreground/70"
									)}
									style={{ height: `${toRatio(views, scale) * 100}%` }}
								/>
							)
						)}
					</div>
				))}
			</div>
			{total === 0 && (
				<p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-pretty text-muted-foreground">
					Each day&apos;s views show here as readers open the page
				</p>
			)}
			<Suspense fallback={null}>
				<ChartHover points={points} band={1 / days.length} />
			</Suspense>
		</ChartFrame>
	);
}
