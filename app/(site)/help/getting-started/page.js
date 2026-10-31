import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { TRIAL_CONTACTS } from "@/lib/actions/contacts";
import { isGoogleEnabled } from "@/lib/auth";
import { getSharedDomain, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("getting-started");

export default function GettingStartedPage() {
	const sharedDomain = getSharedDomain();

	return (
		<ArticleHelp slug="getting-started">
			<h2 id="sign-in">Sign in</h2>
			<p>
				{isGoogleEnabled() ? "Sign in with Google, or with your email address: " : "Sign in with your email address: "}
				MailCheap emails you a code to type in. Each code works once, for 5 minutes, so there&apos;s no password to remember.
				{!isCloud() && " On this server, only the addresses its admin allowed can sign in."}
				{isCloud() &&
					" Codes only go to addresses that can receive email: a misspelled one like gmail.co gets the right spelling back, and throwaway inboxes can't open an account."}
			</p>

			<h2 id="setup">Set up your newsletter</h2>
			<p>The first time you sign in, MailCheap asks four things:</p>
			<ul>
				<li>Your newsletter&apos;s name.</li>
				<li>What it&apos;s about, in one line, under its name on your signup form and website. You can skip it.</li>
				<li>Who it&apos;s from: the name your readers see in their inbox.</li>
				<li>
					Whether you have subscribers already, and where they are now
					{isCloud() ? ", so MailCheap can suggest the plan that fits one issue a week" : ""}.
				</li>
			</ul>
			<p>
				You can change all of it later in the <Link href={getHelpHref("newsletters")}>newsletter&apos;s settings</Link>.
			</p>

			{isCloud() && (
				<>
					<h2 id="before-a-plan">Before you pick a plan</h2>
					<p>
						Without a plan, you can still set up your newsletter, write and preview drafts, upload pictures, and add up to{" "}
						{TRIAL_CONTACTS.limit} contacts a day by hand. Sending, test emails, imports, your own domain, API keys and AI assistants
						start with a plan. See <Link href={getHelpHref("plans")}>Plans and billing</Link>.
					</p>
				</>
			)}

			<h2 id="first-issue">Send your first issue</h2>
			<p>
				Until they&apos;re done, a list of these steps sits at the bottom right of the <LinkApp href="/">dashboard</LinkApp>, for the
				newsletter that&apos;s open: its issues and subscribers count for it alone, while your domain and AI agent count for all your
				newsletters. Close the list and it stays closed for that newsletter, on every device. Your other newsletters, and the ones you
				add later, keep theirs.
				{isCloud() && (
					<>
						{" "}
						With a plan, that corner then offers an email from MailCheap to reply to, so its next emails reach your inbox.{" "}
						<Link href={getHelpHref("newsletters", "inbox-check")}>Getting MailCheap&apos;s emails in your inbox</Link>
					</>
				)}
			</p>
			<ol>
				<li>
					<strong>Add your subscribers.</strong> On the <LinkApp href="/contacts">Contacts page</LinkApp>, import a CSV file from the
					platform you&apos;re leaving, take signups with a form on your site, or add people with the API or by hand.{" "}
					<Link href={getHelpHref("contacts", "add")}>Adding contacts</Link>
				</li>
				<li>
					<strong>Write your first issue.</strong> Start a draft from the <LinkApp href="/campaigns">Campaigns page</LinkApp>. It
					saves as you type. <Link href={getHelpHref("writing")}>Writing an issue</Link>
				</li>
				<li>
					<strong>Send from your domain{sharedDomain ? ", if you want to" : ""}.</strong>{" "}
					{sharedDomain ? (
						`Until then, each newsletter sends from its shared address, like hello@your-newsletter.${sharedDomain}.`
					) : (
						<>
							Add its DNS records on the <LinkApp href="/domains">Domains page</LinkApp>, then send from an address at it.
						</>
					)}{" "}
					<Link href={getHelpHref("sender-addresses")}>Sender addresses and domains</Link>
				</li>
				<li>
					<strong>Send your first issue.</strong> Open your draft, send yourself a test, then send it now or schedule it.{" "}
					<Link href={getHelpHref("sending")}>Sending and scheduling</Link>
				</li>
				<li>
					<strong>Connect your AI agent, if you use one.</strong> ChatGPT, Claude, Cursor, Codex or Grok Bot can write, test and
					schedule issues for you. <Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
				</li>
			</ol>
			<h2 id="sidebar">The sidebar</h2>
			<p>
				The sidebar lists your newsletter&apos;s pages, then your account&apos;s, like the <LinkApp href="/domains">Domains page</LinkApp>.
				The button next to MailCheap at its top folds it down to its icons, for more room on the page. Folded, it opens over the
				page while your mouse is on it and folds back when you move away. To keep it open, click that button again, or the
				MailCheap logo on a touch screen. Your browser remembers your choice.
			</p>
			<p>
				While you edit a campaign, the sidebar also folds down on its own to leave the issue more room. The next page shows it
				open again, unless you folded it yourself.
			</p>
		</ArticleHelp>
	);
}
