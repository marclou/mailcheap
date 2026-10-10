// A small number with its label, for the columns of a list row.
export default function StatInline({ label, value }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{value}</dd>
		</div>
	);
}
