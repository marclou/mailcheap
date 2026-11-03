import ChartPageViews from "@/components/ChartPageViews";
import { formatNumber } from "@/lib/format";
import { formatDateKey } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

// An issue's page views (lib/page-views.js): in all, today's, the last 7 days' and its best day's, and each day's since
// it went on the website. days: null without them, for the total alone.
export default function CardPageViews({ views: { total, days, today, published, since }, className, style }) {
	const counted = days?.filter(({ views }) => views !== null) ?? [];
	const best = counted.reduce((top, day) => (day.views > (top?.views ?? 0) ? day : top), null);
	const stats = days && [
		{ label: "Today", value: formatNumber(counted.find(({ key }) => key === today)?.views ?? 0) },
		{ label: "Last 7 days", value: formatNumber(counted.slice(-7).reduce((sum, { views }) => sum + views, 0)) },
		best && { label: "Best day", value: formatNumber(best.views), detail: formatDateKey(best.key) },
	].filter(Boolean);

	return (
		<section style={style} className={cn("flex flex-col gap-5 rounded-xl bg-card p-5 shadow-border sm:p-6", className)}>
			<div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Page views</h2>
					<p className="text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(total)}</p>
				</div>
				{stats && (
					<dl className="flex flex-wrap gap-x-8 gap-y-3">
						{stats.map(({ label, value, detail }) => (
							<div key={label} className="flex flex-col gap-1">
								<dt className="text-xs text-muted-foreground">{label}</dt>
								<dd className="text-sm font-medium tabular-nums">
									{value}
									{detail && <span className="font-normal text-muted-foreground">{` · ${detail}`}</span>}
								</dd>
							</div>
						))}
					</dl>
				)}
			</div>
			{days && <ChartPageViews days={days} today={today} published={published} />}
			<p className="-mt-1 text-xs text-muted-foreground">
				Once per reader a day{since && `, and day by day since ${formatDateKey(since)}`}
			</p>
		</section>
	);
}
