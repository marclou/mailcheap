import { cn } from "@/lib/utils";

// A settings section like the newsletter's: a title, an action on its right, and rows under a line. isStreamed: it takes
// its skeleton's place (Suspense), so it only fades in.
export default function CardSettings({ title, action, stagger = 0, isStreamed = false, className, children }) {
	return (
		<section
			style={{ "--stagger": stagger }}
			className={cn("rounded-xl bg-card shadow-border", isStreamed ? "animate-fade-in" : "animate-enter", className)}
		>
			<div className="flex h-12 items-center justify-between gap-3 px-4">
				<h2 className="text-sm font-medium">{title}</h2>
				{action}
			</div>
			{children && <div className="divide-y divide-border/60 border-t border-border/60">{children}</div>}
		</section>
	);
}

// isLabel: the row holds a field, which clicking the label focuses.
export function RowSettings({ label, hint, isLabel = false, children }) {
	const Row = isLabel ? "label" : "div";

	return (
		<Row className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
			<span className="text-sm text-muted-foreground sm:pt-2">{label}</span>
			<span className="flex min-w-0 flex-col gap-1.5">
				{children}
				{hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
			</span>
		</Row>
	);
}
