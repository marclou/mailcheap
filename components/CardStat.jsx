import TextEmpty from "@/components/TextEmpty";
import { cn } from "@/lib/utils";

// change: { text, note, title, isUp } after the detail, for a comparison like "+4.2 pts vs avg", the note left out on
// phones; only a rise gets a color.
export default function CardStat({ label, value, detail, change, tone = "default" }) {
	return (
		<div className="flex flex-col gap-1.5 rounded-xl bg-card p-4 shadow-border">
			<span className="text-[13px] text-muted-foreground">{label}</span>
			<span className={cn("text-2xl font-semibold tracking-tight tabular-nums", VALUE_TONES[tone])}>
				{value ?? <TextEmpty />}
			</span>
			{(detail || change) && (
				<span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground tabular-nums">
					{detail && <span>{detail}</span>}
					{detail && change && <span aria-hidden="true">·</span>}
					{change && (
						<span title={change.title} className={cn(change.isUp && "text-emerald-600 dark:text-emerald-400")}>
							{change.text}
							{change.note && <span className="max-sm:hidden"> {change.note}</span>}
						</span>
					)}
				</span>
			)}
		</div>
	);
}

const VALUE_TONES = {
	default: "",
	good: "text-emerald-600 dark:text-emerald-400",
	warn: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
};
