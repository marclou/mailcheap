import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { areaPath, linePath, niceScale, toRatio } from "@/lib/charts";
import { formatHour, formatNumber } from "@/lib/format";
import { formatDateKey } from "@/lib/time-zone";

// The SVG stretches to the plot; strokes keep their width with non-scaling-stroke.
const BOX = { width: 600, height: 200 };
const DAY = { month: "short", day: "numeric" };
const WEEKDAY = { weekday: "short", ...DAY };

// Subscribers at the end of each point of the period, its days or its hours ("2026-10-08" or "2026-10-08 14" keys),
// over the period before as a dashed line.
export default function ChartSubscribers({ current, previous }) {
	const values = current.map(({ total }) => total);
	const previousValues = previous.map(({ total }) => total);
	const scale = niceScale([...values, ...previousValues]);
	const xOf = (index) => (current.length > 1 ? index / (current.length - 1) : 0);
	const last = current.at(-1);
	const year = last.key.slice(0, 4);

	const points = current.map((day, index) => {
		const before = previous[index];
		return {
			x: xOf(index),
			title: formatPoint(day.key, year, WEEKDAY),
			rows: [
				{ label: "Subscribers", value: formatNumber(day.total), swatch: "line" },
				{ label: "Joined", value: formatNumber(day.joined) },
				{ label: "Left", value: formatNumber(day.left) },
				before && { label: formatPoint(before.key, year), value: formatNumber(before.total), swatch: "dashed" },
			].filter(Boolean),
			dots: [
				before && { y: toRatio(before.total, scale), className: "bg-muted-foreground" },
				{ y: toRatio(day.total, scale), className: "bg-foreground" },
			].filter(Boolean),
		};
	});

	return (
		<ChartFrame scale={scale} xLabels={getXLabels(current, year, xOf)} className="h-52 sm:h-64">
			<div
				role="img"
				aria-label={`Subscribers from ${formatPoint(current[0].key, year)} to ${formatPoint(last.key, year)}: ${formatNumber(current[0].total)} to ${formatNumber(last.total)}`}
				className="absolute inset-0"
			>
				<svg
					viewBox={`0 0 ${BOX.width} ${BOX.height}`}
					preserveAspectRatio="none"
					className="absolute inset-0 size-full overflow-visible"
				>
					<defs>
						<linearGradient id="chart-subscribers-fill" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
							<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
						</linearGradient>
					</defs>
					<path
						d={linePath(previousValues, scale, BOX)}
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeDasharray="3 4"
						vectorEffect="non-scaling-stroke"
						className="text-muted-foreground/50"
					/>
					<path d={areaPath(values, scale, BOX)} fill="url(#chart-subscribers-fill)" className="text-foreground" />
					<path
						d={linePath(values, scale, BOX)}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
						className="text-foreground"
					/>
				</svg>
				<span
					className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-foreground/10"
					style={{ left: "100%", top: `${(1 - toRatio(last.total, scale)) * 100}%` }}
				/>
			</div>
			<Suspense fallback={null}>
				<ChartHover points={points} />
			</Suspense>
		</ChartFrame>
	);
}

// Days: about five labels, whole weeks apart (each day of a week), ending today. Hours: every 6 (every 12 over two
// days), a day's first by its date. Every other one only on wider screens.
function getXLabels(current, year, xOf) {
	const isHourly = current[0].key.length > 10;
	const indexes = [];
	if (isHourly) {
		const every = current.length > 24 ? 12 : 6;
		current.forEach(({ key }, index) => Number(key.slice(11)) % every === 0 && indexes.unshift(index));
	} else {
		const step = current.length <= 7 ? 1 : 7 * Math.max(1, Math.round(current.length / 35));
		for (let index = current.length - 1; index >= 0; index -= step) indexes.push(index);
	}
	return indexes.map((index, position) => {
		const { key } = current[index];
		return {
			x: xOf(index),
			label: isHourly && Number(key.slice(11)) ? formatHour(Number(key.slice(11))) : formatDay(key.slice(0, 10), year),
			className: position % 2 ? "hidden sm:block" : undefined,
		};
	});
}

// "Mon, Oct 8" or "Oct 8" for a day, "Mon, Oct 8, 2 PM" or "Oct 8, 2 PM" for an hour.
function formatPoint(key, year, options = DAY) {
	const day = formatDay(key.slice(0, 10), year, options);
	return key.length > 10 ? `${day}, ${formatHour(Number(key.slice(11)))}` : day;
}

// "Oct 8", with its year when it isn't the year of the chart's last day.
function formatDay(key, year, options = DAY) {
	return formatDateKey(key, key.startsWith(year) ? options : { ...options, year: "numeric" });
}
