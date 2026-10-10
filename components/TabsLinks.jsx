import Link from "next/link";
import { cn } from "@/lib/utils";

// Tabs that are links, so the selected one lives in the URL.
export default function TabsLinks({ tabs, label }) {
	return (
		<nav aria-label={label} className="flex w-fit items-center gap-1 rounded-xl bg-muted/70 p-1">
			{tabs.map(({ href, label: tabLabel, isActive, count }) => (
				<Link
					key={href}
					href={href}
					scroll={false}
					aria-current={isActive ? "page" : undefined}
					className={cn(
						"flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
						isActive
							? "bg-background text-foreground shadow-border dark:bg-muted"
							: "text-muted-foreground hover:text-foreground"
					)}
				>
					{tabLabel}
					{count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
				</Link>
			))}
		</nav>
	);
}
