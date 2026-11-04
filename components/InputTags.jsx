"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { MAX_TAGS, cleanTag } from "@/lib/contact-fields";
import { formatCount, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Tags as chips: Enter, a comma or Tab adds what's typed, Backspace in the empty field takes the last one off. Under it,
// the tags the newsletter's contacts already have: a click adds one, and so do the arrow keys then Enter.
// suggestions: [{ name, contacts }], the most used first.
export default function InputTags({
	value,
	onChange,
	suggestions = [],
	maxSuggestions = 12,
	max = MAX_TAGS,
	placeholder = "Type a tag, then press Enter",
	label = "Tags",
	suggestionsLabel = "Tags you've used",
	autoFocus,
}) {
	const listId = useId();
	const [text, setText] = useState("");
	const [activeIndex, setActiveIndex] = useState(-1);
	const isFull = value.length >= max;
	const shown = isFull ? [] : pickSuggestions(suggestions, value, text).slice(0, maxSuggestions);
	const active = shown[activeIndex];

	// Several at once when a comma splits what's typed or pasted.
	function add(...raws) {
		const tags = raws.map(cleanTag).filter(Boolean);
		const next = [...new Set([...value, ...tags])].slice(0, Math.max(max, value.length));
		if (next.length > value.length) onChange(next);
		setText("");
		setActiveIndex(-1);
		return tags.length > 0;
	}

	function remove(tag) {
		onChange(value.filter((item) => item !== tag));
		setActiveIndex(-1);
	}

	function onKeyDown(event) {
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && shown.length > 0) {
			event.preventDefault();
			setActiveIndex(Math.max(-1, Math.min(shown.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
		} else if ((event.key === "Enter" || event.key === "Tab") && active) {
			event.preventDefault();
			add(active.name);
		} else if ((event.key === "Enter" || event.key === "," || (event.key === "Tab" && text.trim())) && add(text)) event.preventDefault();
		else if (event.key === "Enter") event.preventDefault();
		else if (event.key === "Backspace" && !text && value.length > 0) remove(value.at(-1));
	}

	function onTextChange(event) {
		const next = event.target.value;
		setActiveIndex(-1);
		if (next.includes(",")) return void add(...next.split(","));
		setText(next);
	}

	return (
		<div className="flex flex-col gap-3">
			<div
				className={cn(
					"flex min-h-9 flex-wrap items-center gap-1 rounded-lg bg-background px-1.5 py-1 shadow-border transition-shadow duration-150",
					"focus-within:ring-3 focus-within:ring-ring/50"
				)}
			>
				{value.map((tag) => (
					<span key={tag} className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-foreground animate-enter">
						<span className="truncate">{tag}</span>
						<button
							type="button"
							onClick={() => remove(tag)}
							aria-label={`Remove ${tag}`}
							className="grid size-5 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground"
						>
							<X className="size-3" />
						</button>
					</span>
				))}
				<input
					role="combobox"
					aria-expanded={shown.length > 0}
					aria-controls={shown.length > 0 ? listId : undefined}
					aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined}
					aria-autocomplete="list"
					value={text}
					onChange={onTextChange}
					onKeyDown={onKeyDown}
					onBlur={() => text.trim() && add(text)}
					placeholder={isFull ? "" : value.length > 0 ? "Add another" : placeholder}
					aria-label={label}
					disabled={isFull}
					autoFocus={autoFocus}
					maxLength={60}
					className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
				/>
				{text.trim() && (
					<kbd aria-hidden="true" className="mr-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground shadow-border animate-fade-in">
						Enter ↵
					</kbd>
				)}
			</div>
			{shown.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<span id={`${listId}-label`} className="text-xs text-muted-foreground">
						{suggestionsLabel}
					</span>
					{/* Picked from the field, which keeps the focus: a click doesn't take it, so what's typed isn't added on the way. */}
					<ul id={listId} role="listbox" aria-labelledby={`${listId}-label`} className="flex flex-wrap gap-1.5">
						{shown.map(({ name, contacts }, index) => (
							<li
								key={name}
								id={`${listId}-${index}`}
								role="option"
								aria-selected={index === activeIndex}
								title={formatCount(contacts, "contact")}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => add(name)}
								className={cn(
									"inline-flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-md pr-2 pl-1.5 text-xs text-muted-foreground shadow-border transition-colors duration-150 select-none animate-fade-in hover:bg-muted hover:text-foreground",
									index === activeIndex && "bg-muted text-foreground"
								)}
							>
								<Plus aria-hidden="true" className="size-3 shrink-0" />
								<span className="truncate text-foreground">{name}</span>
								<span className="tabular-nums">{formatNumber(contacts)}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

// The tags to offer, in the order given: the ones not given yet, all of them while a new one is typed, but the one typed,
// which Enter adds.
export function pickSuggestions(suggestions, value, text) {
	const typed = cleanTag(text);
	return suggestions.filter(({ name }) => !value.includes(name) && name !== typed);
}
