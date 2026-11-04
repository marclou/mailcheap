import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { getArchiveCnameTarget, getSharedDomain, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("sender-addresses");

export default function SenderAddressesPage() {
	const sharedDomain = getSharedDomain();
	const hasOwnHost = Boolean(getArchiveCnameTarget());

	return (
		<ArticleHelp slug="sender-addresses">
			{sharedDomain && (
				<>
					<h2 id="shared-address">The shared address</h2>
					<p>
						Each newsletter can send from an address made from its slug, like <code>hello@your-newsletter.{sharedDomain}</code>, with
						nothing to set up: the records that prove your emails come from you (DKIM, SPF and DMARC) are published for you.
						{isCloud() && " It's set up when your plan starts, in a few minutes."} Your website lives at the same name,{" "}
						<code>your-newsletter.{sharedDomain}</code>.
					</p>
					<p>
						The address follows your newsletter&apos;s slug, so changing the slug changes it. Replies go to the issue&apos;s{" "}
						<Link href={getHelpHref("writing", "author")}>author</Link>, and replies to your newsletter&apos;s own emails to the
						default author you pick on the <LinkApp href="/newsletters/sender">Sender page</LinkApp>. Until you add one, they go to
						your account&apos;s email, or to the reply-to address you set before authors. You can keep the address as long as you like:
						the <LinkApp href="/domains">Domains page</LinkApp> shows it as used until you switch.
					</p>
					<p>
						While a newsletter sends from it, the <LinkApp href="/">overview</LinkApp> and the send step of a campaign show a short
						note with your next step toward your own domain: add one, finish verifying it, or send from it once it&apos;s verified.
						Close the note and it stays closed for that newsletter until the next step comes. It never stops a send.
					</p>
				</>
			)}

			<h2 id="own-domain">Your own domain</h2>
			<p>
				Sending from an address at your own domain{sharedDomain ? " is optional. It" : ""} puts your domain in the From address and
				builds its own reputation with inboxes. On the <LinkApp href="/domains">Domains page</LinkApp>, under Add your domain, type
				the domain and the address&apos;s name before the @.
				{isCloud() && " Adding a domain needs a plan."}
				{hasOwnHost && (
					<>
						{" "}
						Your website goes on your own domain separately, from its settings:{" "}
						<Link href={getHelpHref("website", "own-domain")}>Your own domain</Link>
					</>
				)}
			</p>
			<p>
				A domain can only be in one account. If yours is already taken, the <LinkApp href="/domains">Domains page</LinkApp> says so:
				add a subdomain instead, like <code>mail.example.com</code>, or another domain.
			</p>
			<p>The page then lists the DNS records to add where your domain is managed (your registrar or DNS provider):</p>
			<ol>
				<li>
					<strong>Signature (DKIM)</strong>: proves the emails come from you.
				</li>
				<li>
					<strong>Return path</strong>: bounces come back to a subdomain of yours, so SPF passes for your domain.
				</li>
				<li>
					<strong>DMARC</strong>: tells inboxes what to do with emails that fail the checks. Gmail and Yahoo require one from bulk
					senders. Start with <code>p=none</code>, then move to <code>p=quarantine</code> once your reports look clean. A record on
					the domain you registered covers its subdomains too: for <code>news.example.com</code>, the page says Found on{" "}
					<code>example.com</code>.
				</li>
			</ol>
			<p>
				Copy each host and value with its button. If your DNS provider asks for the full name instead of the host, the page shows it.
				DNS changes can take up to a few hours: click Check now to look again, and each record shows when it&apos;s found. Once
				they&apos;re all found, the records fold under DNS records, so sending from the domain comes first: click it to see
				them again.
			</p>
			<p>
				If your DNS is on Cloudflare, set each record to DNS only, with the grey cloud. Cloudflare turns its proxy on for a new
				CNAME record, with the orange cloud, and the proxy hides where the record points: inboxes can&apos;t check your emails, and
				they land in spam. The Domains page says when a record is behind a proxy.
			</p>

			<h2 id="dns-checks">When a record changes</h2>
			<p>
				Your email provider checks your records to verify the domain, and may not notice when one changes later. So MailCheap also
				looks at them itself: when you click Check now, every day once the domain is verified, and before a test email or a send
				when it hasn&apos;t looked in the last hour.
			</p>
			<p>
				A record that&apos;s gone, that doesn&apos;t match anymore or that&apos;s behind a proxy stops the domain from sending, since
				its emails would fail the checks and land in spam. The <LinkApp href="/domains">Domains page</LinkApp> shows which record
				and how to fix it, a test email from it says the same, a campaign sending from it pauses, and you get an email. Fix the
				record, click Check now, and resume the campaign from its page.
			</p>

			<h2 id="switch">Switching to your domain</h2>
			<p>
				Once the domain is verified, its card on the <LinkApp href="/domains">Domains page</LinkApp> lets you send the open
				newsletter from an address at it. Your next emails go out from that address.
			</p>
			<p>
				You can also switch from the newsletter&apos;s <LinkApp href="/newsletters/sender">sender settings</LinkApp>: pick the
				domain in the From email field and save. Once a domain is verified, the Domains page shows each newsletter that still
				sends from the shared address, with an Edit sender button: like the note on the overview, it opens those settings with
				the domain already picked. Each domain&apos;s card lists the newsletters that send from it, with a link to their sender
				settings.
			</p>
			<p>
				Once a domain is verified, the Domains page also links to Google Postmaster Tools, where you can see how Gmail rates your
				domain.
			</p>

			<h2 id="remove">Removing a domain</h2>
			<p>
				Removing a domain stops newsletters on it from sending until they move to another address. It&apos;s refused while a campaign
				from it is sending, paused or scheduled. Adding the domain again later needs new DNS records.
			</p>
			<p>
				Bounces, complaints and how they affect your sending are covered in{" "}
				<Link href={getHelpHref("deliverability")}>Bounces, complaints and pauses</Link>.
			</p>
		</ArticleHelp>
	);
}
