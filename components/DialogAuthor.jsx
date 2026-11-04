"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import InputImage from "@/components/InputImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MAX_AUTHOR_NAME_LENGTH, getAuthorProblem, readAuthorName } from "@/lib/author-rules";
import { MAX_EMAIL_LENGTH } from "@/lib/validation";

// A newsletter's author, new or one to edit (author): the name and picture readers see, the address replies go to, and
// where they show. suggestion: what a first author starts with, the signed-in user's name and address. onSave and
// onRemove (admins, for an author already there) answer { error } when it didn't go through.
export default function DialogAuthor({ isOpen, onOpenChange, author, suggestion, onSave, onRemove }) {
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<FormAuthor author={author} suggestion={suggestion} onSave={onSave} onRemove={onRemove} />
			</DialogContent>
		</Dialog>
	);
}

function FormAuthor({ author, suggestion, onSave, onRemove }) {
	const [values, setValues] = useState(() => ({
		name: author?.name ?? suggestion?.name ?? "",
		email: author?.email ?? suggestion?.email ?? "",
		imageUrl: author?.imageUrl ?? "",
		showOnWeb: author?.showOnWeb ?? true,
		showInEmails: author?.showInEmails ?? true,
	}));
	const [error, setError] = useState(null);
	const [isRemoving, setIsRemoving] = useState(false);
	const [isPending, startTransition] = useTransition();

	function set(key, value) {
		setValues((current) => ({ ...current, [key]: value }));
		setError(null);
	}

	function save(event) {
		event.preventDefault();
		// The dialog renders apart, but React passes its submit on to a form the picker is in (FormNewsletter).
		event.stopPropagation();
		const next = { ...values, name: readAuthorName(values.name), email: values.email.trim() };
		const problem = getAuthorProblem(next);
		if (problem) return setError(problem.message);
		startTransition(async () => {
			const result = await onSave(next);
			if (result?.error) setError(result.error);
		});
	}

	function remove() {
		startTransition(async () => {
			const result = await onRemove();
			if (result?.error) {
				setError(result.error);
				setIsRemoving(false);
			}
		});
	}

	return (
		<form onSubmit={save} noValidate className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>{author ? "Edit author" : "Add an author"}</DialogTitle>
				<DialogDescription>Readers see their name and picture. Replies to their issues go to their email.</DialogDescription>
			</DialogHeader>
			<InputImage defaultValue={values.imageUrl} label="picture" isRound isCropped onChange={(url) => set("imageUrl", url)} />
			<div className="flex flex-col gap-3">
				<label className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">Name</span>
					<Input
						value={values.name}
						onChange={(event) => set("name", event.target.value)}
						placeholder="Jane Doe"
						required
						autoFocus={!author}
						maxLength={MAX_AUTHOR_NAME_LENGTH}
						autoComplete="off"
					/>
				</label>
				<label className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">Email</span>
					<Input
						type="email"
						value={values.email}
						onChange={(event) => set("email", event.target.value)}
						placeholder="jane@example.com"
						required
						maxLength={MAX_EMAIL_LENGTH}
						autoComplete="off"
					/>
					<span className="text-xs text-pretty text-muted-foreground">Replies go here. It never shows on your issues or their pages.</span>
				</label>
			</div>
			<div className="flex flex-col gap-1 rounded-lg p-1 shadow-border">
				<RowShown
					label="Show on the web"
					description="Under the title of their issues' pages"
					isChecked={values.showOnWeb}
					onChange={(isChecked) => set("showOnWeb", isChecked)}
				/>
				<RowShown
					label="Show in emails"
					description="At the top of their issues' emails"
					isChecked={values.showInEmails}
					onChange={(isChecked) => set("showInEmails", isChecked)}
				/>
			</div>
			{error && (
				<p role="alert" className="text-sm text-pretty text-destructive">
					{error}
				</p>
			)}
			{isRemoving ? (
				<div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3 sm:flex-row sm:items-center">
					<p className="flex-1 text-sm text-pretty">Remove {author.name}? Their name leaves their issues&apos; pages.</p>
					<div className="flex shrink-0 justify-end gap-2">
						<Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setIsRemoving(false)}>
							Keep
						</Button>
						<Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={remove} className="min-w-20">
							{isPending ? <Loader2 className="animate-spin" /> : "Remove"}
						</Button>
					</div>
				</div>
			) : (
				<DialogFooter className="sm:justify-between">
					{author && onRemove ? (
						<Button type="button" variant="ghost" disabled={isPending} onClick={() => setIsRemoving(true)} className="text-destructive hover:text-destructive">
							Remove
						</Button>
					) : (
						<span className="max-sm:hidden" />
					)}
					<Button type="submit" disabled={isPending} className="min-w-28">
						{isPending ? <Loader2 className="animate-spin" /> : author ? "Save" : "Add author"}
					</Button>
				</DialogFooter>
			)}
		</form>
	);
}

function RowShown({ label, description, isChecked, onChange }) {
	return (
		<label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50">
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				<span className="truncate text-xs text-muted-foreground">{description}</span>
			</span>
			<Switch checked={isChecked} onCheckedChange={onChange} />
		</label>
	);
}
