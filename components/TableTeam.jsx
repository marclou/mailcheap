"use client";

import { useTransition } from "react";
import { Loader2, MoreHorizontal, Send, UserMinus } from "lucide-react";
import { changeTeamRole, removeTeamMember, resendInvitation } from "@/app/(app)/newsletters/team/actions";
import AvatarUser from "@/components/AvatarUser";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { OWNER_ROLE, ROLE_LABELS, TEAM_ROLES } from "@/lib/team-rules";
import { toast } from "@/lib/toast";

// The newsletter's team on its Team page: its owner, then everyone invited, each with their role, which the owner
// changes here, and a menu to send a waiting invitation again or remove them. owner and members: { name, email, image,
// gravatarHash }, members with { id, role, status, joinedAt, expiresAt }.
export default function TableTeam({ newsletterId, owner, members }) {
	return (
		<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border animate-enter">
			<RowPerson person={owner} detail={owner.email}>
				<span className="pr-3 text-sm text-muted-foreground">{ROLE_LABELS[OWNER_ROLE]}</span>
			</RowPerson>
			{members.map((member) => (
				<RowMember key={member.id} newsletterId={newsletterId} member={member} />
			))}
		</ul>
	);
}

function RowPerson({ person, detail, children }) {
	return (
		<li className="flex items-center gap-3 px-4 py-3">
			<AvatarUser name={person.name} email={person.email} image={person.image} gravatarHash={person.gravatarHash} size={32} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium">{person.name || person.email}</span>
				<span className="truncate text-xs text-muted-foreground">{detail}</span>
			</span>
			<span className="flex shrink-0 items-center gap-1">{children}</span>
		</li>
	);
}

function RowMember({ newsletterId, member }) {
	const [isPending, startTransition] = useTransition();

	function run(action, success) {
		startTransition(async () => {
			const result = await action();
			if (result?.error) toast.error(result.error);
			else if (success) toast.success(success);
		});
	}

	function remove() {
		const what = member.status === "joined" ? `Remove ${member.name} from the team? They lose access now.` : `Cancel ${member.name}'s invitation?`;
		if (!window.confirm(what)) return;
		run(() => removeTeamMember(newsletterId, member.id), member.status === "joined" ? "Removed from the team" : "Invitation canceled");
	}

	return (
		<RowPerson person={member} detail={`${member.email} · ${describeStatus(member)}`}>
			{isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />}
			<Select value={member.role} onValueChange={(role) => run(() => changeTeamRole(newsletterId, member.id, role), `${member.name} is now ${role === "admin" ? "an admin" : "a member"}`)} disabled={isPending}>
				<SelectTrigger size="sm" aria-label={`${member.name}'s role`} className="w-28">
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="end">
					{[...TEAM_ROLES].reverse().map((role) => (
						<SelectItem key={role} value={role}>
							{ROLE_LABELS[role]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`More for ${member.name}`} disabled={isPending} className="text-muted-foreground">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-48">
					{member.status !== "joined" && (
						<DropdownMenuItem onSelect={() => run(() => resendInvitation(newsletterId, member), `Invitation sent again to ${member.email}`)}>
							<Send />
							Send invitation again
						</DropdownMenuItem>
					)}
					<DropdownMenuItem variant="destructive" onSelect={remove}>
						<UserMinus />
						{member.status === "joined" ? "Remove from team" : "Cancel invitation"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</RowPerson>
	);
}

function describeStatus({ status, joinedAt, expiresAt }) {
	if (status === "joined") return `Joined ${formatDate(joinedAt)}`;
	if (status === "expired") return "Invitation expired";
	return `Invited · link works until ${formatDate(expiresAt)}`;
}
