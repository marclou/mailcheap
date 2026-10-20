import IconWarmup from "@/components/IconWarmup";
import LinkHelp from "@/components/LinkHelp";
import ProgressWarmup from "@/components/ProgressWarmup";
import { WARMUP } from "@/lib/config";
import { formatCount, formatDate, formatNumber } from "@/lib/format";
import { getPaceRoom } from "@/lib/send-spread";

// On the overview while the account warms up: how many emails go out at once now, and how that grows (lib/send-spread.js).
export default function CardWarmup({ pace }) {
	const { warmup } = pace;
	return (
		<div className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-border sm:p-6">
			<div className="flex items-center justify-between gap-3">
				<h2 className="flex items-center gap-2 text-sm font-medium">
					<IconWarmup className="text-muted-foreground" />
					{warmup.hasStarted ? "Your account is warming up" : "Your account warms up with its first campaign"}
				</h2>
				<span className="shrink-0 text-sm text-muted-foreground tabular-nums">
					{warmup.hasStarted ? `Day ${warmup.day} of ${warmup.days}` : `${warmup.days} days`}
				</span>
			</div>
			<ProgressWarmup warmup={warmup} />
			<p className="text-sm text-pretty text-muted-foreground tabular-nums">
				Up to {formatNumber(getPaceRoom(pace))} emails go out at once. A bigger send goes out over more hours, up to{" "}
				{formatCount(WARMUP.maxHours / 24, "day")}, so mailbox providers like Gmail see your volume grow gradually and a problem with a
				list shows up early. A day after each send with few bounces and complaints, that number grows: {WARMUP.growth.first} times your
				largest send at first, {WARMUP.growth.last} times by {warmup.hasStarted ? formatDate(warmup.endsAt) : `day ${warmup.days}`}.{" "}
				<LinkHelp article="warm-up" />
			</p>
		</div>
	);
}
