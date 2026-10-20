import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { getArchiveCnameTarget, getSharedDomain, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { SIGNUP_FORM_RATE_LIMITS } from "@/lib/signup-form";

export const metadata = getHelpPageMetadata("website");

export default function WebsitePage() {
	const { perIp, perEmail, perNewsletter, perNewsletterPlain } = SIGNUP_FORM_RATE_LIMITS;
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
								, or on a subdomain of your own domain once you add it on the <LinkApp href="/domains">Domains page</LinkApp>
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

			<h2 id="issue-pages">Issue pages</h2>
			<p>
				Every issue you send gets a page at <code>/p/</code> followed by its slug, made from the subject. Change the slug in the
				send step&apos;s Web page row before it goes out, or later from the campaign&apos;s page. There you can also pin an issue: pinned
				issues lead the home page, in its Featured row.
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
					up with one request each. That key can only add contacts, so it&apos;s safe in your website&apos;s code. See{" "}
					<Link href="/docs/api#add-contact">add a contact</Link> in the API reference.
				</li>
				<li>
					<strong>By hand or from a file</strong>: on the <LinkApp href="/contacts">Contacts page</LinkApp>.{" "}
					<Link href={getHelpHref("contacts")}>Contacts</Link>
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
				<Link href={getHelpHref("newsletters")}>newsletter&apos;s settings</Link>, save, then copy one of its two codes to the spot
				on your site where the form goes:
			</p>
			<ul>
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
				name to ask for it above the email, so <code>{"{{first_name}}"}</code> can greet new readers; they can leave it empty.
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
			</ul>
			<p>
				Signups there follow the newsletter&apos;s confirmed opt-in and welcome email, like your website&apos;s form. In your contacts,
				their source is Form on your site, with the site&apos;s address, so a segment can pick them.
			</p>
			<p>
				So that a script can&apos;t sign up strangers, the form has a field only bots fill in, waits a moment after the page loads
				{isCloud() && ", checks that a real browser sent the script form"} and takes {perIp.limit} signups per visitor every 10
				minutes and {perEmail.limit} per address a day, whichever newsletters ask. Past {perNewsletter.limit} signups in 10 minutes,
				or {perNewsletterPlain.limit} from the HTML form, it refuses new ones until they slow down, and you get an alert. Someone who
				unsubscribed confirms their address before they&apos;re back, even with confirmed opt-in off.
			</p>
			<p>
				List your sites under Where it works and browsers only show the form there. Only the script works then, since a plain form
				can&apos;t prove which site it&apos;s on. The list keeps the form off other sites; the checks above stop scripts.
			</p>

			<h2 id="unsubscribe">Unsubscribing</h2>
			<p>
				Every email has an unsubscribe link in its footer and the one-click unsubscribe Gmail and Yahoo show next to the sender. Either
				one unsubscribes the reader at once: only signing up again, or a resubscribe they ask you for, brings them back.
			</p>
		</ArticleHelp>
	);
}
