import SwatchChart from "@/components/SwatchChart";

// A chart's series, each with its mark and an optional value; an item without a swatch is a plain note.
export default function ListLegend({ items }) {
	return (
		<ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
			{items.map(({ swatch, label, value }) => (
				<li key={label} className="flex items-center gap-2">
					{swatch && <SwatchChart kind={swatch} />}
					{label}
					{value && <span className="font-medium text-foreground tabular-nums">{value}</span>}
				</li>
			))}
		</ul>
	);
}
