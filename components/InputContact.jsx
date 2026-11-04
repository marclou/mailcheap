"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { RemoveScroll } from "react-remove-scroll";
import { findPreviewContacts } from "@/app/(app)/campaigns/actions";
import AvatarContact from "@/components/AvatarContact";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 200;

// One of the newsletter's active contacts, found as it's typed: the newest while nothing is, then those with it in their
// address or first name, each with their picture as the Contacts page shows it. value: the contact picked,
// { id, email, firstName, gravatarHash }, or null; Backspace in the empty field takes it off. The field keeps the focus
// while its list is announced as its options, so Enter picks one and otherwise submits the form.
export default function InputContact({ id, newsletterId, value, onChange, placeholder = "Search your contacts", describedBy }) {
	const listId = useId();
	const inputRef = useRef(null);
	const anchorRef = useRef(null);
	const timerRef = useRef(null);
	const requestRef = useRef(0);
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState(null);
	const [active, setActive] = useState(0);
	const [isSearching, startSearching] = useTransition();
	const contacts = results?.contacts ?? [];
	const activeIndex = Math.max(0, Math.min(active, contacts.length - 1));
	// Enter picks a contact only from the list for what's typed, not one still showing for the text before.
	const isStale = (results?.query ?? null) !== query.trim();
	const isListShown = isOpen && results !== null;
	const optionId = (position) => `${listId}-option-${position}`;

	useEffect(() => () => clearTimeout(timerRef.current), []);

	// Only the latest answer shows.
	function search(text) {
		const request = ++requestRef.current;
		startSearching(async () => {
			const result = await findPreviewContacts(newsletterId, text).catch(() => ({ error: "Couldn't load your contacts, try again." }));
			if (request === requestRef.current) setResults({ query: text, ...result });
		});
	}

	function open() {
		if (isOpen) return;
		setIsOpen(true);
		setActive(0);
		search(query.trim());
	}

	function changeQuery(event) {
		const next = event.target.value;
		setQuery(next);
		setActive(0);
		setIsOpen(true);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => search(next.trim()), SEARCH_DELAY_MS);
	}

	function pick(contact) {
		onChange(contact);
		setQuery("");
		setIsOpen(false);
		inputRef.current?.focus();
	}

	function remove() {
		onChange(null);
		inputRef.current?.focus();
	}

	function moveActive(step) {
		if (!isListShown) return open();
		if (contacts.length === 0) return;
		const next = (activeIndex + step + contacts.length) % contacts.length;
		setActive(next);
		document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
	}

	function onKeyDown(event) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			moveActive(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter" && isListShown && contacts.length > 0) {
			event.preventDefault();
			if (!isStale) pick(contacts[activeIndex]);
		} else if (event.key === "Backspace" && !query && value) {
			remove();
		}
	}

	return (
		<Popover open={isListShown} onOpenChange={setIsOpen}>
			<PopoverAnchor asChild>
				{/* A click anywhere in the field goes to its input, as the chip leaves it little room. */}
				<div
					ref={anchorRef}
					onClick={() => inputRef.current?.focus()}
					className="flex h-9 w-full min-w-0 cursor-text items-center gap-2 rounded-lg border border-input bg-transparent pr-2.5 pl-1.5 transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
				>
					{value ? (
						<ChipContact contact={value} onRemove={remove} />
					) : (
						<Search aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted-foreground" />
					)}
					<input
						ref={inputRef}
						id={id}
						type="text"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={isListShown}
						aria-controls={listId}
						aria-activedescendant={isListShown && contacts.length > 0 ? optionId(activeIndex) : undefined}
						aria-describedby={describedBy}
						placeholder={value ? "" : placeholder}
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						maxLength={100}
						value={query}
						onChange={changeQuery}
						onFocus={open}
						onClick={open}
						onKeyDown={onKeyDown}
						className="h-full min-w-8 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
					/>
					{isSearching && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onInteractOutside={(event) => anchorRef.current?.contains(event.target) && event.preventDefault()}
				className="flex max-h-[min(15rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-64 flex-col overflow-hidden p-0"
			>
				{/* A dialog's scroll lock cancels the wheel and touch scrolling of what's outside it, and the list renders apart
				from it. Only the newest lock counts, and it lets only what's inside it scroll: the list holds one while it's open. */}
				<RemoveScroll allowPinchZoom className="min-h-0 overflow-y-auto overscroll-contain p-1">
					{contacts.length > 0 && (
						<p id={`${listId}-label`} className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
							{results.query ? "Contacts" : "Newest contacts"}
						</p>
					)}
					<div id={listId} role="listbox" aria-labelledby={`${listId}-label`}>
						{contacts.map((contact, index) => (
							<div
								key={contact.id}
								id={optionId(index)}
								role="option"
								aria-selected={index === activeIndex}
								aria-current={contact.id === value?.id || undefined}
								onPointerMove={() => setActive(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => pick(contact)}
								className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5", index === activeIndex && "bg-muted")}
							>
								<AvatarContact email={contact.email} gravatarHash={contact.gravatarHash} size={28} />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">{contact.firstName || contact.email}</span>
									<span className="block truncate text-xs text-muted-foreground">{contact.firstName ? contact.email : "No first name"}</span>
								</span>
								{contact.id === value?.id && <Check aria-hidden="true" className="size-4 shrink-0" />}
							</div>
						))}
					</div>
					{contacts.length === 0 && (
						<p role="status" className="px-2 py-2 text-sm text-pretty text-muted-foreground">
							{results?.error ?? (results?.query ? `No active contact matches “${results.query}”.` : "No active contacts yet.")}
						</p>
					)}
				</RemoveScroll>
			</PopoverContent>
		</Popover>
	);
}

function ChipContact({ contact, onRemove }) {
	const name = contact.firstName || contact.email;
	return (
		<span className="inline-flex h-7 max-w-[80%] min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-1 text-sm animate-enter">
			<AvatarContact email={contact.email} gravatarHash={contact.gravatarHash} size={20} />
			<span className="truncate font-medium">{name}</span>
			{contact.firstName && <span className="truncate text-muted-foreground max-sm:hidden">{contact.email}</span>}
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onRemove();
				}}
				aria-label={`Remove ${name}`}
				className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground"
			>
				<X className="size-3.5" />
			</button>
		</span>
	);
}
