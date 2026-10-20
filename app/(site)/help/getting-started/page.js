import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { TRIAL_CONTACTS } from "@/lib/actions/contacts";
import { isGoogleEnabled } from "@/lib/auth";
import { WARMUP, getSharedDomain, isCloud } from "@/lib/config";
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
				The <LinkApp href="/">overview page</LinkApp> lists these steps until they&apos;re done.
			</p>
			<ol>
				<li>
					<strong>Write your first issue.</strong> Start a draft from the <LinkApp href="/campaigns">Campaigns page</LinkApp>. It
					saves as you type. <Link href={getHelpHref("writing")}>Writing an issue</Link>
				</li>
				<li>
					<strong>Add your subscribers.</strong> Import a CSV file from the platform you&apos;re leaving, or add people one by one on
					the <LinkApp href="/contacts">Contacts page</LinkApp>. <Link href={getHelpHref("importing-contacts")}>Importing contacts</Link>
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
			{isCloud() && (
				<p>
					Your first campaign also starts your account&apos;s {WARMUP.days}-day warm-up, when bigger sends go out over a few hours.{" "}
					<Link href={getHelpHref("warm-up")}>Warm-up and sending pace</Link>
				</p>
			)}
		</ArticleHelp>
	);
}
