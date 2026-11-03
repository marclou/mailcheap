"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown, Loader2 } from "lucide-react";
import InputDate from "@/components/InputDate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_RANGE_DAYS, PERIODS, PERIOD_DAYS, getPeriodDays, getRangePeriod } from "@/lib/overview-series";
import { shiftDateKey } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

const PERIOD_PARAMS = ["days", "from", "to"];

// The overview's period: one of PERIODS, or a custom range of days, kept in the page's address as ?days=, or ?from= and
// ?to=, without either for the default. todayKey: today in the account's timezone, the last day a range can end on.
// The period picked names the button at once, with a spinner, and data-pending fades the numbers it changes until
// they come.
export default function ButtonPeriod({ period, todayKey }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [shown, setShown] = useOptimistic(period);
	const Icon = isPending ? Loader2 : CalendarDays;

	function show(next, query) {
		setIsOpen(false);
		if (next.label === shown.label) return;
		const params = new URLSearchParams(searchParams);
		for (const key of PERIOD_PARAMS) params.delete(key);
		for (const [key, value] of Object.entries(query)) params.set(key, value);
		startTransition(() => {
			setShown(next);
			router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
		});
	}

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" data-pending={isPending ? "" : undefined} className="tabular-nums">
					<Icon data-icon="inline-start" aria-hidden="true" className={cn(isPending && "animate-spin")} />
					{shown.label}
					<ChevronDown data-icon="inline-end" aria-hidden="true" className="text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" aria-label="Period" className="w-80 max-w-[calc(100vw-1rem)] p-1.5">
				<div role="radiogroup" aria-label="Last days" className="flex flex-col">
					{PERIODS.map((preset) => {
						const isPicked = !shown.from && shown.days === preset.days;
						return (
							<button
								key={preset.days}
								type="button"
								role="radio"
								aria-checked={isPicked}
								onClick={() => show(preset, preset.days === PERIOD_DAYS ? {} : { days: preset.days })}
								className="flex h-8 items-center justify-between gap-2 rounded-md px-2 text-sm outline-none transition-colors duration-150 hover:bg-muted focus-visible:bg-muted aria-checked:font-medium"
							>
								{preset.label}
								{isPicked && <Check aria-hidden="true" className="size-4" />}
							</button>
						);
					})}
				</div>
				<div className="-mx-1.5 my-1.5 h-px bg-border" />
				{isOpen && <FormRange period={shown} todayKey={todayKey} onApply={(from, to) => show(getRangePeriod(from, to), { from, to })} />}
			</PopoverContent>
		</Popover>
	);
}

// Two days, both included, starting on the period shown: each calendar keeps them in order, up to today and
// MAX_RANGE_DAYS apart at most.
function FormRange({ period, todayKey, onApply }) {
	const fromId = useId();
	const toId = useId();
	const shownDays = getPeriodDays(period, todayKey);
	const [from, setFrom] = useState(shownDays.from);
	const [to, setTo] = useState(shownDays.to);
	const lastTo = from && shiftDateKey(from, MAX_RANGE_DAYS - 1) < todayKey ? shiftDateKey(from, MAX_RANGE_DAYS - 1) : todayKey;

	function apply(event) {
		event.preventDefault();
		if (from && to) onApply(from, to);
	}

	return (
		<form onSubmit={apply} className="flex flex-col gap-3 p-1.5">
			<span className="text-sm font-medium">Custom range</span>
			<div className="grid grid-cols-2 gap-2">
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor={fromId} className="text-xs font-normal text-muted-foreground">
						From
					</Label>
					<InputDate
						id={fromId}
						value={from}
						onChange={setFrom}
						min={to ? shiftDateKey(to, 1 - MAX_RANGE_DAYS) : undefined}
						max={to || todayKey}
						isClearable={false}
					/>
				</div>
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor={toId} className="text-xs font-normal text-muted-foreground">
						To
					</Label>
					<InputDate id={toId} value={to} onChange={setTo} min={from || undefined} max={lastTo} isClearable={false} />
				</div>
			</div>
			<Button type="submit" size="sm" disabled={!from || !to}>
				Apply
			</Button>
		</form>
	);
}
