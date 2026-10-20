import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// A section of the settings overview (lib/settings-summary.js): its icon, or media in its place, its name and where it
// stands. swatches: colors shown before the state, like a theme's.
export default function CardSettingsSection({ href, icon: Icon, media, label, state, swatches, stagger }) {
	return (
		<Link
			href={href}
			style={{ "--stagger": stagger }}
			className="group flex h-full items-center gap-3.5 rounded-xl bg-card p-4 shadow-border outline-none transition-[box-shadow,scale] duration-150 ease-out animate-enter hover:shadow-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
		>
			{media ?? (
				<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground/75">
					<Icon className="size-[18px]" aria-hidden="true" />
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				<span
					className={cn(
						"flex min-w-0 items-center gap-1.5 text-sm",
						state.tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
					)}
				>
					<IconState tone={state.tone} />
					{swatches && <ListSwatches colors={swatches} />}
					<span className="truncate">{state.text}</span>
				</span>
			</span>
			<ChevronRight
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground/60 transition-[translate,color] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
			/>
		</Link>
	);
}

function IconState({ tone }) {
	if (tone === "warning") return <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />;
	if (tone !== "on" && tone !== "off") return null;
	return (
		<span
			aria-hidden="true"
			className={cn("size-1.5 shrink-0 rounded-full", tone === "on" ? "bg-emerald-500" : "bg-muted-foreground/40")}
		/>
	);
}

function ListSwatches({ colors }) {
	return (
		<span aria-hidden="true" className="flex shrink-0 -space-x-1">
			{colors.map((color, index) => (
				<span
					key={index}
					style={{ backgroundColor: color }}
					className="size-3.5 rounded-full shadow-[0_0_0_2px_var(--card),inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_2px_var(--card),inset_0_0_0_1px_rgb(255_255_255/0.16)]"
				/>
			))}
		</span>
	);
}
