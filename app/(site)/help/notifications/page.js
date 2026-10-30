import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import FigureHelp from "@/components/FigureHelp";
import LinkApp from "@/components/LinkApp";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("notifications");

export default function NotificationsPage() {
	return (
		<ArticleHelp slug="notifications">
			<h2 id="bell">The bell</h2>
			<p>
				The bell in the sidebar, in a section of its own under <LinkApp href="/domains">Domains</LinkApp> and{" "}
				<LinkApp href="/api-keys">API keys</LinkApp>, or at the top of the screen on a phone, shows what happened in your account.
				Its red badge counts the new ones. Opening it marks what it shows as read, so the badge goes away, and the new ones stay
				highlighted until you close it.
			</p>
			<FigureHelp
				src="/help/notifications/bell.webp"
				alt="The notifications open beside the sidebar's Notifications section: an import, a sent campaign and an issue under review marked new, above a paused campaign."
				caption="Your notifications"
			/>
			<p>
				Click one to open the page it&apos;s about: the campaign that paused or was sent, the{" "}
				<LinkApp href="/contacts">Contacts page</LinkApp> of the newsletter an import went to, or the{" "}
				<LinkApp href="/domains">Domains page</LinkApp> for a domain to fix. When the same thing happens again, like a second spam
				complaint, its notification comes back on top as new instead of adding another. Notifications stay 90 days.
			</p>

			<h2 id="what">What shows there</h2>
			<ul>
				<li>
					<strong>What needs you</strong>, which MailCheap emails you too: a campaign that paused, your account blocked, a domain
					that stopped sending, bounces or complaints getting high, a spam complaint, signups paused after a flood, a scheduled send
					that didn&apos;t start, and an issue or a signup email that can&apos;t be sent.
				</li>
				<li>
					<strong>News</strong>, in the dashboard only: a campaign sent to everyone on its list, an issue under review and then
					approved, and an import that ran in the background, once it&apos;s done or if it stopped.
				</li>
			</ul>
			<p>
				A small file goes in while you wait and its result shows right away, so it doesn&apos;t get a notification.{" "}
				<Link href={getHelpHref("importing-contacts", "background")}>Big files</Link>
			</p>

			<h2 id="emails">Emails</h2>
			<p>
				What needs you also goes to your account&apos;s email address, so you hear of it away from the dashboard. Its email links
				to the same page as its notification.
			</p>
			{isCloud() && (
				<p>
					Summary emails, with each newsletter&apos;s numbers every week or every day, are set for each newsletter on its{" "}
					<LinkApp href="/newsletters/notifications">Notifications page</LinkApp>.{" "}
					<Link href={getHelpHref("newsletters", "notifications")}>Summary emails</Link>
				</p>
			)}

			<h2 id="api">From the API and AI assistants</h2>
			<p>
				<Link href="/docs/api#list-notifications">List notifications</Link> returns the same notifications, with the page each one
				is about, and mark_notifications_read marks them read, as opening the bell does. An AI assistant connected to MailCheap can
				tell you what needs you.{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>
		</ArticleHelp>
	);
}
