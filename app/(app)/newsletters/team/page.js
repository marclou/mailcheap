import { redirect } from "next/navigation";
import DialogInviteMember from "@/components/DialogInviteMember";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import LinkHelp from "@/components/LinkHelp";
import TableTeam from "@/components/TableTeam";
import { isCloud } from "@/lib/config";
import { gravatarHash } from "@/lib/gravatar";
import { SETTINGS_PARENT, TEAM_SECTION } from "@/lib/newsletter-sections";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { requireRole } from "@/lib/selected-newsletter";
import { findMemberUsers, listTeam } from "@/lib/team";
import { MAX_TEAM_MEMBERS, OWNER_ROLE, getMemberStatus } from "@/lib/team-rules";

export const metadata = { title: TEAM_SECTION.label };

// Who works on the open newsletter with its owner, who alone invites them, changes their role and removes them. A
// joined member shows their own photo and name, as they set them.
export default async function TeamPage() {
	const { user, account, selected } = await requireRole(OWNER_ROLE);
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const members = await listTeam(account, selected._id);
	const users = await findMemberUsers(members);
	const isAtLimit = members.length >= MAX_TEAM_MEMBERS;

	return (
		<LayoutNarrow>
			<HeaderPage title={TEAM_SECTION.label} parent={SETTINGS_PARENT}>
				<GatePlan reason="team">
					<DialogInviteMember key={String(selected._id)} newsletterId={String(selected._id)} isAtLimit={isAtLimit} />
				</GatePlan>
			</HeaderPage>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-pretty text-muted-foreground animate-enter">
					Invite up to {MAX_TEAM_MEMBERS} people to work on {selected.name} with you. Admins can do everything on it except billing,
					domains and API keys; members write drafts and add contacts.{" "}
					{!isCloud() && "On this server, they also need to be on ALLOWED_EMAILS to sign in. "}
					<LinkHelp article="team" />
				</p>
				<TableTeam
					newsletterId={String(selected._id)}
					owner={{ name: user.name, email: user.email, image: user.image ?? null, gravatarHash: gravatarHash(user.email) }}
					members={members.map((member) => {
						const joined = member.userId ? users.get(String(member.userId)) : null;
						return {
							id: String(member._id),
							name: joined?.name?.trim() || member.name,
							email: member.email,
							image: joined?.image ?? null,
							gravatarHash: gravatarHash(member.email),
							role: member.role,
							status: getMemberStatus(member),
							joinedAt: member.joinedAt?.toISOString() ?? null,
							expiresAt: member.expiresAt?.toISOString() ?? null,
						};
					})}
				/>
				{isAtLimit && <p className="text-sm text-muted-foreground">A newsletter&apos;s team has {MAX_TEAM_MEMBERS} people at most: remove someone to invite someone else.</p>}
			</div>
		</LayoutNarrow>
	);
}
