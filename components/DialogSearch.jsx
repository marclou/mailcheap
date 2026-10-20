"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CodeXml, CornerDownLeft, FileText, Hash, Search, X } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { SEARCH_GROUPS, getHighlights, getSnippet, search } from "@/lib/search";
import { loadSearchIndex } from "@/lib/search-client";
import { cn } from "@/lib/utils";

// The help center's and the docs' search (components/ButtonSearch.jsx). Results follow the typing; arrows move through
// them, Enter opens one, Escape closes. With nothing typed, it suggests where to start. The input keeps the focus while
// the results are announced as its options.
export default function DialogSearch({ open, onOpenChange }) {
	const router = useRouter();
	const listId = useId();
	const inputRef = useRef(null);
	const [index, setIndex] = useState(null);
	const [hasFailed, setHasFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const deferredQuery = useDeferredValue(query);

	useEffect(() => {
		if (!open || index) return;
		let isCurrent = true;
		loadSearchIndex().then(
			(prepared) => {
				if (!isCurrent) return;
				setHasFailed(false);
				setIndex(prepared);
			},
			() => isCurrent && setHasFailed(true)
		);
		return () => {
			isCurrent = false;
		};
	}, [open, index]);

	const isSearching = deferredQuery.trim().length > 0;
	const groups = useMemo(() => {
		if (!index) return [];
		return isSearching ? search(index, deferredQuery) : getSuggestions(index);
	}, [index, isSearching, deferredQuery]);
	const results = groups.flatMap((group) => group.results);
	const activeIndex = Math.min(active, results.length - 1);
	const optionId = (position) => `${listId}-option-${position}`;

	function moveActive(step) {
		if (results.length === 0) return;
		const next = (activeIndex + step + results.length) % results.length;
		setActive(next);
		document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
	}

	function onKeyDown(event) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			moveActive(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter" && results[activeIndex]) {
			event.preventDefault();
			onOpenChange(false);
			router.push(results[activeIndex].entry.href);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay className="bg-black/25" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						inputRef.current?.focus();
						inputRef.current?.select();
					}}
					className="fixed inset-x-3 top-3 z-50 flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_24px_64px_-16px_rgb(0_0_0/0.35)] outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none sm:inset-x-auto sm:top-[12vh] sm:left-1/2 sm:max-h-[min(34rem,76dvh)] sm:w-[36rem] sm:-translate-x-1/2 dark:shadow-border"
				>
					<DialogTitle className="sr-only">Search help and API</DialogTitle>
					<div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 pr-2 pl-4">
						<Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
						<input
							ref={inputRef}
							type="text"
							role="combobox"
							aria-label="Search help and API"
							aria-autocomplete="list"
							aria-expanded={results.length > 0}
							aria-controls={listId}
							aria-activedescendant={results[activeIndex] ? optionId(activeIndex) : undefined}
							placeholder="Search help and API"
							autoComplete="off"
							autoCorrect="off"
							spellCheck={false}
							enterKeyHint="go"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setActive(0);
							}}
							onKeyDown={onKeyDown}
							className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-[15px]"
						/>
						<DialogPrimitive.Close
							aria-label="Close search"
							className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-[background-color,color] duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
						>
							<kbd className="hidden rounded-md px-1.5 py-0.5 font-sans text-[11px] font-medium shadow-border sm:block">esc</kbd>
							<X className="size-4 sm:hidden" aria-hidden="true" />
						</DialogPrimitive.Close>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
						{!index && <p className="px-3 py-10 text-center text-sm text-muted-foreground">{hasFailed ? "Search can't load right now. Try again in a moment." : "Loading…"}</p>}
						{index && isSearching && groups.length === 0 && (
							<div className="px-3 py-10 text-center text-sm text-muted-foreground">
								<p>
									No results for &ldquo;<span className="text-foreground">{deferredQuery.trim()}</span>&rdquo;.
								</p>
								<Link href="/help" onClick={() => onOpenChange(false)} className="mt-2 inline-block font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
									Browse the help center
								</Link>
							</div>
						)}
						<div id={listId} role="listbox" aria-label={isSearching ? "Results" : "Suggestions"}>
							{groups.map((group) => {
								const offset = results.indexOf(group.results[0]);
								return (
									<div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`} className="not-first:mt-2">
										<p id={`${listId}-${group.id}`} className="px-3 pt-2 pb-1.5 text-xs font-medium text-muted-foreground">
											{group.label}
										</p>
										{group.results.map(({ entry }, position) => {
											const resultIndex = offset + position;
											return (
												<Result
													key={entry.href}
													id={optionId(resultIndex)}
													entry={entry}
													query={isSearching ? deferredQuery : ""}
													isActive={resultIndex === activeIndex}
													onPoint={() => setActive(resultIndex)}
													onOpen={() => onOpenChange(false)}
												/>
											);
										})}
									</div>
								);
							})}
						</div>
					</div>

					<p className="hidden shrink-0 items-center gap-4 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:flex">
						<span className="flex items-center gap-1.5">
							<Key>↑</Key>
							<Key>↓</Key> to move
						</span>
						<span className="flex items-center gap-1.5">
							<Key>↵</Key> to open
						</span>
						<span className="flex items-center gap-1.5">
							<Key>esc</Key> to close
						</span>
					</p>
				</DialogPrimitive.Content>
			</DialogPortal>
		</Dialog>
	);
}

function Result({ id, entry, query, isActive, onPoint, onOpen }) {
	const Icon = entry.group === "api" ? CodeXml : entry.href.includes("#") ? Hash : FileText;
	const snippet = getSnippet(entry, query);

	return (
		<Link
			id={id}
			href={entry.href}
			role="option"
			aria-selected={isActive}
			tabIndex={-1}
			onPointerMove={onPoint}
			onClick={onOpen}
			className={cn("flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none", isActive && "bg-muted")}
		>
			<span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground shadow-border">
				<Icon className="size-3.5" aria-hidden="true" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-2">
					<span className="truncate text-sm font-medium text-foreground">
						<Highlighted text={entry.title} query={query} />
					</span>
					{entry.parent && <span className="max-w-[35%] shrink-0 truncate text-xs text-muted-foreground sm:max-w-[45%]">{entry.parent}</span>}
				</span>
				{snippet && (
					<span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
						<Highlighted text={snippet} query={query} />
					</span>
				)}
			</span>
			<CornerDownLeft className={cn("mt-1.5 size-3.5 shrink-0 text-muted-foreground opacity-0", isActive && "opacity-100")} aria-hidden="true" />
		</Link>
	);
}

function Highlighted({ text, query }) {
	const ranges = query ? getHighlights(text, query) : [];
	if (ranges.length === 0) return text;
	const parts = [];
	let last = 0;
	for (const [start, end] of ranges) {
		if (start > last) parts.push(text.slice(last, start));
		parts.push(
			<mark key={start} className="rounded-[3px] bg-foreground/10 px-px text-foreground">
				{text.slice(start, end)}
			</mark>
		);
		last = end;
	}
	if (last < text.length) parts.push(text.slice(last));
	return parts;
}

function Key({ children }) {
	return <kbd className="min-w-5 rounded-md px-1.5 py-0.5 text-center font-sans text-[11px] font-medium shadow-border">{children}</kbd>;
}

// Before anything is typed: the help center's first articles, and the docs' pages.
function getSuggestions(prepared) {
	const pages = prepared.map(({ entry }) => entry).filter((entry) => !entry.href.includes("#"));
	const picks = { help: pages.filter((entry) => entry.group === "help").slice(0, 5), api: pages.filter((entry) => entry.parent === "API and MCP").slice(0, 3) };
	return SEARCH_GROUPS.map(({ id, label }) => ({ id, label, results: picks[id].map((entry) => ({ entry })) }));
}
