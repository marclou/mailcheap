import { createContext, use } from "react";
import { OWNER_ROLE, hasRole } from "./team-rules.js";

export const TeamRoleContext = createContext(OWNER_ROLE);

// The user's role on the newsletter the dashboard has open (components/ProviderTeamRole.jsx): owner on their own.
export function useTeamRole() {
	return use(TeamRoleContext);
}

// Whether it lets them do what needs this role. The actions check it again on the server.
export function useHasRole(needed) {
	return hasRole(useTeamRole(), needed);
}
