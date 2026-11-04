"use client";

import AvatarCollaborator from "@/components/AvatarCollaborator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePresenceOthers } from "@/lib/use-presence";

const MAX_SHOWN = 3;

// Who else is on a team's draft, beside Saved in its top bar (presence: lib/use-presence.js).
export default function StackCollaborators({ presence }) {
	const others = usePresenceOthers(presence);
	if (others.length === 0) return null;
	const names = new Intl.ListFormat("en", { type: "conjunction" }).format(others.map(({ name }) => name));
	const label = `${names} ${others.length === 1 ? "is" : "are"} on this draft too`;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span tabIndex={0} aria-label={label} className="flex shrink-0 items-center -space-x-1.5 rounded-full animate-enter">
					{others.slice(0, MAX_SHOWN).map((person) => (
						<AvatarCollaborator key={person.id} person={person} size={24} className="ring-2 ring-background" />
					))}
					{others.length > MAX_SHOWN && (
						<span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums ring-2 ring-background">
							+{others.length - MAX_SHOWN}
						</span>
					)}
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
