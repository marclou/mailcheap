import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import FigureHelp from "@/components/FigureHelp";
import LinkApp from "@/components/LinkApp";
import { isBotIdEnabled } from "@/lib/bot-check";
import { getArchiveCnameTarget, getSharedDomain, isCloud } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { getSignupScale } from "@/lib/plans";
import { SIGNUP_FORM_RATE_LIMITS } from "@/lib/signup-form";

export const metadata = getHelpPageMetadata("website");

export default function WebsitePage() {
	const { perIp, perEmail, perNewsletter, perNewsletterPlain } = SIGNUP_FORM_RATE_LIMITS;
	const hasBotCheck = isBotIdEnabled();
	const sharedDomain = getSharedDomain();
	const hasOwnHost = Boolean(getArchiveCnameTarget());

	return (
		<ArticleHelp slug="website">
			<h2 id="website">Your newsletter&apos;s website</h2>
			<p>
				Each newsletter has a public website: a home page with your issues and a signup form, a page for each issue, and an author
				page with your bio and photo. It&apos;s on for new newsletters and goes live after your first issue.
				{sharedDomain && (
					<>
						{" "}
						It lives at <code>your-newsletter.{sharedDomain}</code>
						{hasOwnHost && (
							<>
								, or on a subdomain of <a href="#own-domain">your own domain</a>
							</>
						)}
						.
					</>
				)}
				{isCloud() && " It stays online while your account has a plan."}
			</p>
			<p>
				Its description, social links, author bio and photo are in the{" "}
				<LinkApp href="/newsletters/website">Website section</LinkApp> of the{" "}
				<Link href={getHelpHref("newsletters", "website")}>newsletter&apos;s settings</Link>, where you can also turn it off. Search
				engines get a sitemap of your issues, and each page has its own picture for when it&apos;s shared.
			</p>
			<p>
				Its fonts, colors and shapes are your newsletter&apos;s theme, the same as in your emails.{" "}
				<Link href={getHelpHref("design")}>Design and themes</Link>
			</p>

			{hasOwnHost && (
				<>
					<h2 id="own-domain">Your own domain</h2>
					<p>
						Your website can live on a subdomain of a domain you own, like <code>news.example.com</code>
						{sharedDomain && (
							<>
								, instead of <code>your-newsletter.{sharedDomain}</code>
							</>
						)}
						. It&apos;s separate from the address you send from: you don&apos;t need to send from that domain.
						{isCloud() && " It needs a plan."}
					</p>
					<p>
						In the <LinkApp href="/newsletters/website">Website section</LinkApp> of the newsletter&apos;s settings, type the subdomain
						under Your own domain and click Add domain. The card then lists the DNS records to add where your domain is managed (your
						registrar or DNS provider):
					</p>
					<ol>
						<li>
							<strong>Points to MailCheap</strong>: a CNAME record that sends your subdomain&apos;s visitors to MailCheap.
						</li>
						<li>
							<strong>Proves it&apos;s yours</strong>: a TXT record only your account gets, so nobody else can claim your subdomain, even
							with the CNAME in place.
						</li>
						{isCloud() && (
							<li>
								<strong>Vercel&apos;s check</strong>: only when your domain is already used with Vercel, where MailCheap runs. It asks for
								one more TXT record.
							</li>
						)}
					</ol>
					<p>
						Copy each host and value with its button. DNS changes can take up to a few hours: click Check now to look again. Once the
						records are found, your website and the tracked and unsubscribe links in your next emails move to your subdomain.
						{sharedDomain && (
							<>
								{" "}
								Your website still opens at <code>your-newsletter.{sharedDomain}</code>
							</>
						)}
						{sharedDomain ? ", and" : " The"} emails you already sent keep their links. If your DNS is on Cloudflare, turn off the
						proxy (the orange cloud) for the CNAME record.
					</p>
					<p>
						Keep the CNAME record: without it, your website and the links in your emails stop working, and the card says so. A newsletter
						has one domain at a time. Removing it puts your website and the links in your next emails back where they were. Links in
						emails you already sent keep working as long as the subdomain points at MailCheap.
					</p>
				</>
			)}

			<h2 id="issue-pages">Issue pages</h2>
			<p>
				Every issue on your website gets a page at <code>/p/</code> followed by its slug, made from the subject. Change the slug in
				the send step&apos;s Web page row before it goes out, or later from the campaign&apos;s page. There you can also pin an issue:
				pinned issues lead the home page, in its Featured row.
			</p>
			<p>
				The send step decides where each issue goes. An email-only issue never gets a page, and a web-only issue goes on the
				website without an email.{" "}
				<Link href={getHelpHref("sending", "where")}>Email, web or both</Link>
			</p>
			<p>
				An issue&apos;s page has its <Link href={getHelpHref("writing", "sections")}>sections</Link> set to show on the web, for every
				visitor, and none set to email only. Your website doesn&apos;t know who&apos;s reading, so a section for some readers stays in
				their emails unless you put it on the web too. Its share picture comes from the page, never from an email-only section.
			</p>

			<h2 id="remove-issue">Removing an issue</h2>
			<p>
				Remove from website, in an issue&apos;s <strong>⋯</strong> menu on the <LinkApp href="/campaigns">Campaigns page</LinkApp>{" "}
				or on its own page, takes it off your website: its page stops working, and it leaves the home page and the sitemap. This
				can&apos;t be undone.
			</p>
			<p>
				An issue you also sent by email stays in your campaigns with its report, as email only, and the Read online link in its
				emails stops working. A web-only issue has nothing left, so it leaves your campaigns too. With no issue left on it, your
				website goes offline until the next one, as before your first.
			</p>

			<h2 id="signups">How people sign up</h2>
			<ul>
				<li>
					<strong>On your website</strong>: the signup form on the home page, and a popup on issue pages that opens once the reader is
					into the issue. Closed, it stays away for two weeks.
				</li>
				<li>
					<strong>On your own site</strong>: paste the form from{" "}
					<LinkApp href="/newsletters/form">Form for your site</LinkApp>, in the newsletter&apos;s settings.{" "}
					<a href="#form-on-your-site">A signup form on your own site</a>
				</li>
				<li>
					<strong>From your own code</strong>: create an API key with the signups only level on the{" "}
					<LinkApp href="/api-keys">API keys page</LinkApp>, then sign people
					up with one request each. A request can tag them too, like <code>blog</code> from your blog&apos;s form, so a{" "}
					<Link href={getHelpHref("contacts", "segments")}>segment</Link> can pick them. That key can only add contacts, so
					it&apos;s safe in your website&apos;s code. See <Link href="/docs/api#add-contact">add a contact</Link> in the API
					reference.
				</li>
				<li>
					<strong>By hand or from a file</strong>: Add contacts, at the top of the{" "}
					<LinkApp href="/contacts">Contacts page</LinkApp>, lists every way to add them.{" "}
					<Link href={getHelpHref("contacts", "add")}>Adding contacts</Link>
				</li>
			</ul>
			<p>
				With <Link href={getHelpHref("newsletters", "confirm-signups")}>confirmed opt-in</Link> on, a new signup gets the confirmation
				email and joins once they click its button. Otherwise they join at once and get your welcome email, if it&apos;s on. Typos like
				gmial.com, spam traps, domains that can&apos;t receive email and addresses known to bounce are refused at the form, with a
				suggestion when the address looks misspelled.{isCloud() && " The form also checks that a real browser sent it."}
			</p>

			<h2 id="form-on-your-site">A signup form on your own site</h2>
			<p>
				Turn on <LinkApp href="/newsletters/form">Form for your site</LinkApp> in the{" "}
				<Link href={getHelpHref("newsletters")}>newsletter&apos;s settings</Link>, save, then copy one of the three tabs under Code to
				paste:
			</p>
			<FigureHelp
				src="/help/website/code-to-paste.webp"
				alt="Code to paste on the AI agent tab: the prompt to copy, which starts by asking the agent to add the newsletter's signup form, next to the Script and HTML tabs."
				caption="The prompt for your AI agent"
			/>
			<ul>
				<li>
					<strong>AI agent</strong>: a prompt for the AI agent that builds your site, like Cursor, Claude Code, Codex or Lovable. It
					tells your agent what MailCheap is and gives it the script and the HTML form, with when each fits, so it picks the one
					that fits your site and adds the form there. Once it&apos;s done, it reminds you of what&apos;s left: turning the form on,
					if it&apos;s off, and listing your site under Where it works.
				</li>
				<li>
					<strong>Script</strong>: the form in your newsletter&apos;s theme. It says what happened without leaving the page, and what
					you change in its settings reaches your site on its own.
				</li>
				<li>
					<strong>HTML</strong>: a plain form that works without JavaScript and takes your site&apos;s font. It lands on a page that
					says what happened, with a link back to your site. Copy it again after you change its text or layout. It&apos;s off while
					your sites are listed.
				</li>
			</ul>
			<p>
				Inline is the email field and its button alone. Card puts them in a box under a headline and a line of text: they start as
				your newsletter&apos;s name and description, and follow them until you write your own. Clear one to hide it. Turn on First
				name to ask for it above the email, so <code>{"{{first_name|there}}"}</code> can greet new readers by it; they can leave it
				empty. <Link href={getHelpHref("writing", "first-name")}>Names and fields in your emails</Link>
			</p>
			<p>Where to paste it:</p>
			<ul>
				<li>
					<strong>WordPress</strong>: a Custom HTML block.
				</li>
				<li>
					<strong>Webflow</strong>: an Embed element.
				</li>
				<li>
					<strong>Framer</strong>: an Embed component with HTML.
				</li>
				<li>
					<strong>Squarespace</strong>: a Code block.
				</li>
				<li>
					<strong>Wix</strong>: Embed code, then Embed HTML.
				</li>
				<li>
					<strong>Ghost</strong>: an HTML card.
				</li>
				<li>
					<strong>Carrd</strong>: an Embed element set to Code.
				</li>
				<li>
					<strong>Any other site</strong>: wherever it lets you add HTML.
				</li>
				<li>
					<strong>React, Next.js, Vue or Svelte</strong>: a script tag in a component doesn&apos;t stay where it sits, so give your
					AI agent the prompt, which says how to add the form there.
				</li>
			</ul>
			<p>
				Signups there follow the newsletter&apos;s confirmed opt-in and welcome email, like your website&apos;s form. In your contacts,
				their source is Form on your site, with the site&apos;s address, so a segment can pick them.
			</p>
			<p>
				So that a script can&apos;t sign up strangers, the form has a field only bots fill in, waits a moment after the page loads
				{hasBotCheck && ", checks that a real browser sent the script form"}, signs up one address each time it loads and takes{" "}
				{perIp.limit} signups per visitor every 10 minutes and {perEmail.limit} per address a day, whichever newsletters ask. Past{" "}
				{formatNumber(perNewsletter.limit * getSignupScale(null))} signups in 10 minutes
				{isCloud() && (
					<>
						{" "}
						on Starter (<Link href={getHelpHref("plans", "signup-limits")}>more on bigger plans</Link>)
					</>
				)}
				, or {perNewsletterPlain.limit} from the HTML form, it refuses new ones until they slow down, and you get an alert. Someone who
				unsubscribed confirms their address before they&apos;re back, even with confirmed opt-in off.
			</p>
			<p>
				List your sites under Where it works and browsers only show the form there. Only the script works then, since a plain form
				can&apos;t prove which site it&apos;s on.{" "}
				{hasBotCheck
					? "The list keeps the form off other sites; the checks above stop scripts."
					: "On this server, nothing checks for a real browser, so the list only keeps the form off other sites' pages: a script can still name one of yours. The limits above still apply, and confirmed opt-in keeps a script's addresses out of your list."}
			</p>

			<h2 id="unsubscribe">Unsubscribing</h2>
			<p>
				Every email has an unsubscribe link in its footer and the one-click unsubscribe Gmail and Yahoo show next to the sender. Either
				one unsubscribes the reader at once: only signing up again, or a resubscribe they ask you for, brings them back.
			</p>
		</ArticleHelp>
	);
}
