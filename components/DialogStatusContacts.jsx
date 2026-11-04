"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setSelectedStatus } from "@/app/(app)/contacts/actions";
import InputConfirmCount, { isCountTyped } from "@/components/InputConfirmCount";
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
import { getBulkFromStatuses } from "@/lib/contact-status";
import { formatCount, formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

const COPY = {
	active: {
		title: (count) => `Mark ${formatCount(count, "contact")} as active?`,
		description: "Dormant contacts get your next issues again. No email goes out now.",
		others: "only dormant contacts change here",
		button: () => "Mark as active",
		done: (count) => `${formatCount(count, "contact")} marked as active`,
	},
	dormant: {
		title: (count) => `Mark ${formatCount(count, "contact")} as dormant?`,
		description: "They stop getting your issues but stay on your list, and you can mark them as active again.",
		others: "only active contacts go dormant",
		button: () => "Mark as dormant",
		done: (count) => `${formatCount(count, "contact")} marked as dormant`,
	},
	unsubscribed: {
		title: (count) => `Unsubscribe ${formatCount(count, "contact")}?`,
		description: "They stop getting every email from this newsletter. To resubscribe one later, open their menu and confirm they asked to get your emails again.",
		others: "they already left or can't be emailed",
		button: (count) => `Unsubscribe ${formatCount(count, "contact")}`,
		done: (count) => `${formatCount(count, "contact")} unsubscribed`,
	},
};

// A status for the list's selection, for those whose status can change to it without their consent
// (getBulkFromStatuses), a batch at a time: how many first, and to unsubscribe them, their number typed in.
// statusCounts: how many of the selection have each status.
export default function DialogStatusContacts({ target, count, status, statusCounts, isOpen, onOpenChange, onDone, onCloseAutoFocus }) {
	const [typed, setTyped] = useState("");
	const [isSaving, startSaving] = useTransition();
	const copy = COPY[status];
	const changing = countChanging(statusCounts, status);
	const others = count - changing;
	const needsTyping = status === "unsubscribed";
	const isConfirmed = !needsTyping || isCountTyped(typed, changing);
	// Bringing them back takes each one's word, from their own menu (MenuContact).
	const waiting = status === "active" ? (statusCounts.unsubscribed ?? 0) + (statusCounts.pending ?? 0) : 0;

	function save(event) {
		event.preventDefault();
		if (!isConfirmed) return;
		startSaving(async () => {
			let done = 0;
			let hasFailed = false;
			for (;;) {
				const result = await setSelectedStatus(target, status);
				if (result?.error) {
					toast.error(result.error);
					hasFailed = true;
					break;
				}
				done += result.changed;
				if (result.remaining === 0 || result.changed === 0) break;
			}
			if (done > 0) toast.success(copy.done(done));
			else if (!hasFailed) toast.message("No one's status changed");
			if (done > 0 || !hasFailed) onDone();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md" showCloseButton={!isSaving} onCloseAutoFocus={onCloseAutoFocus}>
				<form onSubmit={save} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>{copy.title(changing)}</DialogTitle>
						<DialogDescription className="text-pretty">
							{copy.description}
							{others > 0 && ` The other ${formatNumber(others)} stay as they are: ${copy.others}.`}
						</DialogDescription>
					</DialogHeader>
					{waiting > 0 && (
						<p className="text-sm text-pretty text-muted-foreground">
							To bring back someone who unsubscribed or hasn&apos;t confirmed, open their menu and confirm they asked to get your emails.
						</p>
					)}
					{needsTyping && <InputConfirmCount count={changing} value={typed} onChange={setTyped} disabled={isSaving} />}
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isSaving}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" variant={needsTyping ? "destructive" : "default"} disabled={!isConfirmed || isSaving} className="min-w-28">
							{isSaving ? <Loader2 className="animate-spin" /> : copy.button(changing)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// How many of a selection a status change is for, from how many have each status.
export function countChanging(statusCounts, to) {
	return getBulkFromStatuses(to).reduce((sum, from) => sum + (statusCounts[from] ?? 0), 0);
}
