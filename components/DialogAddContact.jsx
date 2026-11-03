"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { addContact } from "@/app/(app)/contacts/actions";
import InputTags from "@/components/InputTags";
import { useContactOptions } from "@/components/ProviderContactOptions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ERROR_CODES } from "@/lib/account-state";
import { MAX_FIRST_NAME } from "@/lib/contact-fields";
import { toast } from "@/lib/toast";
import { usePaywall } from "@/lib/use-paywall";

// Into the newsletter the page shows. onCloseAutoFocus: where the focus goes back, as what opened it is outside the dialog.
export default function DialogAddContact({ newsletter, isOpen, onOpenChange, onCloseAutoFocus }) {
	const [formKey, setFormKey] = useState(0);

	function changeOpen(open) {
		onOpenChange(open);
		if (!open) setFormKey((key) => key + 1);
	}

	return (
		<Dialog open={isOpen} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<FormContact key={formKey} newsletter={newsletter} onClose={() => changeOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormContact({ newsletter, onClose }) {
	const paywall = usePaywall();
	const { tags: tagOptions } = useContactOptions();
	const nameId = useId();
	const emailId = useId();
	const [firstName, setFirstName] = useState("");
	const [email, setEmail] = useState("");
	const [isTagging, setIsTagging] = useState(false);
	const [tags, setTags] = useState([]);
	const [hasConsent, setHasConsent] = useState(false);
	const [state, action, isPending] = useActionState(async (previous, formData) => {
		const result = await addContact(previous, formData);
		if (result?.code === ERROR_CODES.subscriptionRequired && paywall) {
			onClose();
			paywall.open("contact");
		} else if (!result?.error) {
			onClose();
			toast.success(getAddedMessage(result));
		} else {
			// React resets the form after its action, which unticks the box but leaves its state.
			setHasConsent(false);
		}
		return result;
	}, null);

	return (
		<form action={action} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>Add a contact</DialogTitle>
				<DialogDescription>
					They join <span className="font-medium text-foreground">{newsletter?.name}</span> right away, with no confirmation
					email.
				</DialogDescription>
			</DialogHeader>
			<input type="hidden" name="newsletterId" value={newsletter?.id ?? ""} />
			<div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className="flex flex-col gap-1.5">
					<label htmlFor={nameId} className="text-sm font-medium">
						First name
					</label>
					<Input
						id={nameId}
						name="firstName"
						value={firstName}
						onChange={(event) => setFirstName(event.target.value)}
						placeholder="Optional"
						maxLength={MAX_FIRST_NAME}
						autoComplete="off"
						autoFocus
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor={emailId} className="text-sm font-medium">
						Email
					</label>
					<Input
						id={emailId}
						type="email"
						name="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="jane@example.com"
						required
						maxLength={320}
						autoComplete="email"
						spellCheck={false}
					/>
				</div>
			</div>
			{isTagging ? (
				<div className="flex flex-col gap-1.5 animate-enter">
					<span className="text-sm font-medium">Tags</span>
					<InputTags value={tags} onChange={setTags} suggestions={tagOptions} maxSuggestions={6} autoFocus />
				</div>
			) : (
				<Button type="button" variant="ghost" size="sm" onClick={() => setIsTagging(true)} className="-ml-1.5 self-start text-muted-foreground">
					<Plus data-icon="inline-start" />
					Add tags
				</Button>
			)}
			{tags.map((tag) => (
				<input key={tag} type="hidden" name="tags" value={tag} />
			))}
			<label className="flex items-start gap-2.5 text-sm">
				<input
					type="checkbox"
					name="consent"
					checked={hasConsent}
					onChange={(event) => setHasConsent(event.target.checked)}
					required
					className="mt-0.5 size-4 shrink-0 accent-foreground"
				/>
				This person agreed to get my emails
			</label>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={!hasConsent || isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Add"}
				</Button>
			</DialogFooter>
		</form>
	);
}

// A suppressed address joins as bounced, complained or unsubscribed.
function getAddedMessage({ email, status }) {
	return status === "active" ? `${email} added` : `${email} added as ${status}`;
}
