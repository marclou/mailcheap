import TextEmpty from "@/components/TextEmpty";
import TooltipChange from "@/components/TooltipChange";
import { LIMITS } from "@/lib/config";
import { formatChange, formatCompact, formatNumber, formatRate } from "@/lib/format";
import { rateTone } from "@/lib/health";
import { compareCount, compareRate } from "@/lib/overview-series";
import { cn } from "@/lib/utils";

// The email stats of a period, each with its change from the period before, span long, like "30 days". A rate changes
// by the difference between the two rates.
export default function ListStats({ current, previous, span }) {
	const reached = current.delivered || current.sent;
	const previousReached = previous.delivered || previous.sent;
	const rate = (key, total, previousTotal, digits = 1) => ({
		value: formatRate(current[key], total, digits),
		previousValue: formatRate(previous[key], previousTotal, digits),
		change: compareRate(current[key], total, previous[key], previousTotal),
		digits,
	});

	const stats = [
		{
			label: "Sent",
			value: formatCompact(current.sent),
			title: formatNumber(current.sent),
			previousValue: formatNumber(previous.sent),
			change: compareCount(current.sent, previous.sent),
			digits: 0,
			isCount: true,
		},
		{ label: "Delivered", ...rate("delivered", current.sent, previous.sent), higherIsBetter: true },
		{ label: "Opened", ...rate("opened", reached, previousReached), higherIsBetter: true },
		{ label: "Clicked", ...rate("clicked", reached, previousReached), higherIsBetter: true },
		{
			label: "Bounced",
			...rate("bounced", current.sent, previous.sent, 2),
			tone: rateTone(current.bounced, current.sent, LIMITS.pause.bounceRate),
		},
		{
			label: "Complaints",
			...rate("complained", current.sent, previous.sent, 3),
			tone: rateTone(current.complained, current.sent, LIMITS.pause.complaintRate),
		},
	];

	return (
		<dl className="grid grid-cols-3 gap-px bg-border/60 lg:grid-cols-6">
			{stats.map(({ label, value, title, previousValue, change, digits, isCount, higherIsBetter, tone = "default" }) => {
				const text = formatChange(change, { digits });
				const previousLabel = `${previousValue} in the previous ${span}`;
				return (
					<div key={label} className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3.5 sm:px-5">
						<dt className="text-xs text-muted-foreground">{label}</dt>
						<dd
							title={title}
							className={cn("text-lg font-semibold tracking-tight tabular-nums", VALUE_TONES[tone])}
						>
							{value ?? <TextEmpty />}
						</dd>
						<dd className={cn("text-xs tabular-nums", CHANGE_TONES[changeTone(change, digits, isCount, higherIsBetter)])}>
							{text ? (
								<TooltipChange label={previousLabel}>
									{text}
									<span className="sr-only"> ({previousLabel})</span>
								</TooltipChange>
							) : (
								<TextEmpty label="No earlier data" />
							)}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

// Sent volume is neither good nor bad; rates are, in their own direction.
function changeTone(change, digits, isCount, higherIsBetter) {
	const rounded = Number((change ?? 0).toFixed(digits));
	if (isCount || rounded === 0) return "neutral";
	return rounded > 0 === Boolean(higherIsBetter) ? "good" : "bad";
}

const VALUE_TONES = {
	default: "",
	warn: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
};

const CHANGE_TONES = {
	neutral: "text-muted-foreground",
	good: "text-emerald-600 dark:text-emerald-400",
	bad: "text-red-600 dark:text-red-400",
};
