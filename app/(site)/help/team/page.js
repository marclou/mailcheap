import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { INVITATION_DAYS, MAX_TEAM_MEMBERS } from "@/lib/team-rules";

export const metadata = getHelpPageMetadata("team");

export default function TeamPage() {
	return (
		<ArticleHelp slug="team">
			<h2 id="invite">Inviting someone</h2>
			<p>
				Open the newsletter, then its <LinkApp href="/newsletters/team">Team page</LinkApp> from Settings, and click Invite: their
				name, the address the invitation goes to, and their role, admin or member. They get an email with a link that works for{" "}
				{INVITATION_DAYS} days. Signing in with that address and clicking Join opens the newsletter for them, with what their role
				allows. Someone new to MailCheap signs up the same way, with that address.
			</p>
			<p>
				Each newsletter has its own team, of {MAX_TEAM_MEMBERS} people at most, invited or joined. Only you, the account&apos;s
				owner, invite people, change their role and remove them.
				{isCloud() ? " Inviting needs a plan; the people you invite don't need one." : ""}
				{!isCloud() && " On a self-hosted server, they also need to be on its ALLOWED_EMAILS to sign in."}
			</p>

			<h2 id="roles">What each role can do</h2>
			<ul>
				<li>
					<strong>Admins</strong> do everything on the newsletter: write, send and schedule its issues, look after its contacts and
					segments, import, export and delete them, and change its settings. Billing, sending domains, API keys, the team and the
					newsletter&apos;s summary email stay yours.
				</li>
				<li>
					<strong>Members</strong> write and edit drafts, send tests to themselves, see the reports, and add, import, edit and tag
					contacts. They don&apos;t send or schedule issues, change settings, export or delete contacts. Once an admin schedules an
					issue, it goes out as they left it.
				</li>
			</ul>

			<h2 id="shared">Working on a shared newsletter</h2>
			<p>
				The newsletter menu, at the top of the sidebar, lists the newsletters shared with you under Shared with you, with your
				role on each. Pick one to work on it; your own account, its newsletters, billing and API keys, stays as it is. Team members
				work from the dashboard: API keys and connected AI assistants reach only their own account&apos;s newsletters.{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>

			<h2 id="change">Changing a role or removing someone</h2>
			<p>
				On the <LinkApp href="/newsletters/team">Team page</LinkApp>, pick another role next to their name, or remove them from its
				menu: their access ends at their next click, and the drafts and contacts they added stay. A waiting invitation can be sent
				again, with a new link, or canceled the same way.
			</p>
		</ArticleHelp>
	);
}
