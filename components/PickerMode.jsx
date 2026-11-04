"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

// A newsletter's website in its theme's light or dark colors, or the ones the reader's device uses: System, where
// everyone starts. ProviderTheme keeps the choice in the reader's browser, for the whole website. Which one is picked
// is only known in the browser, so the server renders none.
export default function PickerMode() {
	const { theme, setTheme } = useTheme();
	const isClient = useIsClient();
	const value = isClient ? (theme ?? "system") : null;

	function move(event, index) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = MODES[(index + step + MODES.length) % MODES.length];
		setTheme(next.value);
		event.currentTarget.parentElement.querySelector(`[data-value="${next.value}"]`)?.focus();
	}

	return (
		<div role="radiogroup" aria-label="Appearance" className="flex h-8 items-center gap-0.5 rounded-full p-0.5 inset-ring inset-ring-border">
			{MODES.map(({ value: mode, label, icon: Icon }, index) => {
				const isChecked = value === mode;
				return (
					<button
						key={mode}
						type="button"
						role="radio"
						aria-checked={isChecked}
						aria-label={label}
						title={label}
						data-value={mode}
						tabIndex={isChecked || (!value && index === 0) ? 0 : -1}
						onClick={() => setTheme(mode)}
						onKeyDown={(event) => move(event, index)}
						className={cn(
							"grid size-7 place-items-center rounded-full text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.94]",
							isChecked && "bg-muted text-foreground"
						)}
					>
						<Icon className="size-3.5" aria-hidden="true" />
					</button>
				);
			})}
		</div>
	);
}

const MODES = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
];
