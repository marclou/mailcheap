// A newsletter's team (models/TeamMember.js): people its account's owner invites to work on it. Each has a role on that
// newsletter alone; the account's owner can do everything, on every newsletter of the account.
export const TEAM_ROLES = ["admin", "member"];
export const OWNER_ROLE = "owner";
const ROLE_RANKS = { member: 1, admin: 2, [OWNER_ROLE]: 3 };
// Invited and joined alike, so an owner can't email more people than that from one newsletter.
export const MAX_TEAM_MEMBERS = 5;
export const INVITATION_DAYS = 7;
export const MAX_MEMBER_NAME_LENGTH = 60;
export const JOIN_PATH = "/join";

export const ROLE_LABELS = { [OWNER_ROLE]: "Owner", admin: "Admin", member: "Member" };
export const ROLE_DESCRIPTIONS = {
	admin: "Everything on this newsletter: writing, sending, contacts and settings. Not billing, domains or API keys.",
	member: "Writes and edits drafts, sends tests to themselves, and adds, imports and edits contacts. Doesn't send, change settings, export or delete.",
};

// Whether a role can do what needs another: an admin can do what a member can, the owner what anyone can.
export function hasRole(role, needed) {
	return (ROLE_RANKS[role] ?? 0) >= (ROLE_RANKS[needed] ?? Number.POSITIVE_INFINITY);
}

export function getJoinPath(token) {
	return `${JOIN_PATH}/${token}`;
}

// joined: they accepted. expired: the link's week is over, until the owner sends it again. invited: waiting for them.
export function getMemberStatus(member, now = new Date()) {
	if (member.joinedAt) return "joined";
	return member.expiresAt && new Date(member.expiresAt).getTime() <= now.getTime() ? "expired" : "invited";
}

export function getInvitationExpiry(now = new Date()) {
	return new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
}
