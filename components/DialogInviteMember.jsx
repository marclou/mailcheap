"use client";

import { useActionState, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { inviteTeamMember } from "@/app/(app)/newsletters/team/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { INVITATION_DAYS, MAX_MEMBER_NAME_LENGTH, ROLE_DESCRIPTIONS, ROLE_LABELS, TEAM_ROLES } from "@/lib/team-rules";
import { toast } from "@/lib/toast";

// Invite someone to the open newsletter's team: their name, the address the invitation goes to, and their role. Closed,
// it starts over empty.
export default function DialogInviteMember({ newsletterId, isAtLimit }) {
	const [isOpen, setIsOpen] = useState(false);
	const [formKey, setFormKey] = useState(0);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) setFormKey((key) => key + 1);
			}}
		>
			<DialogTrigger asChild>
				<Button disabled={isAtLimit}>
					<UserPlus data-icon="inline-start" />
					Invite
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<FormInvite key={formKey} newsletterId={newsletterId} onSent={() => setIsOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormInvite({ newsletterId, onSent }) {
	const [state, action, isPending] = useActionState(async (previous, formData) => {
		const result = await inviteTeamMember(previous, formData);
		if (result?.ok) {
			toast.success(`Invitation sent to ${result.email}`);
			onSent();
		}
		return result;
	}, null);

	return (
		<form action={action} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>Invite to your team</DialogTitle>
				<DialogDescription>
					They get an email with a link that works for {INVITATION_DAYS} days, and sign in with this address to join.
				</DialogDescription>
			</DialogHeader>
			<input type="hidden" name="newsletterId" value={newsletterId} />
			<Input name="name" placeholder="Name" aria-label="Name" required autoFocus maxLength={MAX_MEMBER_NAME_LENGTH} autoComplete="off" />
			<Input name="email" type="email" placeholder="Email" aria-label="Email" required maxLength={254} autoComplete="off" />
			<fieldset className="grid gap-2">
				<legend className="sr-only">Access</legend>
				{[...TEAM_ROLES].reverse().map((role) => (
					<label
						key={role}
						className="flex items-start gap-3 rounded-lg p-3 shadow-border transition-[box-shadow,background-color] duration-150 hover:shadow-border-hover has-checked:bg-muted/60 has-checked:shadow-border-hover"
					>
						<input type="radio" name="role" value={role} defaultChecked={role === "member"} className="mt-0.5 size-4 shrink-0 accent-foreground" />
						<span className="flex flex-col gap-0.5">
							<span className="text-sm font-medium">{ROLE_LABELS[role]}</span>
							<span className="text-xs text-pretty text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
						</span>
					</label>
				))}
			</fieldset>
			{state?.error && <p className="text-sm text-pretty text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending} className="min-w-36">
					{isPending ? <Loader2 className="animate-spin" /> : "Send invitation"}
				</Button>
			</DialogFooter>
		</form>
	);
}
