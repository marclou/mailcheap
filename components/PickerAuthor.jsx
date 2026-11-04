"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plus } from "lucide-react";
import { editAuthor, removeAuthor } from "@/app/(app)/campaigns/actions";
import AvatarUser from "@/components/AvatarUser";
import DialogAuthor from "@/components/DialogAuthor";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAX_AUTHORS, describeAuthorPlaces } from "@/lib/author-rules";
import { toast } from "@/lib/toast";
import { useHasRole } from "@/lib/use-team-role";

const TRIGGERS = {
	row: "flex h-11 w-full min-w-0 items-center gap-2 text-left text-sm outline-none transition-opacity duration-150 focus-visible:opacity-80",
	field:
		"flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
};

// Who wrote an issue, or who a newsletter's new issues start with (lib/authors.js): one of its authors, saved at once with
// onPick, or a new one, added and picked with onAdd. Both answer { error } when it didn't go through, onAdd with the
// author when they were added all the same. authors: { id, name, email, imageUrl, showOnWeb, showInEmails, gravatarHash },
// kept by the parent, which onAuthorsChange and onAuthorChange update, the chosen one to null once they're removed.
// suggestion: what a first author starts with. Members add authors and pick them; the newsletter's admins edit and remove
// them too. variant: row in the editor's rows, field among a form's fields.
export default function PickerAuthor({ ref, authors, authorId, suggestion, onPick, onAdd, onAuthorsChange, onAuthorChange, variant = "row" }) {
	const [dialog, setDialog] = useState({ isOpen: false, author: null });
	const [isPicking, startPicking] = useTransition();
	const canEdit = useHasRole("admin");
	const author = authors.find(({ id }) => id === authorId) ?? null;
	const places = author && describeAuthorPlaces(author);
	const trigger = TRIGGERS[variant];

	function pick(id) {
		if (id === authorId) return;
		const previous = authorId;
		onAuthorChange(id);
		startPicking(async () => {
			const result = await onPick(id);
			if (!result?.error) return;
			onAuthorChange(previous);
			toast.error(result.error);
		});
	}

	function openDialog(edited = null) {
		setDialog({ isOpen: true, author: edited });
	}

	function closeDialog() {
		setDialog((current) => ({ ...current, isOpen: false }));
	}

	async function save(values) {
		if (dialog.author) {
			const result = await editAuthor(dialog.author.id, values);
			if (result?.error) return result;
			onAuthorsChange(authors.map((item) => (item.id === result.author.id ? result.author : item)));
			toast.success("Author saved");
		} else {
			const result = await onAdd(values);
			if (!result?.author) return result;
			// Added, even when they couldn't be picked: they're in the menu to pick again.
			onAuthorsChange([...authors, result.author]);
			if (result.error) toast.error(result.error);
			else onAuthorChange(result.author.id);
		}
		closeDialog();
	}

	async function remove() {
		const result = await removeAuthor(dialog.author.id);
		if (result?.error) return result;
		onAuthorsChange(authors.filter(({ id }) => id !== dialog.author.id));
		if (dialog.author.id === authorId) onAuthorChange(null);
		toast.success(`${dialog.author.name} removed`);
		closeDialog();
	}

	const dialogElement = (
		<DialogAuthor
			isOpen={dialog.isOpen}
			onOpenChange={(isOpen) => !isOpen && closeDialog()}
			author={dialog.author}
			suggestion={authors.length === 0 ? suggestion : null}
			onSave={save}
			onRemove={canEdit && dialog.author ? remove : null}
		/>
	);

	if (authors.length === 0) {
		return (
			<>
				<button
					ref={ref}
					type="button"
					aria-label="Author"
					onClick={() => openDialog()}
					className={trigger}
				>
					<Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
					<span className="text-muted-foreground">Add an author</span>
				</button>
				{dialogElement}
			</>
		);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						ref={ref}
						type="button"
						aria-label="Author"
						className={trigger}
					>
						{author ? (
							<>
								<AvatarUser name={author.name} email={author.email} image={author.imageUrl} gravatarHash={author.gravatarHash} size={20} />
								<span className="min-w-0 truncate font-medium">{author.name}</span>
								{places && <span className="min-w-0 truncate text-xs text-muted-foreground max-sm:hidden">{places}</span>}
							</>
						) : (
							<span className="min-w-0 truncate text-muted-foreground">Choose an author</span>
						)}
						{isPicking ? (
							<Loader2 aria-hidden="true" className="ml-auto size-4 shrink-0 animate-spin text-muted-foreground" />
						) : (
							<ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground" />
						)}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
					<DropdownMenuLabel>Authors</DropdownMenuLabel>
					{authors.map((item) => (
						<DropdownMenuItem key={item.id} onSelect={() => pick(item.id)} className="gap-2.5">
							<AvatarUser name={item.name} email={item.email} image={item.imageUrl} gravatarHash={item.gravatarHash} size={28} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-medium">{item.name}</span>
								<span className="truncate text-xs text-muted-foreground">{item.email}</span>
							</span>
							{item.id === authorId && <Check aria-label="Chosen" className="size-4 shrink-0" />}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					{canEdit && author && (
						<DropdownMenuItem onSelect={() => openDialog(author)}>
							<Pencil />
							<span className="min-w-0 truncate">Edit {author.name}</span>
						</DropdownMenuItem>
					)}
					{authors.length < MAX_AUTHORS && (
						<DropdownMenuItem onSelect={() => openDialog()}>
							<Plus />
							Add an author
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogElement}
		</>
	);
}
