import TextEmpty from "@/components/TextEmpty";
import { cn } from "@/lib/utils";

// A row of numbers in one card, two columns on phones.
export default function GridStats({ items, className }) {
	return (
		<div className={cn("overflow-hidden rounded-xl bg-card shadow-border", className)}>
			<dl
				className={cn(
					"grid grid-cols-2 gap-px bg-border/60",
					items.length % 3 === 0 ? "lg:grid-cols-3" : "lg:grid-cols-4"
				)}
			>
				{items.map(({ label, value, detail, tone }) => (
					<div key={label} className="flex min-h-[88px] flex-col gap-1 bg-card px-4 py-3.5">
						<dt className="text-[13px] text-muted-foreground">{label}</dt>
						<dd className={cn("text-2xl font-semibold tracking-tight tabular-nums", TONES[tone])}>
							{value ?? <TextEmpty />}
						</dd>
						{detail && <dd className="text-xs text-muted-foreground tabular-nums">{detail}</dd>}
					</div>
				))}
			</dl>
		</div>
	);
}

const TONES = {
	good: "text-emerald-600 dark:text-emerald-400",
};
