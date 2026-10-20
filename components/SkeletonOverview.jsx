import CardSettings from "@/components/CardSettings";
import HeaderPage from "@/components/HeaderPage";
import SkeletonCampaigns from "@/components/SkeletonCampaigns";
import { Skeleton } from "@/components/ui/skeleton";
import { PERIOD_DAYS } from "@/lib/overview-series";
import { cn } from "@/lib/utils";

// The overview while it loads (loading.js): the same sections, each section's skeleton the size of
// what replaces it.
export default function SkeletonOverview() {
	return (
		<>
			<HeaderPage title="Overview" />
			<div className="flex flex-col gap-8">
				<SectionSkeleton title={`Last ${PERIOD_DAYS} days`}>
					<div className="overflow-hidden rounded-2xl bg-card shadow-border">
						<SkeletonStats />
						<div className="border-t border-border/60">
							<SkeletonSubscribers />
						</div>
					</div>
				</SectionSkeleton>
				<SectionSkeleton title="Today">
					<SkeletonSends />
				</SectionSkeleton>
				<SectionSkeleton title="Campaigns">
					<SkeletonCampaigns rows={5} />
				</SectionSkeleton>
			</div>
		</>
	);
}

export function SkeletonStats() {
	return (
		<div aria-hidden="true" className="grid grid-cols-3 gap-px bg-border/60 lg:grid-cols-6">
			{[12, 16, 14, 13, 15, 18].map((width, index) => (
				<div key={index} className="flex flex-col gap-1 bg-card px-4 py-3.5 sm:px-5">
					<Line height="h-4" className="h-2.5" style={{ width: `${width * 4}px` }} />
					<Line height="h-7" className="h-5 w-14" />
					<Line height="h-4" className="h-2.5 w-9" />
				</div>
			))}
		</div>
	);
}

export function SkeletonSubscribers() {
	return (
		<div aria-hidden="true" className="flex flex-col gap-6 p-5 sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<Line height="h-5" className="h-3 w-20" />
					<Line height="h-10" className="h-8 w-36" />
				</div>
				<div className="flex gap-4">
					<Line height="h-4" className="h-2.5 w-28" />
					<Line height="h-4" className="h-2.5 w-32" />
				</div>
			</div>
			<ChartSkeleton className="h-52 sm:h-64">
				<Skeleton className="absolute inset-x-0 bottom-0 h-3/5 rounded-b-none bg-gradient-to-t from-muted to-muted/20" />
			</ChartSkeleton>
		</div>
	);
}

export function SkeletonSends() {
	return (
		<div aria-hidden="true" className="flex flex-col gap-6 rounded-2xl bg-card p-5 shadow-border sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<Line height="h-5" className="h-3 w-36" />
					<Line height="h-9" className="h-7 w-24" />
				</div>
				<div className="flex gap-4">
					<Line height="h-4" className="h-2.5 w-14" />
					<Line height="h-4" className="h-2.5 w-20" />
					<Line height="h-4" className="h-2.5 w-16" />
				</div>
			</div>
			<ChartSkeleton className="h-36 sm:h-44">
				<div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1.5">
					{BAR_HEIGHTS.map((height, hour) => (
						<Skeleton key={hour} className="flex-1 rounded-b-none rounded-t-[3px]" style={{ height: `${height}%` }} />
					))}
				</div>
			</ChartSkeleton>
		</div>
	);
}

export function SkeletonSesAccount() {
	return (
		<div aria-hidden="true" className="overflow-hidden rounded-xl bg-card shadow-border">
			<div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
				{[20, 14, 22, 16].map((width, index) => (
					<div key={index} className="flex min-h-[66px] flex-col justify-center gap-1.5 bg-card px-4 py-3">
						<Line height="h-4" className="h-2.5 w-16" />
						<div className="flex flex-col gap-1.5">
							<Line height={index < 2 ? "h-6" : "h-5"} className="h-3.5" style={{ width: `${width * 4}px` }} />
							{index === 2 && <Skeleton className="h-1 w-full max-w-32 rounded-full" />}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// CardSendingCapacity while the email provider answers: its two lanes of two meters.
export function SkeletonSendingCapacity() {
	return (
		<CardSettings
			title="Sending capacity"
			action={<span className="text-xs text-muted-foreground">Shared by every account</span>}
			stagger={1}
			className="overflow-hidden"
		>
			<div aria-hidden="true" className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-1">
				{[24, 36].map((width) => (
					<div key={width} className="flex flex-col gap-3 bg-card px-4 py-3.5">
						<Line height="h-6" className="h-3.5" style={{ width: `${width * 4}px` }} />
						{[0, 1].map((meter) => (
							<div key={meter} className="flex flex-col gap-1.5">
								<div className="flex justify-between">
									<Line height="h-4" className="h-2.5 w-16" />
									<Line height="h-4" className="h-2.5 w-20" />
								</div>
								<Skeleton className="h-1.5 w-full rounded-full" />
							</div>
						))}
					</div>
				))}
			</div>
		</CardSettings>
	);
}

function SectionSkeleton({ title, children }) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
			{children}
		</section>
	);
}

// A skeleton bar centered in a box as tall as the line of text it stands for.
function Line({ height, className, style }) {
	return (
		<span className={cn("flex items-center", height)}>
			<Skeleton className={className} style={style} />
		</span>
	);
}

function ChartSkeleton({ className, children }) {
	return (
		<div className="grid grid-cols-[auto_1fr] gap-x-3">
			<div className="flex w-7 flex-col justify-between py-0.5">
				<Skeleton className="h-2 w-6" />
				<Skeleton className="h-2 w-5" />
				<Skeleton className="h-2 w-6" />
			</div>
			<div className={cn("relative overflow-hidden", className)}>{children}</div>
			<div className="col-start-2 mt-3 flex h-3.5 justify-between">
				{[0, 1, 2, 3, 4].map((index) => (
					<Skeleton key={index} className={cn("h-2 w-9", index % 2 && "hidden sm:block")} />
				))}
			</div>
		</div>
	);
}

const BAR_HEIGHTS = [8, 6, 5, 4, 4, 6, 12, 24, 38, 46, 42, 36, 30, 34, 40, 44, 38, 30, 26, 22, 18, 14, 12, 10];
