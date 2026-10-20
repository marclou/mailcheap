"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Rows3, Trash2 } from "lucide-react";
import { createContactField, deleteContactField } from "@/app/(app)/contacts/actions";
import { useContactOptions } from "@/components/ProviderContactOptions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_TYPES, MAX_CONTACT_FIELDS, MAX_FIELD_LABEL } from "@/lib/contact-fields";
import { toast } from "@/lib/toast";

// The account's own contact fields, shared by its newsletters: add one, or delete one (contacts keep their values).
export default function DialogContactFields() {
	const { fields } = useContactOptions();

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline">
					<Rows3 data-icon="inline-start" />
					Fields
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Contact fields</DialogTitle>
					<DialogDescription>Every contact has a first name and tags. Add your own, like a company or a birthday.</DialogDescription>
				</DialogHeader>

				{fields.length > 0 && (
					<ul className="flex flex-col divide-y divide-border/60 rounded-xl shadow-border">
						{fields.map((field) => (
							<RowField key={field.key} field={field} />
						))}
					</ul>
				)}

				{fields.length < MAX_CONTACT_FIELDS && <FormAddField />}
			</DialogContent>
		</Dialog>
	);
}

function RowField({ field }) {
	const [isConfirming, setIsConfirming] = useState(false);
	const [isDeleting, startDeleting] = useTransition();

	function remove() {
		if (!isConfirming) return setIsConfirming(true);
		startDeleting(async () => {
			const result = await deleteContactField(field.key);
			if (result?.error) toast.error(result.error);
			setIsConfirming(false);
		});
	}

	return (
		<li className="flex items-center gap-3 py-2 pr-1.5 pl-3 animate-enter">
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{field.label}</span>
				<span className="block truncate text-xs text-muted-foreground">
					{FIELD_TYPES[field.type]?.label} · <code className="font-mono">{field.key}</code>
				</span>
			</span>
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

function FormAddField() {
	const [label, setLabel] = useState("");
	const [type, setType] = useState("text");
	const [isAdding, startAdding] = useTransition();

	function add(event) {
		event.preventDefault();
		startAdding(async () => {
			const result = await createContactField({ label, type });
			if (result?.error) return void toast.error(result.error);
			setLabel("");
		});
	}

	return (
		<form onSubmit={add} className="flex gap-2">
			<Input
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
