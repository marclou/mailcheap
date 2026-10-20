"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { updateContactDetails } from "@/app/(app)/contacts/actions";
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
import { Input } from "@/components/ui/input";
import { MAX_FIRST_NAME } from "@/lib/contact-fields";
import { toast } from "@/lib/toast";

// A contact's first name, its values for the account's fields and its tags. contact: { id, email, firstName, tags,
// fields }, with dates as YYYY-MM-DD.
export default function DialogContactDetails({ contact, isOpen, onOpenChange }) {
	const [formKey, setFormKey] = useState(0);

	function changeOpen(open) {
		onOpenChange(open);
		if (!open) setFormKey((key) => key + 1);
	}

	return (
		<Dialog open={isOpen} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-md">
				<FormContactDetails key={formKey} contact={contact} onDone={() => changeOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormContactDetails({ contact, onDone }) {
	const { fields, tags: tagOptions } = useContactOptions();
	const nameId = useId();
	const [firstName, setFirstName] = useState(contact.firstName ?? "");
	const [tags, setTags] = useState(contact.tags ?? []);
	const [values, setValues] = useState(() =>
		Object.fromEntries(fields.map(({ key }) => [key, contact.fields?.[key] === undefined ? "" : String(contact.fields[key])]))
	);
	const [isSaving, startSaving] = useTransition();

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await updateContactDetails(contact.id, {
				firstName: firstName.trim(),
				tags,
				fields: Object.fromEntries(fields.map(({ key }) => [key, values[key]?.trim() ? values[key].trim() : null])),
			});
			if (result?.error) return void toast.error(result.error);
			onDone();
			toast.success("Contact saved");
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle className="truncate">{contact.email}</DialogTitle>
				<DialogDescription className="sr-only">Their first name, fields and tags</DialogDescription>
			</DialogHeader>

			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<label htmlFor={nameId} className="text-sm font-medium">
						First name
					</label>
					<Input
						id={nameId}
						value={firstName}
						onChange={(event) => setFirstName(event.target.value)}
						placeholder="Jane"
						maxLength={MAX_FIRST_NAME}
						autoComplete="off"
						autoFocus
					/>
					<p className="text-xs text-muted-foreground">
						What <code className="font-mono">{"{{first_name}}"}</code> shows in your emails
					</p>
				</div>

				{fields.map((field) => (
					<InputField
						key={field.key}
						field={field}
						value={values[field.key]}
						onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
					/>
				))}

				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">Tags</span>
					<InputTags value={tags} onChange={setTags} suggestions={tagOptions.map(({ name }) => name)} />
				</div>
			</div>

			<DialogFooter>
				<DialogClose asChild>
					<Button type="button" variant="outline">
						Cancel
					</Button>
				</DialogClose>
				<Button type="submit" disabled={isSaving} className="min-w-20">
					{isSaving ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function InputField({ field, value, onChange }) {
	const inputId = useId();
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={inputId} className="text-sm font-medium">
				{field.label}
			</label>
			<Input
				id={inputId}
				type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
				step={field.type === "number" ? "any" : undefined}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
				maxLength={field.type === "text" ? 500 : undefined}
				autoComplete="off"
				className={field.type === "number" ? "tabular-nums" : undefined}
			/>
		</div>
	);
}
