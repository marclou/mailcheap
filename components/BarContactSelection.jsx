"use client";

import { useRef, useState } from "react";
import { ChartPie, Minus, Moon, Plus, Tag, Trash2, UserCheck, UserX, X } from "lucide-react";
import { useClearOfChat } from "@/components/BarSave";
import DialogDeleteContacts from "@/components/DialogDeleteContacts";
import DialogSegmentContacts from "@/components/DialogSegmentContacts";
import DialogStatusContacts, { countChanging } from "@/components/DialogStatusContacts";
import DialogTagContacts from "@/components/DialogTagContacts";
import { useContactOptions } from "@/components/ProviderContactOptions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/lib/format";
import { useContactSelection } from "@/lib/use-contact-selection";
import { useHasRole } from "@/lib/use-team-role";
import { cn } from "@/lib/utils";

const STATUS_ITEMS = [
	{ status: "active", label: "Mark as active", icon: UserCheck },
	{ status: "dormant", label: "Mark as dormant", icon: Moon },
	{ status: "unsubscribed", label: "Unsubscribe", icon: UserX },
];

// What the contacts list's selection can do, at the bottom of the screen while it has anyone, placed like a form's save
// bar (BarSave): tags for the newsletter's whole team; statuses, a segment and deleting for its admins. Each dialog says
// how many contacts it changes first, and what it did clears the selection.
export default function BarContactSelection() {
	const selection = useContactSelection();
	const { tags } = useContactOptions();
	const isAdmin = useHasRole("admin");
	const slotRef = useRef(null);
	const barRef = useRef(null);
	const tagsRef = useRef(null);
	const statusRef = useRef(null);
	const openerRef = useRef(null);
	const isOpeningDialogRef = useRef(false);
	// The dialog open, or closing, with the selection as it was when it opened: what it did clears the selection.
	const [dialog, setDialog] = useState({ name: null, isOpen: false, key: 0 });
	const isShown = selection.count > 0;
	const statusCounts = countStatuses(selection);
	const selectedTags = selection.isAll ? tags : countTags(selection);
	useClearOfChat(slotRef, barRef, isShown);

	function open(name, opener, details = {}) {
		openerRef.current = opener;
		setDialog(({ key }) => ({ name, isOpen: true, key: key + 1, target: selection.target, count: selection.count, statusCounts, ...details }));
	}

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function openFromMenu(name, opener, details) {
		isOpeningDialogRef.current = true;
		open(name, opener, details);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	// Back to what opened the dialog, unless the bar went with the selection.
	function returnFocus(event) {
		event.preventDefault();
		if (isShown) openerRef.current?.focus();
	}

	function finish() {
		setDialog((current) => ({ ...current, isOpen: false }));
		selection.clear();
	}

	const dialogProps = {
		target: dialog.target,
		count: dialog.count,
		isOpen: dialog.isOpen,
		onOpenChange: (isOpen) => setDialog((current) => ({ ...current, isOpen })),
		onDone: finish,
		onCloseAutoFocus: returnFocus,
	};

	return (
		<>
			<div data-selection-bar data-shown={isShown ? "" : undefined} className="-mb-6 box-content h-14 pb-(--save-bar-bottom) md:-mb-10">
				<div
					ref={slotRef}
					className="pointer-events-none fixed right-4 bottom-(--save-bar-bottom) left-4 z-30 pr-(--save-bar-inset) transition-[left] duration-250 ease-drawer motion-reduce:transition-none md:right-10 md:left-[calc(var(--sidebar-width)+2.5rem)]"
				>
					<div
						ref={barRef}
						role="toolbar"
						aria-label="Selected contacts"
						inert={!isShown}
						className={cn(
							"pointer-events-auto mx-auto flex h-14 max-w-140 origin-bottom items-center gap-1 rounded-2xl bg-foreground p-2 text-background shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_12px_32px_-8px_rgb(0_0_0/0.35),0_4px_8px_-4px_rgb(0_0_0/0.2)] transition-[translate,scale,opacity] @container motion-reduce:transition-opacity",
							isShown
								? "duration-250 ease-[cubic-bezier(0.23,1,0.32,1)]"
								: "translate-y-(--save-bar-bottom) scale-96 opacity-0 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:scale-100"
						)}
					>
						<Button variant="ghost" size="icon" onClick={selection.clear} aria-label="Clear selection" className={ON_BAR}>
							<X />
						</Button>
						<p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
							{formatNumber(selection.count)} selected
						</p>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button ref={tagsRef} variant="ghost" className={ON_BAR}>
									<Tag data-icon="inline-start" />
									<span className={LABEL}>Tags</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="top" align="end" sideOffset={10} onCloseAutoFocus={keepDialogFocus} className="min-w-44">
								<DropdownMenuItem onSelect={() => openFromMenu("tags", tagsRef.current, { mode: "add", suggestions: tags })}>
									<Plus />
									Add tags
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => openFromMenu("tags", tagsRef.current, { mode: "remove", suggestions: selectedTags })}
									disabled={selectedTags.length === 0}
								>
									<Minus />
									Remove tags
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						{isAdmin && (
							<>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button ref={statusRef} variant="ghost" className={ON_BAR}>
											<UserCheck data-icon="inline-start" />
											<span className={LABEL}>Status</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent side="top" align="end" sideOffset={10} onCloseAutoFocus={keepDialogFocus} className="min-w-52">
										{STATUS_ITEMS.map(({ status, label, icon: Icon }) => {
											const changing = countChanging(statusCounts, status);
											return (
												<DropdownMenuItem
													key={status}
													variant={status === "unsubscribed" ? "destructive" : "default"}
													disabled={changing === 0}
													onSelect={() => openFromMenu("status", statusRef.current, { status })}
												>
													<Icon />
													{label}
													<DropdownMenuShortcut className="tracking-normal tabular-nums">{formatNumber(changing)}</DropdownMenuShortcut>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuContent>
								</DropdownMenu>
								<Button variant="ghost" onClick={(event) => open("segment", event.currentTarget)} className={ON_BAR}>
									<ChartPie data-icon="inline-start" />
									<span className={LABEL}>New segment</span>
								</Button>
								<Button variant="ghost" onClick={(event) => open("delete", event.currentTarget)} className={ON_BAR}>
									<Trash2 data-icon="inline-start" />
									<span className={LABEL}>Delete</span>
								</Button>
							</>
						)}
					</div>
				</div>
			</div>
			{dialog.name === "tags" && <DialogTagContacts key={dialog.key} {...dialogProps} mode={dialog.mode} suggestions={dialog.suggestions} />}
			{dialog.name === "status" && (
				<DialogStatusContacts key={dialog.key} {...dialogProps} status={dialog.status} statusCounts={dialog.statusCounts} />
			)}
			{dialog.name === "segment" && <DialogSegmentContacts key={dialog.key} {...dialogProps} />}
			{dialog.name === "delete" && <DialogDeleteContacts key={dialog.key} {...dialogProps} />}
		</>
	);
}

// How many of the selection have each status: the ticked contacts' own, or the list's counts for all of it.
function countStatuses({ isAll, counts, filters, contacts, ids }) {
	if (isAll) return Object.fromEntries(Object.entries(counts).map(([status, count]) => [status, !filters.status || filters.status === status ? count : 0]));
	const statuses = {};
	for (const { id, status } of contacts) if (ids.has(id)) statuses[status] = (statuses[status] ?? 0) + 1;
	return statuses;
}

// The tags the ticked contacts have, the most used first, to offer when taking some off.
function countTags({ contacts, ids }) {
	const counts = new Map();
	for (const contact of contacts) {
		if (!ids.has(contact.id)) continue;
		for (const tag of contact.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts].map(([name, contacts]) => ({ name, contacts })).sort((a, b) => b.contacts - a.contacts || a.name.localeCompare(b.name));
}

// The labels fold into the icons when the bar is narrow.
const LABEL = "@max-[30rem]:sr-only";
// On the bar's inverted colors, and the theme's focus ring drawn for its background takes the bar's own text color.
const ON_BAR =
	"text-background hover:bg-background/10 hover:text-background aria-expanded:bg-background/15 aria-expanded:text-background dark:hover:bg-background/10 focus-visible:border-background/50 focus-visible:ring-background/30";
