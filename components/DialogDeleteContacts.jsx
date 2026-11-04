"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { deleteSelectedContacts } from "@/app/(app)/contacts/actions";
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
import { formatCount, formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

// The list's selection, deleted once their number is typed in, since it can't be undone. They go a batch at a time, and
// the button counts them. target: who they are (ProviderContactSelection); count: how many.
export default function DialogDeleteContacts({ target, count, isOpen, onOpenChange, onDone, onCloseAutoFocus }) {
	const [typed, setTyped] = useState("");
	const [deleted, setDeleted] = useState(0);
	const [isDeleting, startDeleting] = useTransition();
	const isConfirmed = isCountTyped(typed, count);

	function remove(event) {
		event.preventDefault();
		if (!isConfirmed) return;
		startDeleting(async () => {
			let done = 0;
			let hasFailed = false;
			for (;;) {
				const result = await deleteSelectedContacts(target);
				if (result?.error) {
					toast.error(result.error);
					hasFailed = true;
					break;
				}
				done += result.deleted;
				setDeleted(done);
				if (result.remaining === 0 || result.deleted === 0) break;
			}
			if (done > 0) toast.success(`${formatCount(done, "contact")} deleted`);
			if (done > 0 || !hasFailed) onDone();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isDeleting && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md" showCloseButton={!isDeleting} onCloseAutoFocus={onCloseAutoFocus}>
				<form onSubmit={remove} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Delete {formatCount(count, "contact")}?</DialogTitle>
						<DialogDescription className="text-pretty">
							They leave your contacts with their history, and it can&apos;t be undone. Those who unsubscribed, bounced or complained
							stay blocked, so adding them again won&apos;t email them.
						</DialogDescription>
					</DialogHeader>
					<InputConfirmCount count={count} value={typed} onChange={setTyped} disabled={isDeleting} />
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isDeleting}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" variant="destructive" disabled={!isConfirmed || isDeleting} className="min-w-20 tabular-nums">
							{isDeleting ? (
								<>
									<Loader2 className="animate-spin" />
									{deleted > 0 && formatNumber(deleted)}
								</>
							) : (
								`Delete ${formatCount(count, "contact")}`
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
