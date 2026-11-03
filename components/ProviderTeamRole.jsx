"use client";

import { TeamRoleContext } from "@/lib/use-team-role";

// The user's role on the open newsletter, for the buttons only some roles get (lib/use-team-role.js).
export default function ProviderTeamRole({ role, children }) {
	return <TeamRoleContext value={role}>{children}</TeamRoleContext>;
}
