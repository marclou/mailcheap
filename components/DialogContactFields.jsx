"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createContactField, deleteContactField } from "@/app/(app)/contacts/actions";
import ButtonMergeTag from "@/components/ButtonMergeTag";
import LinkHelpFields from "@/components/LinkHelpFields";
import { useContactOptions } from "@/components/ProviderContactOptions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_TYPES, MAX_CONTACT_FIELDS, MAX_FIELD_LABEL } from "@/lib/contact-fields";
import { SAMPLE_FIRST_NAME, fieldTag, firstNameTag } from "@/lib/merge-tags";
import { toast } from "@/lib/toast";

// The account's own contact fields, shared by its newsletters: add one, or delete one (contacts keep their values).
// onCloseAutoFocus: where the focus goes back, as what opened it is outside the dialog. onAdded(field) and
// onDeleted(key): after one is added or deleted, for the editor, which puts one added where its slash was.
export default function DialogContactFields({ isOpen, onOpenChange, onCloseAutoFocus, onAdded, onDeleted }) {
	const { fields } = useContactOptions();

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<DialogHeader>
					<DialogTitle>Contact fields</DialogTitle>
					<DialogDescription className="text-pretty">
						Every contact has a first name and tags. Add your own, like a company or a birthday. In your emails, a field between
						double braces prints each reader&apos;s own value:
					</DialogDescription>
					<div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
						<span className="text-xs text-muted-foreground">You write</span>
						<code className="truncate font-mono text-[13px]">Hi {firstNameTag("")},</code>
						<span className="text-xs text-muted-foreground">{SAMPLE_FIRST_NAME} gets</span>
						<span className="truncate">Hi {SAMPLE_FIRST_NAME},</span>
					</div>
					<LinkHelpFields className="self-start text-sm" />
				</DialogHeader>

				{fields.length > 0 && (
					<ul className="flex flex-col divide-y divide-border/60 rounded-xl shadow-border">
						{fields.map((field) => (
							<RowField key={field.key} field={field} onDeleted={onDeleted} />
						))}
					</ul>
				)}

				{fields.length < MAX_CONTACT_FIELDS && <FormAddField onAdded={onAdded} />}
			</DialogContent>
		</Dialog>
	);
}

function RowField({ field, onDeleted }) {
	const [isConfirming, setIsConfirming] = useState(false);
	const [isDeleting, startDeleting] = useTransition();

	function remove() {
		if (!isConfirming) return setIsConfirming(true);
		startDeleting(async () => {
			const result = await deleteContactField(field.key);
			if (result?.error) toast.error(result.error);
			else onDeleted?.(field.key);
			setIsConfirming(false);
		});
	}

	return (
		<li className="flex items-center gap-3 py-2 pr-1.5 pl-3 animate-enter">
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{field.label}</span>
				<span className="block truncate text-xs text-muted-foreground">{FIELD_TYPES[field.type]?.label}</span>
			</span>
			<ButtonMergeTag tag={fieldTag(field.key)} className="max-w-[65%] shrink-0" />
			<Button
				type="button"
				variant="ghost"
				size={isConfirming ? "sm" : "icon-sm"}
				onClick={remove}
				onBlur={() => setIsConfirming(false)}
				disabled={isDeleting}
				aria-label={isConfirming ? undefined : `Delete ${field.label}`}
				className="shrink-0 text-muted-foreground hover:text-destructive"
			>
				{isDeleting ? <Loader2 className="animate-spin" /> : isConfirming ? "Delete it?" : <Trash2 />}
			</Button>
		</li>
	);
}

function FormAddField({ onAdded }) {
	const [label, setLabel] = useState("");
	const [type, setType] = useState("text");
	const [isAdding, startAdding] = useTransition();

	function add(event) {
		event.preventDefault();
		startAdding(async () => {
			const result = await createContactField({ label, type });
			if (result?.error) return void toast.error(result.error);
			setLabel("");
			onAdded?.(result.field);
		});
	}

	return (
		<form onSubmit={add} className="flex gap-2">
			<Input
				autoFocus
				value={label}
				onChange={(event) => setLabel(event.target.value)}
				placeholder="New field, e.g. Company"
				aria-label="Field name"
				maxLength={MAX_FIELD_LABEL}
				className="min-w-0 flex-1"
			/>
			<Select value={type} onValueChange={setType}>
				<SelectTrigger className="h-9 w-28 shrink-0" aria-label="Type">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{Object.entries(FIELD_TYPES).map(([id, { label: name }]) => (
						<SelectItem key={id} value={id}>
							{name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button type="submit" variant="outline" size="icon" aria-label="Add field" disabled={!label.trim() || isAdding} className="shrink-0">
				{isAdding ? <Loader2 className="animate-spin" /> : <Plus />}
			</Button>
		</form>
	);
}
