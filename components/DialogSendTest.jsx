"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import InputContact from "@/components/InputContact";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ERROR_CODES, isPlanLimitCode } from "@/lib/account-state";
import { MAX_TEST_RECIPIENTS, describeTestRecipients, readTestRecipients } from "@/lib/test-email-rules";
import { toast } from "@/lib/toast";
import { useHasRole } from "@/lib/use-team-role";
import { useToastError } from "@/lib/use-toast-error";

// A test email: To starts with the user's default addresses (defaultRecipients), and Preview as reads it as one of the
// newsletter's contacts. onSend({ to, contact, saveAsDefault }) answers { error, code } when it didn't go out. What's
// typed stays for the next test while the page is open. description: what it sends; contactHint: what Preview as
// changes in it. onCloseAutoFocus: where the focus goes back, as what opened it may be gone.
export default function DialogSendTest({
	isOpen,
	onOpenChange,
	onCloseAutoFocus,
	newsletterId,
	defaultRecipients,
	description,
	contactHint,
	onSend,
}) {
	const [values, setValues] = useState(() => ({ to: defaultRecipients.join(", "), contact: null, saveAsDefault: false }));

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<FormSendTest
					values={values}
					onValuesChange={setValues}
					newsletterId={newsletterId}
					description={description}
					contactHint={contactHint}
					onSend={onSend}
					onClose={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function FormSendTest({ values, onValuesChange, newsletterId, description, contactHint, onSend, onClose }) {
	const toId = useId();
	const contactId = useId();
	const canSendOutside = useHasRole("admin");
	const toastError = useToastError();
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();
	const count = readTestRecipients(values.to).emails?.length ?? 1;

	function set(key, value) {
		onValuesChange((current) => ({ ...current, [key]: value }));
		setError(null);
	}

	function send(event) {
		event.preventDefault();
		// The dialog renders apart, but React passes its submit on to a form it's in (FormNewsletter).
		event.stopPropagation();
		const { emails, error: problem } = readTestRecipients(values.to);
		if (problem) return setError(problem);
		startTransition(async () => {
			const result = await onSend({ to: emails, contact: values.contact?.id ?? null, saveAsDefault: values.saveAsDefault });
			if (result?.error && result.code !== ERROR_CODES.subscriptionRequired && !isPlanLimitCode(result.code)) return setError(result.error);
			onClose();
			if (result?.error) return toastError(result);
			onValuesChange((current) => ({ ...current, to: emails.join(", "), saveAsDefault: false }));
			toast.success(`Test sent to ${describeTestRecipients(emails)}`);
		});
	}

	return (
		<form onSubmit={send} noValidate className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>Send a test email</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<label htmlFor={toId} className="text-sm font-medium">
						To
					</label>
					<Input
						id={toId}
						type="text"
						inputMode="email"
						value={values.to}
						onChange={(event) => set("to", event.target.value)}
						placeholder="you@example.com"
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						maxLength={MAX_TEST_RECIPIENTS * 260}
						aria-describedby={`${toId}-hint`}
						autoFocus
					/>
					<span id={`${toId}-hint`} className="text-xs text-pretty text-muted-foreground">
						{canSendOutside
							? `Up to ${MAX_TEST_RECIPIENTS} addresses, separated by commas`
							: `Your team's addresses, up to ${MAX_TEST_RECIPIENTS}, separated by commas`}
					</span>
					<label className="mt-1 flex cursor-pointer items-center gap-2.5 text-sm">
						<input
							type="checkbox"
							checked={values.saveAsDefault}
							onChange={(event) => set("saveAsDefault", event.target.checked)}
							className="size-4 shrink-0 accent-foreground"
						/>
						Save as my default test {count > 1 ? "addresses" : "address"}
					</label>
				</div>
				<div className="flex flex-col gap-1.5">
					<div className="flex items-baseline justify-between gap-3">
						<label htmlFor={contactId} className="text-sm font-medium">
							Preview as
						</label>
						<span className="text-xs text-muted-foreground">Optional</span>
					</div>
					<InputContact
						id={contactId}
						newsletterId={newsletterId}
						value={values.contact}
						onChange={(contact) => set("contact", contact)}
						describedBy={`${contactId}-hint`}
					/>
					<span id={`${contactId}-hint`} className="text-xs text-pretty text-muted-foreground">
						{contactHint}
					</span>
				</div>
			</div>
			{error && (
				<p role="alert" className="text-sm text-pretty text-destructive">
					{error}
				</p>
			)}
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={isPending} className="min-w-24">
					{isPending ? (
						<Loader2 className="animate-spin" />
					) : (
						<>
							<Send data-icon="inline-start" />
							Send
						</>
					)}
				</Button>
			</DialogFooter>
		</form>
	);
}
