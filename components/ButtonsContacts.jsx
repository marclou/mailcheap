"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, ChartPie, Download, Loader2, MoreHorizontal, Plus, Rows3, Trash2 } from "lucide-react";
import { exportContacts } from "@/app/(app)/contacts/actions";
import DialogAddContacts from "@/components/DialogAddContacts";
import DialogContactFields from "@/components/DialogContactFields";
import DialogDeleteContacts from "@/components/DialogDeleteContacts";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasContactFilters } from "@/lib/contact-filters";
import { formatCount } from "@/lib/format";
import { getHelpHref } from "@/lib/help";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The actions at the top of the Contacts page, the same before the list has anyone, to show what it can do: Segments,
// Fields, then Add contacts, every way to add them (DialogAddContacts), and a ⋯ menu with the export and the help
// article. On phones, where the buttons keep to a row, Segments and Fields are in the menu. hasContacts: whether the
// list has anyone to export, of any status. importGuides: how to export a file from other platforms, for the import.
// curl: the newsletter's add_contact request, for the API's. filters and count: the list's filters, which the export
// follows, and how many contacts they show; once filters narrow the list, the menu can delete those. A dialog gives the
// focus back to what opened it: Fields, or the ⋯ button for the menu's.
export default function ButtonsContacts({ hasContacts, newsletter, filters, count, curl, importGuides }) {
	const [dialog, setDialog] = useState(null);
	const [isExporting, startExporting] = useTransition();
	const moreRef = useRef(null);
	const openerRef = useRef(null);
	const isOpeningDialogRef = useRef(false);
	const canDelete = hasContactFilters(filters) && count > 0;

	function open(name, opener) {
		openerRef.current = opener;
		setDialog(name);
	}

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function openFromMenu(name) {
		isOpeningDialogRef.current = true;
		open(name, moreRef.current);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		openerRef.current?.focus();
	}

	function changeDialog(name) {
		return (isOpen) => setDialog(isOpen ? name : null);
	}

	// The file downloads from a link valid for an hour.
	function download() {
		startExporting(async () => {
			const result = await exportContacts({ newsletterId: newsletter?.id, ...filters });
			if (result?.error) return void toast.error(result.error);
			window.location.assign(result.url);
		});
	}

	return (
		<>
			<Button asChild variant="outline" className="max-sm:hidden">
				<Link href="/contacts/segments">
					<ChartPie data-icon="inline-start" />
					Segments
				</Link>
			</Button>
			<Button variant="outline" aria-haspopup="dialog" onClick={(event) => open("fields", event.currentTarget)} className="max-sm:hidden">
				<Rows3 data-icon="inline-start" />
				Fields
			</Button>
			<DialogAddContacts newsletter={newsletter} curl={curl} importGuides={importGuides}>
				<Button disabled={!newsletter}>
					<Plus data-icon="inline-start" />
					Add contacts
				</Button>
			</DialogAddContacts>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="ghost" size="icon" aria-label="More">
						{isExporting ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-52">
					<DropdownMenuItem asChild className="sm:hidden">
						<Link href="/contacts/segments">
							<ChartPie />
							Segments
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => openFromMenu("fields")} className="sm:hidden">
						<Rows3 />
						Contact fields
					</DropdownMenuItem>
					{hasContacts && (
						<DropdownMenuItem onSelect={download} disabled={count === 0 || isExporting}>
							<Download />
							Export {formatCount(count, "contact")}
						</DropdownMenuItem>
					)}
					{canDelete && (
						<DropdownMenuItem variant="destructive" onSelect={() => openFromMenu("delete")}>
							<Trash2 />
							Delete {formatCount(count, "contact")}
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator className={cn(!hasContacts && "sm:hidden")} />
					<DropdownMenuItem asChild>
						<a href={getHelpHref("contacts")} target="_blank" rel="noopener">
							<BookOpen />
							How contacts work
							<ArrowUpRight className="ml-auto text-muted-foreground" />
						</a>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogContactFields isOpen={dialog === "fields"} onOpenChange={changeDialog("fields")} onCloseAutoFocus={returnFocus} />
			<DialogDeleteContacts
				newsletterId={newsletter?.id}
				filters={filters}
				count={count}
				isOpen={dialog === "delete"}
				onOpenChange={changeDialog("delete")}
				onCloseAutoFocus={returnFocus}
			/>
		</>
	);
}
