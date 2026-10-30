import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import FigureHelp from "@/components/FigureHelp";
import LinkApp from "@/components/LinkApp";
import { FIRST_SEND, LIMITS, isCloud } from "@/lib/config";
import { CLASSIFIER_CHECKS } from "@/lib/content-review-codes";
import { getFirstSendSteps } from "@/lib/first-send";
import { formatCount, formatNumber, formatPercent } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { COMPARED_ISSUES, TIMELINE_HOURS } from "@/lib/report-stats";

export const metadata = getHelpPageMetadata("sending");

// A list imported from another platform, for the steps' example.
const EXAMPLE_LIST = 9_335;

export default function SendingPage() {
	const { pause } = LIMITS;
	const [firstStep, secondStep] = FIRST_SEND.steps;
	const exampleSteps = getFirstSendSteps(EXAMPLE_LIST);

	return (
		<ArticleHelp slug="sending">
			<h2 id="review">The review step</h2>
			<p>Before a campaign can go out, the review step checks it:</p>
			<ul>
				<li>a subject, and content, with each button&apos;s text and link;</li>
				<li>
					readers for each <Link href={getHelpHref("writing", "sections")}>section</Link>: one whose segment was deleted waits until
					you pick who sees it;
				</li>
				<li>the unsubscribe link, which MailCheap adds to every issue written in the editor;</li>
				<li>a size under 100 KB, since Gmail cuts off longer emails;</li>
				<li>
					a postal address, set in the <LinkApp href="/newsletters/sender">newsletter&apos;s settings</LinkApp>;
				</li>
				<li>
					a from address the newsletter is allowed to send from, at a domain whose DNS records are all in place.{" "}
					<Link href={getHelpHref("sender-addresses", "dns-checks")}>When a record changes</Link>
				</li>
			</ul>
			<FigureHelp
				src="/help/sending/review.webp"
				alt="The review step's checklist, every check passed, then sending a test email and the preview."
				caption="The review step"
			/>
			<p>
				It also warns about a subject over 70 characters, which inboxes cut off, a missing preview text and a missing test email,
				and about what may look broken to your readers:
			</p>
			<ul>
				<li>
					a <Link href={getHelpHref("writing", "first-name")}>merge tag</Link> MailCheap doesn&apos;t fill in, like one from another
					platform, which goes out as written;
				</li>
				<li>
					a <Link href={getHelpHref("writing", "first-name")}>name or field</Link> without a fallback after its bar, which leaves a gap
					for readers without a value;
				</li>
				<li>
					a link with no address, one that isn&apos;t a working address or needs the full one, starting with https://, one to a
					placeholder like example.com or to your own computer, and one whose text shows a website it doesn&apos;t open, which spam
					filters distrust;
				</li>
				<li>
					an <Link href={getHelpHref("writing", "html")}>HTML block</Link> whose tags don&apos;t match up, like one never closed,
					which can take in the rest of the issue, or with parts emails remove, like a style sheet;
				</li>
				<li>text left from a template, like Lorem ipsum, TODO or [insert link];</li>
				<li>HTML or Markdown pasted as text, like **bold**, which readers would see as it is.</li>
			</ul>
			<p>
				Edit content takes you to each one in the issue, lit for a moment, where a{" "}
				<Link href={getHelpHref("writing", "problems")}>dot beside it</Link> says what&apos;s wrong. Warnings don&apos;t stop you.
				An issue with sections lists them under the checklist, each with who sees it, where, and how many of the readers it goes
				to get it in their email. The size check counts the biggest email, with every section in.
				{isCloud() &&
					" Problems with your account show in red above the steps: your plan's limits, and on the send step a send bigger than what your plan has left this month."}{" "}
				A web-only issue sends no email, so it only needs a subject, content and the website on.
			</p>

			{isCloud() && (
				<>
					<h2 id="tips">Tips for more opens</h2>
					<p>
						Some habits tend to send email to spam: a subject in capital letters, a row of exclamation marks, phrases like
						&ldquo;100% free&rdquo; or &ldquo;act now&rdquo;, a subject starting with Re: when it isn&apos;t a reply, or a link
						shortener like bit.ly. When you send or schedule an issue that has one, MailCheap shows you the tips first: the words
						they&apos;re about, highlighted, what to change, and a button to edit them. Change them, or send or schedule it as it
						is. Most issues get none and go straight out. A web-only issue goes to no inbox, so it gets none either.
					</p>
					<p>
						Tips come from the <Link href={getHelpHref("sending", "content-check")}>content check</Link>, which reads each version
						of an issue once, as you send or schedule it: a scheduled issue you didn&apos;t change isn&apos;t read again when it
						goes out. Until you change the issue, the review step shows its tips under the checklist too.
					</p>
				</>
			)}

			<h2 id="where">Email, web or both</h2>
			<p>
				The send step starts with where the issue goes. Email and web, the default, sends it to your contacts and puts it on your
				newsletter&apos;s <LinkApp href="/newsletters/website">website</LinkApp>. Email only sends it but keeps it off the website: it
				never shows there, in its sitemap or in search engines, and its emails have no Read online link. Web only puts it on the
				website without sending any email, so it uses none of your plan&apos;s emails, and its button says Publish now.
			</p>
			<FigureHelp
				src="/help/sending/where.webp"
				alt="The send step's Where it goes card, with Email and web, Email only and Web only."
				caption="Email, web or both"
			/>
			<p>
				Web only needs the website on. A web-only issue can be scheduled like any other
				{isCloud() ? ", and the content check reads it before it goes live" : ""}. Its page counts views instead of opens and clicks.
			</p>

			<h2 id="who">Who gets it</h2>
			<p>
				By default, every active contact of the newsletter gets the issue, most engaged first: those who open and click the most get
				it before the others. To send to only some of them, pick one of your segments in To, which shows how many contacts it reaches
				out of all of them. New segment makes one without leaving the step, like your most engaged contacts.{" "}
				<Link href={getHelpHref("contacts", "segments")}>Segments</Link>
			</p>
			<FigureHelp
				src="/help/sending/who.webp"
				alt="The send step's To menu, with everyone and two segments to pick from."
				caption="Picking who gets it"
			/>
			<p>
				A draft whose segment was deleted waits until you pick another.
				{isCloud() && " A send can't go over what your plan has left this month: pick a smaller segment, or upgrade."} Who gets
				the issue is one thing; who sees a part of it is a{" "}
				<Link href={getHelpHref("writing", "sections")}>section</Link>&apos;s, which never changes who gets it.
			</p>
			<p>
				The same step shows the issue&apos;s web page address, which you can change, and what the{" "}
				<Link href={getHelpHref("list-cleanup")}>list cleanup</Link> will do at this send.
			</p>

			<h2 id="when">Send now or schedule</h2>
			<p>
				Send now asks you to confirm, then the issue starts going out. Schedule opens a calendar, with today marked, and times every 15
				minutes. Once you&apos;ve sent an issue before, it tells you when a time matches your last one. A scheduled issue goes out by
				itself, up to a year ahead; the checks and{isCloud() ? " your plan's limits" : " limits"} run when you schedule it and again
				when it goes out. Unschedule turns it back into a draft.
			</p>
			<FigureHelp
				src="/help/sending/schedule.webp"
				alt="The send step's calendar and times under Schedule, starting at the time of the last issue."
				caption="Scheduling an issue"
			/>
			{isCloud() && (
				<p>
					Most issues go out at once. From a new domain, Gmail&apos;s readers can get the issue the next day.{" "}
					<Link href={getHelpHref("warm-up")}>Sending pace</Link>
				</p>
			)}

			<h2 id="first-send">First sends in steps</h2>
			<p>
				The first time an issue goes to contacts who never got an email from you, usually right after an import, it goes to them in
				steps. With more than {formatNumber(firstStep.min)} of them:
			</p>
			<ol>
				<li>
					<strong>{formatPercent(firstStep.share)} of them go first</strong>, between {formatNumber(firstStep.min)} and{" "}
					{formatNumber(firstStep.max)}, picked at random.
				</li>
				<li>
					<strong>{formatPercent(secondStep.share)} more go {formatCount(FIRST_SEND.waitMinutes, "minute")} later</strong>, between{" "}
					{formatNumber(secondStep.min)} and {formatNumber(secondStep.max)}, if the first ones&apos; bounces and spam complaints are
					low.
				</li>
				<li>
					<strong>The rest go {formatCount(FIRST_SEND.waitMinutes, "minute")} after that</strong>, if they still are.
				</li>
			</ol>
			<p>
				It&apos;s for your deliverability: inboxes like Gmail put more of your emails in spam when many of them bounce or get marked as
				spam. Sending to a small part first checks that the addresses work and the readers want your emails, and most bounces come
				back within minutes. A list with bad addresses, or people who didn&apos;t expect your emails, shows itself after a few
				hundred emails, before it reaches everyone. For {formatNumber(EXAMPLE_LIST)} new contacts, that&apos;s{" "}
				{exampleSteps.map(formatNumber).join(", then ")}, about an hour from the first email to the last step.
			</p>
			<p>
				It&apos;s only the first time: once contacts got an issue from you, your next ones go to them at once. Contacts you emailed
				before go out with the first step. The send step shows the steps, with their numbers, and the campaign&apos;s page shows
				which one is going out.
			</p>
			<p>
				If the new contacts so far get more than {formatPercent(pause.bounceRate)} hard bounces (at least {pause.minBounces}) or{" "}
				{formatPercent(pause.complaintRate)} complaints (at least {pause.minComplaints}), the rest waits for you to resume it. Far
				over those rates, your account is blocked.
			</p>

			<h2 id="pause">Pausing a send</h2>
			<p>
				Emails can&apos;t be recalled once they go out. While an issue is still going out, Pause on its page stops the rest: what&apos;s
				sent stays sent. Resume sends the rest, after checking your account again.
			</p>
			<p>
				MailCheap pauses a send by itself when too many of its emails bounce or get marked as spam.{" "}
				<Link href={getHelpHref("deliverability", "pauses")}>Bounces, complaints and pauses</Link>
			</p>

			{isCloud() && (
				<>
					<h2 id="content-check">The content check</h2>
					<p>
						Before an issue goes out, an automated check reads its subject and content for phishing, malware, scams and explicit
						content: as you send or schedule it, and again as it goes out if it changed since. It never reads your contacts.
						Almost every issue goes straight out.
					</p>
					<p>
						When an issue looks clearly harmful, its send waits and its page says In review: a person at MailCheap looks at it,
						usually within a few hours, then sends it as you wrote it or tells you why it can&apos;t go out. The bell in the
						dashboard tells you when it&apos;s in review and when it&apos;s on its way.{" "}
						<Link href="/acceptable-use">Acceptable use policy</Link>
					</p>
					<p>
						The same happens when an issue&apos;s text speaks to the check itself, and to new content past{" "}
						{formatNumber(CLASSIFIER_CHECKS.limit)} checks an hour from one account. An issue whose content was already checked
						still goes straight out.
					</p>
					<p>
						The check also reads your own welcome and confirmation emails when you save them. If one looks clearly harmful, the{" "}
						<LinkApp href="/newsletters/welcome">Welcome email</LinkApp> or <LinkApp href="/newsletters/signups">Confirm signups</LinkApp>{" "}
						page says In review until a person at MailCheap looks at it. Meanwhile, new subscribers get the built-in confirmation
						email, or no welcome email. If it can&apos;t go out, you get an email saying why, and changing it has it checked again.
					</p>
				</>
			)}

			<h2 id="send-to-more">Sending to more</h2>
			<p>
				A send capped at a number of contacts, which the API can set, goes to the most engaged first. Send to more on the
				campaign&apos;s page then sends it to the next most engaged contacts who haven&apos;t got it yet. You pick how many, and each
				time starts a new step, so you can check the report in between.
			</p>

			<h2 id="report">The report</h2>
			<p>
				Each sent campaign&apos;s page shows at the top how many emails were delivered, opened and clicked, and how many bounced or
				led to an unsubscribe. It counts the list cleanup&apos;s last-chance emails apart. Bounced only counts hard bounces, like an
				address that doesn&apos;t exist: an email still on its way, or that an inbox refused for another reason, like a full
				mailbox, shows under Delivered as not delivered. Opens are an estimate: some inboxes, like Gmail, load an email&apos;s
				images as it arrives, which counts as an open within seconds whether or not it&apos;s read, and some readers block images.
			</p>
			<p>
				Under those numbers, tabs break the send down: Timeline, its opens and clicks hour by hour; Links, what readers clicked,
				with the click map; Recipients, who it went to and what each did; Inboxes, its results by inbox provider, like Gmail or
				Outlook, where you also see how many were marked as spam; and Website, for an issue on your website, its page&apos;s views
				and its address, which you can change there.
			</p>
			<FigureHelp
				src="/help/sending/report.webp"
				alt="A sent issue's report: delivered, opened and clicked with their difference from the average, then opens and clicks hour by hour."
				caption="A sent issue's report"
			/>
			<p>
				Preview, in the <strong>⋯</strong> menu at the top of the page, shows the email as it went out, in a mail app or in Gmail
				on a phone, as a sample reader or as one of your contacts.
			</p>
			<p>
				Opened and clicked compare with the newsletter&apos;s last {COMPARED_ISSUES} issues: &ldquo;+4.2% vs avg&rdquo; when an
				issue opened at 46.2% and they averaged 42%. Their average is all their opens or clicks over all the contacts they
				reached, so a small send barely counts. The comparison shows once a send is {TIMELINE_HOURS / 24} days old, since its
				opens keep coming until then.
			</p>
			<p>
				Timeline shows the opens and clicks hour by hour for the first {TIMELINE_HOURS / 24} days after sending, in your timezone:
				when most opens came, and how fast half of them did. Each contact counts once, at their first open and first click. The
				opens after those {TIMELINE_HOURS / 24} days are counted under the chart.
			</p>
			<p>
				Links lists the links readers clicked, each with its website&apos;s icon, most clicked first: how many contacts clicked
				each one, every click, and each link&apos;s share of the contacts who clicked a link. A link counts once
				whatever its tracking parameters, like utm_source, and link scanners and the unsubscribe link don&apos;t count. An issue
				sent before clicks were counted per link only has the clicks since then. The API and AI assistants get the same numbers,
				the comparison and the hours included, in the campaign&apos;s report.
			</p>
			<p>
				Click map, in Links, shows the email as it went out, in a mail app or in Gmail on a phone, as a sample reader or as one
				of your contacts, with those clicks on it, so you see where in the issue people clicked: by each link that got some, how
				many contacts clicked it and its share. Point at one to outline its link. A link the email has twice shows its clicks on
				both, counted together. Clicks, at its top, hides them.
			</p>
			<FigureHelp
				src="/help/sending/click-map.webp"
				alt="An issue in the click map, with how many contacts clicked each link and its share next to it."
				caption="The click map"
			/>
			<p>
				A web-only issue&apos;s page shows its views on the website instead, once per reader a day, and when it went live. Web-only
				issues don&apos;t count in the comparison with your last issues.
			</p>

			<h2 id="recipients">Who opened and clicked</h2>
			<p>
				Recipients lists everyone an issue went to and what each did with it: when it reached them, when they
				first opened and clicked it, the links they clicked, and whether it bounced, they marked it as spam or they unsubscribed
				through it. Pick Opened, Clicked or Didn&apos;t open to see only them, and Not delivered, Bounced or Unsubscribed once
				someone is there. People come in the order they joined your list, and each one opens their contact&apos;s page. An
				unsubscribe counts for the latest issue they got, and a contact you deleted shows without their address.
			</p>
			<FigureHelp
				src="/help/sending/recipients.webp"
				alt="A sent issue's recipients under filters with their counts, each with what they did, when, and the links they clicked."
				caption="Who opened and clicked"
			/>
			<p>
				Opens there are an estimate too: Gmail and some other inboxes load an email&apos;s images as it arrives, so an open within
				seconds of it reaching them can be their inbox rather than them. Link scanners&apos; visits don&apos;t count as clicks. The API
				and AI assistants list recipients the same way.
			</p>
		</ArticleHelp>
	);
}
