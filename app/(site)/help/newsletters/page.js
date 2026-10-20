import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { CLEANUP_LIMITS, getCleanupDefaults } from "@/lib/cleanup";
import { getSharedDomain, isCloud } from "@/lib/config";
import { formatWindow } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { MAX_NEWSLETTERS_PER_ACCOUNT, SLUG_CHANGES } from "@/lib/newsletters";

export const metadata = getHelpPageMetadata("newsletters");

export default function NewslettersPage() {
	const sharedDomain = getSharedDomain();
	const cleanup = getCleanupDefaults();

	return (
		<ArticleHelp slug="newsletters">
			<h2 id="several">More than one newsletter</h2>
			<p>
				An account has up to {MAX_NEWSLETTERS_PER_ACCOUNT} newsletters. Add one from the newsletter menu at the top of the sidebar, where
				you also switch between them: the dashboard shows one newsletter at a time.{" "}
				{isCloud() && "They share your plan's emails and subscribers."} Each has its own contacts, campaigns, sender and website.
			</p>
			<p>
				<LinkApp href="/newsletters">Settings</LinkApp> opens on an overview of the newsletter: a card for each section below, with
				where it stands, like double opt-in on or the website&apos;s address. A card opens its section&apos;s page, and once you change
				something there, a bar offers to save or discard it.
			</p>

			<h2 id="general">General</h2>
			<ul>
				<li>
					<strong>Name</strong>: shown in emails and on your website.
				</li>
				<li>
					<strong>Slug</strong>: lowercase letters, digits and dashes.
					{sharedDomain
						? ` Your shared address (hello@slug.${sharedDomain}) and your website (slug.${sharedDomain}) follow it, so changing it moves them.`
						: " Your website's address follows it."}{" "}
					A few names like www, api or mail are kept by MailCheap. An account changes slugs {SLUG_CHANGES.limit} times{" "}
					{formatWindow(SLUG_CHANGES.window)} at most.
				</li>
				<li>
					<strong>Image</strong>: a square logo, 128×128 pixels or larger, for your website and the pictures it shows when shared.
				</li>
			</ul>

			<h2 id="sender">Sender</h2>
			<ul>
				<li>
					<strong>From name</strong>: the name in your readers&apos; inbox.
				</li>
				<li>
					<strong>From email</strong>: {sharedDomain ? "the shared address, or " : ""}an address at a domain you added on the{" "}
					<LinkApp href="/domains">Domains page</LinkApp>. <Link href={getHelpHref("sender-addresses")}>Sender addresses and domains</Link>
				</li>
				<li>
					<strong>Reply-to</strong>: where replies go.{sharedDomain && " Left empty, replies to the shared address go to your account's email."}
				</li>
				<li>
					<strong>Postal address</strong>: printed in the footer of every email, as anti-spam laws ask.{" "}
					{isCloud()
						? "Until you set yours, emails print MailCheap's business address. Saved empty, emails wait until you add one."
						: "Saved empty, emails wait until you add one."}
				</li>
			</ul>

			<h2 id="website">Website</h2>
			<p>
				Each newsletter has a public website with a page for each issue and a signup form. It&apos;s on for new newsletters and goes
				live after your first issue. On the <LinkApp href="/newsletters/website">Website page</LinkApp>, you set its description (one
				sentence under the name and in the subscribe popup), your author bio and photo, and your social links.{" "}
				<Link href={getHelpHref("website")}>Website and signups</Link>
			</p>

			<h2 id="confirm-signups">Confirm new signups</h2>
			<p>
				With confirmed opt-in, people who sign up get an email with a button, and only join your list once they click it. Until then
				they&apos;re pending and get nothing else. It&apos;s on for new newsletters, and it keeps typos and fake signups out of your
				list.
			</p>
			<p>
				The built-in confirmation email follows your newsletter&apos;s name and description. On the{" "}
				<LinkApp href="/newsletters/signups">Confirm signups page</LinkApp>, you can write your own subject, preview text and content,
				as long as it keeps the button.
			</p>
			<p>
				New subscribers get the confirmation email or your welcome email, not both. Turning on double opt-in while the welcome email
				is on turns the welcome email off when you save, and the page says so first. From the API or an AI assistant, send both
				changes in the same request.
			</p>
			{isCloud() && (
				<p>
					Confirmation emails count toward your plan&apos;s emails, and still go out once the month&apos;s emails are used up.{" "}
					<Link href={getHelpHref("plans", "emails")}>What counts as an email</Link>
				</p>
			)}

			<h2 id="welcome-email">Welcome email</h2>
			<p>
				An email each new subscriber gets when they join, written in Markdown. Send yourself a test of it from the{" "}
				<LinkApp href="/newsletters/welcome">Welcome email page</LinkApp>.
				While double opt-in is on, new subscribers get the confirmation email instead: turning the welcome email on turns double
				opt-in off when you save, and the page says so first.
			</p>
			{isCloud() && (
				<p>
					Welcome emails count toward your plan&apos;s emails. Once the month&apos;s emails are used up, they pause until your emails
					reset or you upgrade, and people who join meanwhile don&apos;t get one later.
				</p>
			)}

			<h2 id="list-cleanup">List cleanup</h2>
			<p>
				When an issue goes out, contacts who ignored several issues in a row and showed no sign of life for months get one last-chance
				email instead. It&apos;s on for new newsletters, after {cleanup.issues} ignored issues and {cleanup.days} quiet days: on the{" "}
				<LinkApp href="/newsletters/cleanup">List cleanup page</LinkApp>, you can pick {CLEANUP_LIMITS.minIssues} to{" "}
				{CLEANUP_LIMITS.maxIssues} issues and {CLEANUP_LIMITS.minDays} to {CLEANUP_LIMITS.maxDays} days.{" "}
				<Link href={getHelpHref("list-cleanup")}>List cleanup</Link>
			</p>

			<h2 id="form-for-your-site">Form for your site</h2>
			<p>
				A signup form to paste on your own site, off until you turn it on. On <LinkApp href="/newsletters/form">its page</LinkApp>,
				you preview it, set its button and placeholder, copy its code, and list the sites it works on.{" "}
				<Link href={getHelpHref("website", "form-on-your-site")}>A signup form on your own site</Link>
			</p>

			<h2 id="design">Design</h2>
			<p>
				Your newsletter&apos;s theme: the fonts, colors, corners, shadows and spacing of its website and its emails. Pick one on the{" "}
				<LinkApp href="/newsletters/design">Design page</LinkApp>, then change it as you like.{" "}
				<Link href={getHelpHref("design")}>Design and themes</Link>
			</p>
		</ArticleHelp>
	);
}
