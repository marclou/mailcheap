import { CloudOff } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import CardSettings from "@/components/CardSettings";
import { formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Past it, sends are close to waiting for room.
const NEAR_CAP = 0.8;

// capacity: getSendingCapacity's promise (lib/sending-capacity.js), started with the page's other reads.
export default async function CardSendingCapacity({ capacity }) {
	const { lanes, error } = await capacity;
	return (
		<CardSettings
			title="Sending capacity"
			action={<span className="text-xs text-muted-foreground">Shared by every account</span>}
			isStreamed
			className="overflow-hidden"
		>
			{error ? (
				<p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
					<CloudOff className="size-4 shrink-0" aria-hidden="true" />
					{ERRORS[error]}
				</p>
			) : (
				<div className={cn("grid gap-px bg-border/60", lanes.length > 1 && "sm:grid-cols-2 lg:grid-cols-1")}>
					{lanes.map((lane) => (
						<Lane key={lane.label} {...lane} />
					))}
				</div>
			)}
		</CardSettings>
	);
}

function Lane({ label, status, meters, perSecond }) {
	return (
		<div className="flex flex-col gap-3 bg-card px-4 py-3.5">
			<div className="flex h-6 items-center justify-between gap-3">
				<h3 className="truncate text-sm font-medium">{label}</h3>
				{status && <BadgeStatus status={status.status} label={status.label} />}
			</div>
			{meters.map((meter) => (
				<Meter key={meter.label} {...meter} />
			))}
			{perSecond > 0 && <p className="text-xs text-muted-foreground tabular-nums">Up to {formatNumber(perSecond)} a second</p>}
		</div>
	);
}

function Meter({ label, used, cap }) {
	const ratio = cap > 0 ? Math.min(used / cap, 1) : 0;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-3 text-xs tabular-nums">
				<span className="text-muted-foreground">{label}</span>
				<span>
					<span className="font-medium">{formatNumber(used)}</span>
					<span className="text-muted-foreground"> / {formatCompact(cap)}</span>
				</span>
			</div>
			<div
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={cap}
				aria-valuenow={Math.min(used, cap)}
				aria-valuetext={`${formatNumber(used)} of ${formatNumber(cap)}`}
				className="h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div
					className={cn("h-full rounded-full", ratio >= 1 ? "bg-red-500" : ratio >= NEAR_CAP ? "bg-amber-500" : "bg-foreground")}
					style={{ width: `${ratio > 0 ? Math.max(ratio * 100, 2) : 0}%` }}
				/>
			</div>
		</div>
	);
}

const ERRORS = {
	unconfigured: "No email provider set up yet",
	unreadable: "Unavailable right now",
};
