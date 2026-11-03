"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, BookOpen, ChevronDown, X } from "lucide-react";
import { DotStatus, statusLabel } from "@/components/BadgeStatus";
import InputDate from "@/components/InputDate";
import InputSearch from "@/components/InputSearch";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	FILTER_PARAMS,
	SIGNUP_MODES,
	describeSignupDays,
	fromSignupDays,
	getSourceLabel,
	toSignupDays,
} from "@/lib/contact-filters";
import { formatCount, formatNumber } from "@/lib/format";
import { getHelpHref } from "@/lib/help";
import { readDateKey } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

const ALL = "__all";
const NO_FILTERS = Object.fromEntries(FILTER_PARAMS.map((key) => [key, null]));

// The search by address and the filters, kept in the page's address: a status, the signup date, where contacts came
// from and a tag. statuses: [{ value, count }] for the same search and filters, total: all of them. tags and sources:
// [{ name, contacts }], most first. count: the contacts the list shows.
export default function FilterContacts({ statuses = [], total = 0, tags = [], sources = [], count }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [query, setQuery] = useState(searchParams.get("q") ?? "");
	const [isPending, startTransition] = useTransition();
	const timeout = useRef(null);
	const status = searchParams.get("status") ?? "";
	const tag = searchParams.get("tag") ?? "";
	const source = searchParams.get("source") ?? "";
	const signupDays = {
		signedUpSince: readDateKey(searchParams.get("signedUpSince")),
		signedUpBefore: readDateKey(searchParams.get("signedUpBefore")),
	};
	const signupLabel = describeSignupDays(signupDays);
	const hasFilters = Boolean(status || tag || source || signupLabel);

	function navigate(changes) {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(changes)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		params.delete("page");
		startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false }));
	}

	function onQueryChange(value) {
		setQuery(value);
		clearTimeout(timeout.current);
		const q = value.trim();
		if (q) timeout.current = setTimeout(() => navigate({ q }), 300);
		else navigate({ q });
	}

	useEffect(() => () => clearTimeout(timeout.current), []);

	return (
		<div className="flex flex-col gap-2 md:flex-row md:items-start">
			<InputSearch
				value={query}
				onChange={onQueryChange}
				isPending={isPending}
				placeholder="Search by email or domain"
				aria-label="Search by email or domain"
				className="md:w-56 md:shrink-0"
			/>
			<div className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 p-1 max-md:overflow-x-auto max-md:[scrollbar-width:none] md:flex-wrap">
				<ChipFilter label="Status" value={status && statusLabel(status)} onClear={() => navigate({ status: null })}>
					{(trigger) => (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-56">
								<DropdownMenuRadioGroup value={status || ALL} onValueChange={(value) => navigate({ status: value === ALL ? null : value })}>
									<ItemCount value={ALL} count={total}>
										All statuses
									</ItemCount>
									<DropdownMenuSeparator />
									{statuses.map((item) => (
										<ItemCount key={item.value} value={item.value} count={item.count}>
											<DotStatus status={item.value} className="mx-1" />
											{statusLabel(item.value)}
										</ItemCount>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</ChipFilter>

				<ChipFilter label="Signed up" value={signupLabel} onClear={() => navigate({ signedUpSince: null, signedUpBefore: null })}>
					{(trigger) => <PopoverSignup trigger={trigger} days={signupDays} onChange={navigate} />}
				</ChipFilter>

				{(sources.length > 0 || source) && (
					<ChipFilter label="Source" value={source && getSourceLabel(source)} onClear={() => navigate({ source: null })}>
						{(trigger) => (
							<MenuOptions
								trigger={trigger}
								value={source}
								allLabel="All sources"
								options={sources}
								getLabel={getSourceLabel}
								hint="How each contact joined your list."
								help={{ label: "How sources work", href: getHelpHref("contacts", "sources") }}
								onChange={(value) => navigate({ source: value })}
							/>
						)}
					</ChipFilter>
				)}

				{(tags.length > 0 || tag) && (
					<ChipFilter label="Tag" value={tag} onClear={() => navigate({ tag: null })}>
						{(trigger) => (
							<MenuOptions
								trigger={trigger}
								value={tag}
								allLabel="All tags"
								options={tags}
								hint="Labels you add in a contact's ⋯ menu."
								help={{ label: "How tags work", href: getHelpHref("contacts", "tags") }}
								onChange={(value) => navigate({ tag: value })}
							/>
						)}
					</ChipFilter>
				)}

				{hasFilters && (
					<Button variant="ghost" size="sm" onClick={() => navigate(NO_FILTERS)} className="shrink-0 rounded-full text-muted-foreground">
						Clear
					</Button>
				)}

				{count !== undefined && (
					<span className="ml-auto shrink-0 pl-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums max-md:hidden">
						{formatCount(count, "contact")}
					</span>
				)}
			</div>
		</div>
	);
}

// A filter as a pill: its name until it's set, then its value too, with a cross that clears it. children: its menu,
// from the trigger it gets.
function ChipFilter({ label, value, onClear, children }) {
	const trigger = (
		<button
			type="button"
			className={cn(
				"flex h-full min-w-0 items-center gap-1.5 rounded-full text-sm whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:text-foreground",
				value ? "pr-1 pl-3" : "px-3 text-muted-foreground hover:text-foreground"
			)}
		>
			{label}
			{value ? (
				<span className="max-w-48 truncate font-medium text-foreground">{value}</span>
			) : (
				<ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
			)}
		</button>
	);

	return (
		<div
			className={cn(
				"inline-flex h-8 shrink-0 items-center rounded-full shadow-border transition-colors duration-150",
				value ? "bg-muted/60" : "hover:bg-muted/60"
			)}
		>
			{children(trigger)}
			{value && (
				<button
					type="button"
					aria-label={`Clear ${label.toLowerCase()}`}
					onClick={onClear}
					className="mr-1 grid size-6 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<X className="size-3.5" />
				</button>
			)}
		</div>
	);
}

function ItemCount({ value, count, children }) {
	return (
		<DropdownMenuRadioItem value={value}>
			<span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
			<span className="text-xs text-muted-foreground tabular-nums">{formatNumber(count)}</span>
		</DropdownMenuRadioItem>
	);
}

// One of a list of names with their counts, like tags or sources. The value picked stays listed when no contact has it.
// Under the list, which scrolls on its own so they stay in sight, hint says what they are and help links to more.
function MenuOptions({ trigger, value, allLabel, options, getLabel = (name) => name, hint, help, onChange }) {
	const items = value && !options.some(({ name }) => name === value) ? [{ name: value, contacts: 0 }, ...options] : options;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 flex-col overflow-hidden"
			>
				<DropdownMenuRadioGroup
					value={value || ALL}
					onValueChange={(next) => onChange(next === ALL ? null : next)}
					className="-mx-1 min-h-0 overflow-y-auto px-1"
				>
					<DropdownMenuRadioItem value={ALL}>{allLabel}</DropdownMenuRadioItem>
					<DropdownMenuSeparator />
					{items.map(({ name, contacts }) => (
						<ItemCount key={name} value={name} count={contacts}>
							<span className="truncate">{getLabel(name)}</span>
						</ItemCount>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="font-normal text-pretty">{hint}</DropdownMenuLabel>
				<DropdownMenuItem asChild>
					<a href={help.href} target="_blank" rel="noopener">
						<BookOpen />
						{help.label}
						<ArrowUpRight className="ml-auto text-muted-foreground" />
					</a>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// Before a day, after one, or between two, both included.
function PopoverSignup({ trigger, days, onChange }) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="start" aria-label="Signup date" className="flex w-76 max-w-[calc(100vw-1rem)] flex-col gap-3 p-3">
				{isOpen && (
					<FormSignup
						picked={fromSignupDays(days)}
						onApply={(picked) => {
							onChange(toSignupDays(picked));
							setIsOpen(false);
						}}
					/>
				)}
			</PopoverContent>
		</Popover>
	);
}

function FormSignup({ picked, onApply }) {
	const [mode, setMode] = useState(picked?.mode ?? "after");
	const [day, setDay] = useState(picked?.day ?? "");
	const [endDay, setEndDay] = useState(picked?.endDay ?? "");
	const isBetween = mode === "between";
	const canApply = Boolean(day) && (!isBetween || (endDay && endDay >= day));

	function apply(event) {
		event.preventDefault();
		if (canApply) onApply({ mode, day, endDay: isBetween ? endDay : null });
	}

	return (
		<form onSubmit={apply} className="flex flex-col gap-3">
			<span className="text-sm font-medium">Signed up</span>
			<div role="radiogroup" aria-label="When" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
				{SIGNUP_MODES.map(({ value, label }) => (
					<button
						key={value}
						type="button"
						role="radio"
						aria-checked={mode === value}
						onClick={() => setMode(value)}
						className={cn(
							"h-7 rounded-md px-2.5 text-sm outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
							mode === value ? "bg-background font-medium text-foreground shadow-border" : "text-muted-foreground hover:text-foreground"
						)}
					>
						{label}
					</button>
				))}
			</div>
			<div className="flex flex-col gap-2">
				<InputDate value={day} onChange={setDay} max={isBetween ? endDay || undefined : undefined} aria-label={isBetween ? "From" : "Day"} />
				{isBetween && <InputDate value={endDay} onChange={setEndDay} min={day || undefined} placeholder="And" aria-label="To" />}
			</div>
			<Button type="submit" size="sm" disabled={!canApply}>
				Apply
			</Button>
		</form>
	);
}
