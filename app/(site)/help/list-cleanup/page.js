import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { CLEANUP_LIMITS, LAST_CHANCE_DAYS, getCleanupDefaults } from "@/lib/cleanup";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("list-cleanup");

export default function ListCleanupPage() {
	const cleanup = getCleanupDefaults();

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
					<strong>One click keeps them.</strong> The email has a &ldquo;Yes, keep sending it&rdquo; button. Clicking it puts them back
					in your list as before.
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

			<h2 id="before-sending">Before you send</h2>
			<p>
				When you send now, the send step counts what the cleanup will do: how many get the issue, how many get the last-chance email
				instead, how many are still waiting to answer one and how many become dormant. A scheduled issue runs the cleanup when it
				goes out. The campaign&apos;s report then shows the last-chance emails apart from the issue.
			</p>

			<h2 id="settings">Settings</h2>
			<p>
				List cleanup is on for new newsletters. In the <LinkApp href="/newsletters/cleanup">List cleanup section</LinkApp> of the{" "}
				<Link href={getHelpHref("newsletters", "list-cleanup")}>newsletter&apos;s settings</Link>, turn it off, or change when a contact
				counts as cold: {CLEANUP_LIMITS.minIssues} to {CLEANUP_LIMITS.maxIssues} ignored issues, counting from the first issue MailCheap
				sent them, and {CLEANUP_LIMITS.minDays} to {CLEANUP_LIMITS.maxDays} quiet days. A weekly newsletter can go lower on days.
			</p>
		</ArticleHelp>
	);
}
