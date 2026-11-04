"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, Download, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deleteSegment, exportContacts } from "@/app/(app)/contacts/actions";
import DialogSegment from "@/components/DialogSegment";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCount } from "@/lib/format";
import { getHelpHref } from "@/lib/help";
import { toast } from "@/lib/toast";
import { useHasRole } from "@/lib/use-team-role";

// The actions at the top of a segment's page: edit it, then in the ⋯ menu export the contacts its list shows (filters,
// count: the list's), and delete the segment. segment: { id, name, match, conditions, contacts }.
export default function ButtonsSegment({ newsletterId, segment, filters, count }) {
	const [dialog, setDialog] = useState(null);
	const [isExporting, startExporting] = useTransition();
	const moreRef = useRef(null);
	const isOpeningDialogRef = useRef(false);
	const listFilters = { ...filters, segmentId: segment.id };
	// Changing segments, exporting and deleting them are for the newsletter's admins.
	const isAdmin = useHasRole("admin");
	if (!isAdmin) return null;

	function changeDialog(name) {
		return (isOpen) => setDialog(isOpen ? name : null);
	}

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function openFromMenu(name) {
		isOpeningDialogRef.current = true;
		setDialog(name);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		moreRef.current?.focus();
	}

	function download() {
		startExporting(async () => {
			const result = await exportContacts({ newsletterId, ...listFilters });
			if (result?.error) return void toast.error(result.error);
			window.location.assign(result.url);
		});
	}

	return (
		<>
			<DialogSegment
				newsletterId={newsletterId}
				segment={segment}
				trigger={
					<Button variant="outline">
						<Pencil data-icon="inline-start" />
						Edit
					</Button>
				}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="ghost" size="icon" aria-label="More">
						{isExporting ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-56">
					<DropdownMenuItem onSelect={download} disabled={count === 0 || isExporting}>
						<Download />
						Export {formatCount(count, "contact")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => openFromMenu("segment")}>
						<Trash2 />
						Delete segment
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem asChild>
						<a href={getHelpHref("contacts", "segments")} target="_blank" rel="noopener">
							<BookOpen />
							How segments work
							<ArrowUpRight className="ml-auto text-muted-foreground" />
						</a>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogDeleteSegment
				id={segment.id}
				name={segment.name}
				isOpen={dialog === "segment"}
				onOpenChange={changeDialog("segment")}
				onCloseAutoFocus={returnFocus}
			/>
		</>
	);
}

function DialogDeleteSegment({ id, name, isOpen, onOpenChange, onCloseAutoFocus }) {
	const router = useRouter();
	const [isDeleting, startDeleting] = useTransition();

	function remove() {
		startDeleting(async () => {
			const result = await deleteSegment(id);
			if (result?.error) return void toast.error(result.error);
			toast.success("Segment deleted");
			router.replace("/contacts/segments");
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
				<DialogHeader>
					<DialogTitle>Delete this segment?</DialogTitle>
					<DialogDescription>
						<span className="font-medium wrap-anywhere text-foreground">{name}</span> goes, but its contacts stay. Campaigns
						sent to it keep their reports.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={remove} disabled={isDeleting} className="min-w-20">
						{isDeleting ? <Loader2 className="animate-spin" /> : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
