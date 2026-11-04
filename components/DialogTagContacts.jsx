"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { tagSelectedContacts, untagSelectedContacts } from "@/app/(app)/contacts/actions";
import InputTags from "@/components/InputTags";
import LinkHelpTags from "@/components/LinkHelpTags";
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
import { MAX_CHANGED_TAGS } from "@/lib/contact-fields";
import { formatCount } from "@/lib/format";
import { toast } from "@/lib/toast";

// Tags added to the list's selection, or taken off it, a batch at a time: the others stay. mode: add or remove;
// suggestions: the tags to offer, [{ name, contacts }], the most used first.
export default function DialogTagContacts({ target, count, mode, suggestions, isOpen, onOpenChange, onDone, onCloseAutoFocus }) {
	const [tags, setTags] = useState([]);
	const [isSaving, startSaving] = useTransition();
	const isAdding = mode === "add";

	function save(event) {
		event.preventDefault();
		if (tags.length === 0) return;
		startSaving(async () => {
			const change = isAdding ? tagSelectedContacts : untagSelectedContacts;
			let done = 0;
			let hasFailed = false;
			for (;;) {
				const result = await change(target, tags);
				if (result?.error) {
					toast.error(result.error);
					hasFailed = true;
					break;
				}
				done += result.changed;
				if (result.remaining === 0 || result.changed === 0) break;
			}
			if (done > 0) toast.success(isAdding ? `${formatCount(done, "contact")} tagged` : `Tags taken off ${formatCount(done, "contact")}`);
			else if (!hasFailed) toast.message(isAdding ? "They already had these tags" : "None of them had these tags");
			if (done > 0 || !hasFailed) onDone();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<form onSubmit={save} className="flex flex-col gap-5">
					<DialogHeader>
						<DialogTitle>{isAdding ? `Add tags to ${formatCount(count, "contact")}` : `Remove tags from ${formatCount(count, "contact")}`}</DialogTitle>
						<DialogDescription className="text-pretty">
							{isAdding
								? "They keep the tags they have. Tags are labels like vip or customer, to filter your list and build segments."
								: "Their other tags stay."}
						</DialogDescription>
						<LinkHelpTags className="self-start text-sm" />
					</DialogHeader>

					<InputTags
						value={tags}
						onChange={setTags}
						suggestions={suggestions}
						suggestionsLabel={isAdding ? undefined : "Their tags"}
						max={MAX_CHANGED_TAGS}
						autoFocus
					/>

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isSaving}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={tags.length === 0 || isSaving} className="min-w-28">
							{isSaving ? <Loader2 className="animate-spin" /> : isAdding ? "Add tags" : "Remove tags"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
