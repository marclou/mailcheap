import { toRatio } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Gridlines with their values on the left and labels under the plot; the chart draws inside.
// Labels are placed by x (0 to 1) and shift by the same ratio, so the first and last stay inside. A centered one
// sits right under its x, to point at one bar. className: the plot's, frameClassName: the whole frame's.
export default function ChartFrame({ scale, xLabels, formatTick = formatNumber, className, frameClassName, children }) {
	const ticks = scale.ticks.map((tick) => ({
		tick,
		top: `${(1 - toRatio(tick, scale)) * 100}%`,
		label: formatTick(tick),
	}));
	const widest = ticks.reduce((longest, { label }) => (label.length > longest.length ? label : longest), "");

	return (
		<div className={cn("grid grid-cols-[auto_1fr] gap-x-3 text-[11px] text-muted-foreground tabular-nums", frameClassName)}>
			<div aria-hidden="true" className="relative">
				<span className="invisible">{widest}</span>
				{ticks.map(({ tick, top, label }) => (
					<span key={tick} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top }}>
						{label}
					</span>
				))}
			</div>
			<div className={cn("relative", className)}>
				{ticks.map(({ tick, top }) => (
					<span
						key={tick}
						aria-hidden="true"
						className="absolute inset-x-0 border-t border-dashed border-border"
						style={{ top }}
					/>
				))}
				{children}
			</div>
			<div aria-hidden="true" className="relative col-start-2 mt-3 h-3.5">
				{xLabels.map(({ x, label, isCentered, className: labelClassName }) => (
					<span
						key={`${x} ${label}`}
						className={cn("absolute top-0 leading-none whitespace-nowrap", labelClassName)}
						style={{ left: `${x * 100}%`, transform: `translateX(-${(isCentered ? 0.5 : x) * 100}%)` }}
					>
						{label}
					</span>
				))}
			</div>
		</div>
	);
}
