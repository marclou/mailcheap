"use client";

import { useState, useTransition } from "react";
import { Loader2, Tag, Tags, X } from "lucide-react";
import { tagListedContacts } from "@/app/(app)/contacts/actions";
import InputTags from "@/components/InputTags";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCount } from "@/lib/format";
import { toast } from "@/lib/toast";

// Tags every contact the list shows with its filters, or takes tags off them. filters: { status, query, segmentId, tag }.
export default function MenuTagContacts({ newsletterId, filters, count }) {
	const [mode, setMode] = useState(null);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="h-9 shrink-0" disabled={count === 0}>
						<Tags data-icon="inline-start" />
						Tag
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-52">
					<DropdownMenuItem onSelect={() => setMode("add")}>
						<Tag />
						Add tags to {formatCount(count, "contact")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setMode("remove")}>
						<X />
						Remove tags from {formatCount(count, "contact")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
				<DialogContent className="sm:max-w-sm">
					{mode && (
						<FormTagContacts
							newsletterId={newsletterId}
							filters={filters}
							count={count}
							isRemoving={mode === "remove"}
							onDone={() => setMode(null)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

function FormTagContacts({ newsletterId, filters, count, isRemoving, onDone }) {
	const { tags: tagOptions } = useContactOptions();
	const [tags, setTags] = useState([]);
	const [isSaving, startSaving] = useTransition();

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await tagListedContacts({ newsletterId, ...filters, tags, remove: isRemoving });
			if (result?.error) return void toast.error(result.error);
			onDone();
			toast.success(`${formatCount(result.changed, "contact")} ${isRemoving ? "untagged" : "tagged"}`);
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>{isRemoving ? "Remove tags" : "Add tags"}</DialogTitle>
				<DialogDescription className="tabular-nums">
					{isRemoving ? "From" : "To"} the {formatCount(count, "contact")} in this list.
				</DialogDescription>
			</DialogHeader>
			<InputTags
				value={tags}
				onChange={setTags}
				suggestions={tagOptions.map(({ name }) => name)}
				max={10}
				placeholder={isRemoving ? "Tag to remove" : "vip, podcast…"}
				autoFocus
			/>
			<DialogFooter>
				<DialogClose asChild>
					<Button type="button" variant="outline">
						Cancel
					</Button>
				</DialogClose>
				<Button type="submit" disabled={tags.length === 0 || isSaving} className="min-w-20">
					{isSaving ? <Loader2 className="animate-spin" /> : isRemoving ? "Remove" : "Add"}
				</Button>
			</DialogFooter>
		</form>
	);
}
