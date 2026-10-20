"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { MAX_TAGS, cleanTag } from "@/lib/contact-fields";
import { cn } from "@/lib/utils";

// Tags as chips: Enter, a comma or Tab adds what's typed, Backspace in the empty field takes the last one off.
// suggestions: tag names the newsletter's contacts already have.
export default function InputTags({ value, onChange, suggestions = [], max = MAX_TAGS, placeholder = "Add a tag", label = "Tags", autoFocus }) {
	const listId = useId();
	const [text, setText] = useState("");
	const isFull = value.length >= max;
	const options = suggestions.filter((name) => !value.includes(name));

	function add(raw) {
		const tag = cleanTag(raw);
		if (!tag) return false;
		if (!value.includes(tag) && !isFull) onChange([...value, tag]);
		setText("");
		return true;
	}

	function onKeyDown(event) {
		if ((event.key === "Enter" || event.key === "," || (event.key === "Tab" && text.trim())) && add(text)) event.preventDefault();
		else if (event.key === "Enter") event.preventDefault();
		else if (event.key === "Backspace" && !text && value.length > 0) onChange(value.slice(0, -1));
	}

	function onTextChange(event) {
		const next = event.target.value;
		// A suggestion picked from the list, not typed: typing "vip" on the way to "vip2" stays text.
		const isPicked = event.nativeEvent.inputType === "insertReplacementText" || event.nativeEvent.inputType === undefined;
		if (isPicked && options.includes(next)) return void add(next);
		if (next.includes(",")) return void next.split(",").forEach(add);
		setText(next);
	}

	return (
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
						onClick={() => onChange(value.filter((item) => item !== tag))}
						aria-label={`Remove ${tag}`}
						className="grid size-5 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				</span>
			))}
			<input
				value={text}
				onChange={onTextChange}
				onKeyDown={onKeyDown}
				onBlur={() => text.trim() && add(text)}
				list={options.length > 0 ? listId : undefined}
				placeholder={isFull ? "" : value.length > 0 ? "" : placeholder}
				aria-label={label}
				disabled={isFull}
				autoFocus={autoFocus}
				maxLength={60}
				className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-calendar-picker-indicator]:hidden"
			/>
			{options.length > 0 && (
				<datalist id={listId}>
					{options.map((name) => (
						<option key={name} value={name} />
					))}
				</datalist>
			)}
		</div>
	);
}
