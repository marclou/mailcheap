"use client";

import { useState, useTransition } from "react";
import { Loader2, Moon, MoreHorizontal, Pencil, Trash2, UserCheck, UserPlus, UserX } from "lucide-react";
import { deleteContact, setContactStatus } from "@/app/(app)/contacts/actions";
import DialogContactDetails from "@/components/DialogContactDetails";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_LOCKS, getStatusChanges, needsConsent } from "@/lib/contact-status";
import { toast } from "@/lib/toast";

// Deleted, they leave their status behind (lib/contacts.js).
const AFTER_DELETE = {
	unsubscribed: "They unsubscribed, so adding them again won't email them.",
	bounced: "Their address bounced, so adding it again won't email it.",
	complained: "They marked an email as spam, so adding them again won't email them.",
};

// Its details, the status changes lib/contact-status.js allows for this contact, then delete. firstName, tags, fields:
// what the details dialog edits.
export default function MenuContact({ id, email, status, firstName = "", tags = [], fields = {} }) {
	const [dialog, setDialog] = useState(null);
	const [isPending, startTransition] = useTransition();
	const lock = STATUS_LOCKS[status];

	function change(nextStatus) {
		if (needsConsent(status, nextStatus)) return void setDialog("consent");
		startTransition(async () => {
			const result = await setContactStatus(id, nextStatus);
			if (result?.error) toast.error(result.error);
		});
	}

	function changeOpen(name) {
		return (open) => setDialog(open ? name : null);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Actions for ${email}`}
						disabled={isPending}
						className="text-muted-foreground hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
					>
						{isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuItem onSelect={() => setDialog("details")}>
						<Pencil />
						Edit details
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{lock && <DropdownMenuLabel className="max-w-56 font-normal">{lock}.</DropdownMenuLabel>}
					{getStatusChanges(status).map((nextStatus) => {
						const { label, icon: Icon } = getChangeItem(status, nextStatus);
						return (
							<DropdownMenuItem
								key={nextStatus}
								variant={nextStatus === "unsubscribed" ? "destructive" : "default"}
								onSelect={() => change(nextStatus)}
							>
								<Icon />
								{label}
							</DropdownMenuItem>
						);
					})}
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
						<Trash2 />
						Delete contact
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogContactDetails
				contact={{ id, email, firstName, tags, fields }}
				isOpen={dialog === "details"}
				onOpenChange={changeOpen("details")}
			/>
			<DialogConsentContact id={id} email={email} status={status} isOpen={dialog === "consent"} onOpenChange={changeOpen("consent")} />
			<DialogDeleteContact id={id} email={email} status={status} isOpen={dialog === "delete"} onOpenChange={changeOpen("delete")} />
		</>
	);
}

function getChangeItem(from, to) {
	if (to === "unsubscribed") return { label: "Unsubscribe", icon: UserX };
	if (to === "dormant") return { label: "Mark as dormant", icon: Moon };
	if (from === "unsubscribed") return { label: "Resubscribe…", icon: UserPlus };
	return { label: needsConsent(from, to) ? "Mark as active…" : "Mark as active", icon: UserCheck };
}

// Before resubscribing someone, or making active someone who never clicked the confirmation email.
function DialogConsentContact({ id, email, status, isOpen, onOpenChange }) {
	const [formKey, setFormKey] = useState(0);

	function changeOpen(open) {
		onOpenChange(open);
		if (!open) setFormKey((key) => key + 1);
	}

	return (
		<Dialog open={isOpen} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-sm">
				<FormConsent key={formKey} id={id} email={email} status={status} onDone={() => changeOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormConsent({ id, email, status, onDone }) {
	const [hasConsent, setHasConsent] = useState(false);
	const [isSaving, startSaving] = useTransition();
	const isResubscribe = status === "unsubscribed";

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await setContactStatus(id, "active", true);
			if (result?.error) return void toast.error(result.error);
			onDone();
			toast.success(isResubscribe ? `${email} resubscribed` : `${email} is active`);
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>{isResubscribe ? "Resubscribe this contact?" : "Mark this contact as active?"}</DialogTitle>
				<DialogDescription>
					<span className="font-medium wrap-anywhere text-foreground">{email}</span>{" "}
					{isResubscribe
						? "unsubscribed. Once resubscribed, they get your next issues."
						: "hasn't clicked your confirmation email. Once active, they get your next issues."}{" "}
					No email goes out now.
				</DialogDescription>
			</DialogHeader>
			<label className="flex items-start gap-2.5 text-sm">
				<input
					type="checkbox"
					checked={hasConsent}
					onChange={(event) => setHasConsent(event.target.checked)}
					required
					className="mt-0.5 size-4 shrink-0 accent-foreground"
				/>
				{isResubscribe ? "They asked to get my emails again" : "They asked to get my emails"}
			</label>
			<DialogFooter>
				<DialogClose asChild>
					<Button type="button" variant="outline">
						Cancel
					</Button>
				</DialogClose>
				<Button type="submit" disabled={!hasConsent || isSaving} className="min-w-28">
					{isSaving ? <Loader2 className="animate-spin" /> : isResubscribe ? "Resubscribe" : "Mark as active"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function DialogDeleteContact({ id, email, status, isOpen, onOpenChange }) {
	const [isDeleting, startDeleting] = useTransition();

	function remove() {
		startDeleting(async () => {
			const result = await deleteContact(id);
			if (result?.error) return void toast.error(result.error);
			onOpenChange(false);
			toast.success("Contact deleted");
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Delete this contact?</DialogTitle>
					<DialogDescription>
						<span className="font-medium wrap-anywhere text-foreground">{email}</span> leaves your contacts.{" "}
						{AFTER_DELETE[status] ?? "They can be added again later."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={remove} disabled={isDeleting} className="min-w-20">
						{isDeleting ? <Loader2 className="animate-spin" /> : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
