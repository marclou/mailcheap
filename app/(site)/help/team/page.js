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
				{INVITATION_DAYS} days. It opens MailCheap&apos;s sign-in with their address filled in: the code MailCheap emails them signs
				them in and opens the newsletter, with what their role allows. Someone new to MailCheap gets an account with the name you
				typed, which they can change on their Account page.
			</p>
			<p>
				They join with the address you invited, the one the code goes to: another address is another MailCheap account, which
				doesn&apos;t see the newsletter. Already signed in with another one, they switch to it from the invitation&apos;s page.
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
					<strong>Members</strong> write and edit drafts, send <Link href={getHelpHref("writing", "preview")}>tests</Link> to the
					newsletter&apos;s team, see the reports, and add, import, edit and tag
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

			<h2 id="together">Writing a draft together</h2>
			<p>
				Once someone joins a newsletter&apos;s team, its drafts in <LinkApp href="/campaigns">Campaigns</LinkApp> show who else is
				on them: their picture at the top, their pointer with their first name, and a line in their color beside the paragraph or
				the field they&apos;re typing in.
			</p>
			<p>
				Your saves and theirs never write over each other. When they saved since you last did, MailCheap brings their changes
				into your draft, paragraph by paragraph, and saves both: you each keep writing where you are. When you both change the
				same paragraph, the one typed last stays. Undo undoes your own changes, not theirs. A newsletter without a team saves
				as it always did.
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
