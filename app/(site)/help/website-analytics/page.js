import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import FigureHelp from "@/components/FigureHelp";
import LinkApp from "@/components/LinkApp";
import LogoAnalyticsTool from "@/components/LogoAnalyticsTool";
import { getArchiveCnameTarget, getSharedDomain } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("website-analytics");

export default function WebsiteAnalyticsPage() {
	const sharedDomain = getSharedDomain();
	const hasOwnHost = Boolean(getArchiveCnameTarget());
	const ownDomain = <Link href={getHelpHref("website", "own-domain")}>your own domain</Link>;

	return (
		<ArticleHelp slug="website-analytics">
			<h2 id="add">Add a tool</h2>
			<p>
				Your newsletter&apos;s <Link href={getHelpHref("website")}>website</Link> can load Google Analytics, Google Tag Manager and
				the Meta pixel, so you see its visitors, where they come from and who subscribes in the tools you already use. MailCheap
				adds each tool&apos;s code to your website: all it needs is the tool&apos;s ID.
				{hasOwnHost && (
					<>
						{" "}
						Any other tool, like Clicky or Plausible, goes in as <a href="#custom-code">custom code</a>, on {ownDomain}.
					</>
				)}
			</p>
			<ol>
				<li>
					Open the <LinkApp href="/newsletters/website">Website page</LinkApp> of your newsletter&apos;s settings, down to its
					Analytics card.
				</li>
				<li>
					Paste the tool&apos;s ID in its field: the sections below say where each tool shows it. The code a tool asks you to paste
					on your site works too: the field keeps the ID in it.
				</li>
				<li>Click Save. Your website&apos;s pages load the tool from then on.</li>
			</ol>
			<FigureHelp
				src="/help/website-analytics/analytics-card.webp"
				alt="The Analytics card on the Website page, with a Google Analytics measurement ID, a Tag Manager container ID and a Meta pixel ID, each above where to find it, and Clicky's script under Custom code."
				caption="The Analytics card"
			/>
			<p>
				Each tool loads on every page of your website: its home page, each issue&apos;s page and your author page. Not in your
				emails, whose opens and clicks are in each campaign&apos;s report, nor on the unsubscribe and confirmation pages your emails
				link to. To remove a tool, clear its field and save.
			</p>
			<p>
				Moving from Substack or beehiiv? Paste the IDs you had there, and your reports go on in the same Google Analytics property,
				Tag Manager container and pixel.
			</p>

			<h2 id="google-analytics">Google Analytics</h2>
			<ol>
				<li>
					In{" "}
					<LinkTool tool="googleAnalytics" href="https://analytics.google.com">
						Google Analytics
					</LinkTool>
					, open Admin, the gear at the bottom left, then Data
					streams, under Data collection and modification.
				</li>
				<li>
					On the Web tab, click your website&apos;s stream. No stream yet? Click Add stream, then Web, and enter your website&apos;s
					address
					{sharedDomain && (
						<>
							, like <code>your-newsletter.{sharedDomain}</code>
						</>
					)}
					.
				</li>
				<li>
					Copy the measurement ID, in the first row of the stream&apos;s details. It starts with <code>G-</code>, like{" "}
					<code>G-PSW1MY7HB4</code>.
				</li>
				<li>
					Paste it under Google Analytics on the <LinkApp href="/newsletters/website">Website page</LinkApp>, and save.
				</li>
			</ol>
			<p>
				To check, open your website in a new tab, then Reports and Realtime in Google Analytics: your visit shows within a minute. An
				ID that starts with <code>UA-</code> is from Universal Analytics, which no longer collects data: use your GA4 stream&apos;s.
			</p>
			<p>
				Each signup on your website sends a <code>sign_up</code> event. To count signups as conversions, open Admin, then Key events
				under Data display, click New key event and name it <code>sign_up</code>. Keep the stream&apos;s Enhanced measurement on, as
				it is unless you turned it off: it counts each page a reader opens after the first.
			</p>
			{hasOwnHost && (
				<p>
					On {ownDomain}, give your website the same measurement ID as your main site when it&apos;s one of its subdomains: a reader
					who goes from one to the other counts as one visitor.
				</p>
			)}

			<h2 id="tag-manager">Google Tag Manager</h2>
			<p>Tag Manager loads the tags you set up in your container, like Google Analytics or Google Ads conversions.</p>
			<ol>
				<li>
					In{" "}
					<LinkTool tool="googleTagManager" href="https://tagmanager.google.com">
						Tag Manager
					</LinkTool>
					, open your container. Its ID, which starts with{" "}
					<code>GTM-</code>, is at the top of the Workspace tab.
				</li>
				<li>
					Paste it under Tag Manager on the <LinkApp href="/newsletters/website">Website page</LinkApp>, and save.
				</li>
				<li>In Tag Manager, add your tags and their triggers, then click Submit and Publish: none of them run until you publish.</li>
			</ol>
			<p>
				Each signup on your website adds a <code>sign_up</code> event to the data layer. To fire a tag on it, give the tag a Custom
				Event trigger with <code>sign_up</code> as its event name.
			</p>
			<p>
				To check, click Preview in Tag Manager, enter your website&apos;s address and click Connect: Tag Assistant lists the tags
				that fire on each page.
			</p>
			<p>
				Sending Google Analytics or the Meta pixel from Tag Manager? Leave its own field empty on the Website page, or each visit
				counts twice.
			</p>
			{sharedDomain && (
				<p>
					On <code>your-newsletter.{sharedDomain}</code>, Tag Manager runs Google&apos;s own tags, like Google Analytics and Google
					Ads, since other newsletters&apos; websites share that domain. Custom HTML, custom templates and other companies&apos;
					tags don&apos;t run there, nor variables that read cookies or JavaScript.
					{hasOwnHost && (
						<>
							{" "}
							On {ownDomain}, every tag in your container runs, Custom HTML included, and so does your{" "}
							<a href="#custom-code">custom code</a>.
						</>
					)}
				</p>
			)}

			<h2 id="meta-pixel">Meta pixel</h2>
			<ol>
				<li>
					In{" "}
					<LinkTool tool="metaPixel" href="https://business.facebook.com/events_manager2">
						Meta Events Manager
					</LinkTool>
					, click Data sources in the left menu.
				</li>
				<li>Pick your pixel. Its ID, 15 or 16 digits, is under its name, and in its Settings as the dataset ID.</li>
				<li>
					Paste it under Meta pixel on the <LinkApp href="/newsletters/website">Website page</LinkApp>, and save.
				</li>
			</ol>
			<p>
				The pixel sends a <code>PageView</code> on every page and a <code>CompleteRegistration</code> for each signup on your
				website. Pick it as your ads&apos; conversion event to see which ads bring you subscribers.
			</p>
			<p>
				To check, open your pixel&apos;s Test events tab in Events Manager, enter your website&apos;s address and click Open website:
				your visit shows while that tab stays open.
			</p>

			{hasOwnHost && (
				<>
					<h2 id="custom-code">Custom code</h2>
					<p>
						Another tool, like Clicky, Plausible or a chat widget, or a script of your own, goes in Custom code, on your website on{" "}
						{ownDomain}:
					</p>
					<ol>
						<li>Put your website on {ownDomain}.</li>
						<li>
							Paste the code the tool gives you under Custom code, at the bottom of the Analytics card on the{" "}
							<LinkApp href="/newsletters/website">Website page</LinkApp>. Several tools&apos; code can go one after the other.
						</li>
						<li>Click Save.</li>
					</ol>
					<p>
						It goes in the head of every page of your website, where tools ask for their code, and runs in order as each page opens.
						Code a tool says to put in the body works there too.
						{sharedDomain && (
							<>
								{" "}
								It never runs on <code>your-newsletter.{sharedDomain}</code>, since other newsletters&apos; websites share that
								address.
							</>
						)}
					</p>
					<p>
						Custom code takes <code>{"<script>"}</code>, <code>{"<style>"}</code>, <code>{"<link>"}</code> and{" "}
						<code>{"<noscript>"}</code> tags, with addresses that start with <code>https://</code>. MailCheap checks it as you type
						and when you save, and names the line to fix, like a tag that isn&apos;t closed, text outside a tag or a JavaScript
						error. A few things go elsewhere:
					</p>
					<ul>
						<li>Google Analytics, Tag Manager and Meta pixel code goes in their own fields, above it, which also send each signup.</li>
						<li>
							Meta tags, like a tool&apos;s verification tag, are read before custom code runs. To verify your domain, add the DNS
							record the tool offers instead.
						</li>
						<li>
							Code in an attribute like <code>onload</code>, or that writes into the page with <code>document.write</code>,
							doesn&apos;t run on your website. Put it in a <code>{"<script>"}</code> tag, or use the tool&apos;s async code.
						</li>
					</ul>
					<p>Custom HTML tags in Tag Manager work too, on your own domain.</p>
				</>
			)}

			<h2 id="signups">What each signup sends</h2>
			<table>
				<thead>
					<tr>
						<th>Tool</th>
						<th>Event</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Google Analytics</td>
						<td>
							<code>sign_up</code>
						</td>
					</tr>
					<tr>
						<td>Tag Manager</td>
						<td>
							<code>sign_up</code>, in the data layer
						</td>
					</tr>
					<tr>
						<td>Meta pixel</td>
						<td>
							<code>CompleteRegistration</code>
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				It goes out when someone subscribes with your website&apos;s form or its popup. With{" "}
				<Link href={getHelpHref("newsletters", "confirm-signups")}>confirmed opt-in</Link> on, that&apos;s when they fill in the
				form, before they click the link in their email. MailCheap sends the event alone, without their email address. The{" "}
				<Link href={getHelpHref("website", "form-on-your-site")}>form on your own site</Link> doesn&apos;t send it.
			</p>

			<h2 id="cookies">Cookies and consent</h2>
			<p>
				Google Analytics, the tags in your container, the Meta pixel and many tools you add as custom code set cookies in your
				visitors&apos; browsers. Where your readers live, like in the EU or the UK, the law can ask you to tell them and get their
				consent first. Name these tools in your privacy policy, and check what applies to your readers.
			</p>
		</ArticleHelp>
	);
}

// A tool's own website, with its logo.
function LinkTool({ tool, href, children }) {
	return (
		<a href={href} target="_blank" rel="noopener" className="whitespace-nowrap">
			<LogoAnalyticsTool tool={tool} className="mr-1 inline-block size-[1em] align-[-0.12em]" />
			{children}
		</a>
	);
}
