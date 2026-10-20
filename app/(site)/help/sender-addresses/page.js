import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { getArchiveCnameTarget, getSharedDomain, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("sender-addresses");

export default function SenderAddressesPage() {
	const sharedDomain = getSharedDomain();
	const hasWebsiteStep = Boolean(getArchiveCnameTarget());

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
						The address follows your newsletter&apos;s slug, so changing the slug changes it. Replies go to your account&apos;s email,
						or to the reply-to address you set in the <LinkApp href="/newsletters/sender">newsletter&apos;s settings</LinkApp>. You can
						keep it as long as you like: the <LinkApp href="/domains">Domains page</LinkApp> shows it as used until you switch.
					</p>
				</>
			)}

			<h2 id="own-domain">Your own domain</h2>
			<p>
				Sending from an address at your own domain{sharedDomain ? " is optional. It" : ""} puts your domain in the From address and
				builds its own reputation with inboxes. On the <LinkApp href="/domains">Domains page</LinkApp>, under Add your domain, type
				the domain and the address&apos;s name before the @
				{hasWebsiteStep && ", plus a subdomain for your website and links, like news for news.yourdomain.com"}.
				{isCloud() && " Adding a domain needs a plan."}
			</p>
			<p>The page then lists the DNS records to add where your domain is managed (your registrar or DNS provider):</p>
			<ol>
				<li>
					<strong>Signature (DKIM)</strong>: proves the emails come from you.
				</li>
				<li>
					<strong>Return path</strong>: bounces come back to a subdomain of yours, so SPF passes for your domain.
				</li>
				{hasWebsiteStep && (
					<li>
						<strong>Website and links</strong>: a CNAME record that puts your website, tracked links and unsubscribe links on your
						subdomain.
					</li>
				)}
				<li>
					<strong>DMARC</strong>: tells inboxes what to do with emails that fail the checks. Gmail and Yahoo require one from bulk
					senders. Start with <code>p=none</code>, then move to <code>p=quarantine</code> once your reports look clean.
				</li>
			</ol>
			<p>
				Copy each host and value with its button. If your DNS provider asks for the full name instead of the host, the page shows it.
				DNS changes can take up to a few hours: click Check to look again, and each record shows when it&apos;s found.
			</p>

			<h2 id="switch">Switching to your domain</h2>
			<p>
				Once the domain is verified, its card on the <LinkApp href="/domains">Domains page</LinkApp> lets you send the open
				newsletter from an address at it. Your next
				emails go out from that address{hasWebsiteStep && ", and your website and links move to your subdomain once its record is found"}
				.
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
