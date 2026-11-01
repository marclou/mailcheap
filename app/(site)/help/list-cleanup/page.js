import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { CLEANUP_LIMITS, LAST_CHANCE_DAYS, getCleanupDefaults } from "@/lib/cleanup";
import { isCloud } from "@/lib/config";
import { isSpamListEnabled } from "@/lib/domain-reputation";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("list-cleanup");

export default function ListCleanupPage() {
	const cleanup = getCleanupDefaults();
	const showSpamList = isCloud() || isSpamListEnabled();

	return (
		<ArticleHelp slug="list-cleanup">
			<h2 id="why">Why it exists</h2>
			<p>
				People who never open your emails still receive them, and inboxes notice: a list full of readers who ignore you pushes your
				issues toward spam for everyone else.
				{isCloud() && " They also count toward your plan's subscribers."} List cleanup asks them once whether they still want your
				newsletter, and stops sending to those who don&apos;t answer.
			</p>

			<h2 id="how">How it works</h2>
			<p>It runs each time an issue goes out, for each contact on the list:</p>
			<ol>
				<li>
					<strong>Cold contacts get a last-chance email instead of the issue.</strong> A contact is cold after {cleanup.issues} ignored
					issues in a row and {cleanup.days} days without a sign of life. Opens, clicks, signing up again and the confirmation click
					are signs of life, and any of them starts the count over.
				</li>
				<li>
					<strong>One click keeps them.</strong> The email has a button, &ldquo;Yes, keep sending it&rdquo; until you{" "}
					<Link href={getHelpHref("list-cleanup", "last-chance-email")}>write your own</Link>. Clicking it puts them back in your list
					as before.
				</li>
				<li>
					<strong>No answer makes them dormant.</strong> Until they answer, they get no issues. At your first send {LAST_CHANCE_DAYS}{" "}
					days or more after the last-chance email, those who didn&apos;t click become dormant.
				</li>
			</ol>
			<p>
				Dormant contacts stay in your list: they&apos;re never unsubscribed or deleted, and you can mark any of them active from the{" "}
				<LinkApp href="/contacts">Contacts page</LinkApp>.{isCloud() && " They don't count toward your plan's subscribers."}
			</p>

			<h2 id="last-chance-email">The last-chance email</h2>
			<p>
				MailCheap&apos;s own last-chance email asks whether they still want your newsletter, and follows its name. On the{" "}
				<LinkApp href="/newsletters/cleanup">List cleanup page</LinkApp>, you can write your own subject, preview text and content
				instead, in your words or your readers&apos; language, in the same <Link href={getHelpHref("writing", "editor")}>editor</Link>{" "}
				as your issues. Keep its button: each contact gets their own link in it, and its toolbar says Keeps them on your list. If
				it&apos;s gone, Add the button brings it back, and Use the built-in email goes back to MailCheap&apos;s. Preview shows it as
				they get it.
			</p>
			{isCloud() && (
				<p>
					Like issues, it goes through the <Link href={getHelpHref("sending", "content-check")}>content check</Link> when you save
					it: while it&apos;s in review, cold contacts get MailCheap&apos;s own.
				</p>
			)}

			<h2 id="before-sending">Before you send</h2>
			<p>
				When you send now, the send step counts what the cleanup will do: how many get the issue, how many get the last-chance email
				instead, how many are still waiting to answer one and how many become dormant. A scheduled issue runs the cleanup when it
				goes out. The campaign&apos;s report then shows the last-chance emails apart from the issue.
			</p>

			<h2 id="domains">{showSpamList ? "Spam domains and domains without mail" : "Domains that can\u2019t receive email"}</h2>
			<p>
				Apart from the cleanup, MailCheap checks in the background that the domains of your contacts can receive email, each domain
				about once a month, for every newsletter, with nothing to turn on. A domain that no longer exists, or that has no mail
				server, would make every email bounce. Once two checks a day apart agree, its contacts stop getting issues and show as
				bounced, marked &ldquo;No mail server&rdquo;. Nothing was sent, so they don&apos;t count against your bounce rate. The domain
				is checked again every week, and its contacts get your issues again as soon as it can receive email. A check DNS can&apos;t
				answer never stops anyone.
			</p>
			{showSpamList && (
				<p>
					Contacts on a known spam domain, from StopForumSpam&apos;s list updated every day, stop the same way at once, marked
					&ldquo;Spam domain&rdquo;, and signups and imports from those domains are left out. Contacts who ever opened or clicked
					never stop for it, and neither do addresses at mailbox providers, internet providers or privacy relays like SimpleLogin.
					They come back if the list drops their domain.
				</p>
			)}
			<p>
				The counts are in the <LinkApp href="/newsletters/cleanup">List cleanup section</LinkApp>. Signups and imports already leave
				out addresses on these domains, and throwaway inboxes on imports.
			</p>

			<h2 id="settings">Settings</h2>
			<p>
				List cleanup is on for new newsletters. In the <LinkApp href="/newsletters/cleanup">List cleanup section</LinkApp> of the{" "}
				<Link href={getHelpHref("newsletters", "list-cleanup")}>newsletter&apos;s settings</Link>, turn it off, or change when a contact
				counts as cold: {CLEANUP_LIMITS.minIssues} to {CLEANUP_LIMITS.maxIssues} ignored issues, counting from the first issue MailCheap
				sent them, and {CLEANUP_LIMITS.minDays} to {CLEANUP_LIMITS.maxDays} quiet days. A weekly newsletter can go lower on days.
				The <Link href={getHelpHref("list-cleanup", "last-chance-email")}>last-chance email</Link> is there too, while the cleanup is
				on.
			</p>
		</ArticleHelp>
	);
}
