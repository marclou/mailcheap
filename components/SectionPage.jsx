import { formatNumber } from "@/lib/format";

// A titled block of a page; the stagger staggers the blocks' entrance.
export default function SectionPage({ title, meta, action, stagger = 0, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter">
			<div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<div className="flex items-center gap-2 whitespace-nowrap">
					<h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
					{meta}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

// "1,204 available", next to a section's title.
export function SectionCount({ value, label }) {
	if (!value) return null;
	return (
		<span className="text-xs text-muted-foreground tabular-nums">
			{formatNumber(value)} {label}
		</span>
	);
}
