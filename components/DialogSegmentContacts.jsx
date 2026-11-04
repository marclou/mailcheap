"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { segmentSelectedContacts } from "@/app/(app)/contacts/actions";
import LinkHelp from "@/components/LinkHelp";
import { useContactOptions } from "@/components/ProviderContactOptions";
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
import { MAX_TAG_LENGTH, cleanTag } from "@/lib/contact-fields";
import { formatCount } from "@/lib/format";
import { MAX_SEGMENT_NAME } from "@/lib/segments";
import { toast } from "@/lib/toast";

// A segment of the list's selection, from its name: they get the name as a tag, which the segment picks, so tagging
// anyone else later adds them. Its page opens once it's made.
export default function DialogSegmentContacts({ target, count, isOpen, onOpenChange, onDone, onCloseAutoFocus }) {
	const router = useRouter();
	const hintId = useId();
	const { tags } = useContactOptions();
	const [name, setName] = useState("");
	const [isSaving, startSaving] = useTransition();
	const tag = cleanTag(name.trim().slice(0, MAX_TAG_LENGTH));
	const isTagUsed = tags.some((option) => option.name === tag);

	function save(event) {
		event.preventDefault();
		if (!tag) return;
		startSaving(async () => {
			// A big selection is tagged a batch a call, and the last call makes the segment.
			let result;
			do result = await segmentSelectedContacts(target, { name: name.trim(), tag });
			while (result?.remaining > 0);
			if (result?.error) return void toast.error(result.error);
			toast.success("Segment created");
			onDone();
			router.push(`/contacts/segments/${result.id}`);
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<form onSubmit={save} className="flex flex-col gap-5">
					<DialogHeader>
						<DialogTitle>New segment of {formatCount(count, "contact")}</DialogTitle>
						<DialogDescription className="text-pretty">
							Send campaigns to them only, and see how they read. <LinkHelp article="contacts" section="segments" />
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={MAX_SEGMENT_NAME}
							placeholder="Name"
							aria-label="Name"
							aria-describedby={hintId}
							autoFocus
							className="h-10 rounded-lg bg-muted/60 px-3 text-base font-medium outline-none transition-shadow duration-150 placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
						/>
						<p id={hintId} className="text-sm text-pretty text-muted-foreground">
							{tag ? (
								<>
									They get the tag <span className="font-medium wrap-anywhere text-foreground">{tag}</span>, which the segment picks: tag
									anyone else later to add them.{isTagUsed && " Everyone who already has it is in the segment too."}
								</>
							) : (
								"They get its name as a tag, which the segment picks: tag anyone else later to add them."
							)}
						</p>
					</div>

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isSaving}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={!tag || isSaving} className="min-w-32">
							{isSaving ? <Loader2 className="animate-spin" /> : "Create segment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
