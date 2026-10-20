import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { FIRST_SEND, LIMITS, isCloud } from "@/lib/config";
import { formatNumber, formatPercent } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { COMPARED_ISSUES, TIMELINE_HOURS } from "@/lib/report-stats";

export const metadata = getHelpPageMetadata("sending");

export default function SendingPage() {
	const { pause } = LIMITS;

	return (
		<ArticleHelp slug="sending">
			<h2 id="review">The review step</h2>
			<p>Before a campaign can go out, the review step checks it:</p>
			<ul>
				<li>a subject, and content;</li>
				<li>the unsubscribe link, which MailCheap adds to every issue written in the editor;</li>
				<li>a size under 100 KB, since Gmail cuts off longer emails;</li>
				<li>
					a postal address, set in the <LinkApp href="/newsletters/sender">newsletter&apos;s settings</LinkApp>;
				</li>
				<li>a from address the newsletter is allowed to send from.</li>
			</ul>
			<p>
				It also warns about a subject over 70 characters, which inboxes cut off, a missing preview text and a missing test email.
				Warnings don&apos;t stop you.
				{isCloud() && " Problems with your account, like your plan's limits, show in a banner above the steps."}
			</p>

			<h2 id="who">Who gets it</h2>
			<p>
				By default, every active contact of the newsletter gets the issue, most engaged first: those who open and click the most get
				it before the others. To send to only some of them, pick one of your segments in To, which shows how many contacts it reaches
				out of all of them. New segment makes one without leaving the step, like your most engaged contacts.{" "}
				<Link href={getHelpHref("contacts", "segments")}>Segments</Link>
			</p>
			<p>
				A draft whose segment was deleted waits until you pick another.
				{isCloud() && " A send can't go over what your plan has left this month: pick a smaller segment, or upgrade."}
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
			{isCloud() && (
				<p>
					How fast an issue goes out depends on what your account has proven it can send. During your account&apos;s first 30 days,
					bigger sends go out over a few hours. <Link href={getHelpHref("warm-up")}>Warm-up and sending pace</Link>
				</p>
			)}

			<h2 id="first-send">First sends in steps</h2>
			<p>
				The first time an issue goes to contacts who never got an email from you, usually right after an import, they don&apos;t all
				get it at once. With more than {formatNumber(FIRST_SEND.minSlice)} of them, a slice goes first: {formatPercent(FIRST_SEND.share)}{" "}
				of them, between {formatNumber(FIRST_SEND.minSlice)} and {formatNumber(FIRST_SEND.maxSlice)}. The rest follows{" "}
				{FIRST_SEND.waitMinutes / 60} hours later, once the slice&apos;s bounces and spam complaints are in.
			</p>
			<p>
				If the slice gets more than {formatPercent(pause.bounceRate)} hard bounces (at least {pause.minBounces}) or{" "}
				{formatPercent(pause.complaintRate)} complaints (at least {pause.minComplaints}), the rest waits for you to resume it. Far over those rates, your account is blocked. A list with bad addresses shows itself in
				the slice, before it reaches everyone. Contacts you emailed before go out normally.
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

			<h2 id="send-to-more">Sending to more</h2>
			<p>
				A send capped at a number of contacts, which the API can set, goes to the most engaged first. Send to more on the
				campaign&apos;s page then sends it to the next most engaged contacts who haven&apos;t got it yet. You pick how many, and each
				time starts a new step, so you can check the report in between.
			</p>

			<h2 id="report">The report</h2>
			<p>
				Each sent campaign&apos;s page shows how many emails were delivered, opened and clicked, and how many bounced, were marked as
				spam or led to an unsubscribe, with results by inbox provider, like Gmail or Outlook. It counts the list cleanup&apos;s
				last-chance emails apart. Opens are an estimate: some inboxes load every email&apos;s images on their own, which counts as an
				open, and some readers block images. Preview, at the top, shows the email as it went out, in a mail app or in Gmail on a
				phone.
			</p>
			<p>
				Opened and clicked compare with the newsletter&apos;s last {COMPARED_ISSUES} issues, for example &ldquo;+4.2 pts vs
				avg&rdquo;: all their opens or clicks over all the contacts they reached, so a small send barely counts. The comparison
				shows once a send is {TIMELINE_HOURS / 24} days old, since its opens keep coming until then.
			</p>
			<p>
				A chart shows the opens and clicks hour by hour for the first {TIMELINE_HOURS / 24} days after sending, in your timezone:
				when most opens came, and how fast half of them did. Each contact counts once, at their first open and first click. The
				opens after those {TIMELINE_HOURS / 24} days are counted under the chart.
			</p>
			<p>
				Its links come next, most clicked first: how many contacts clicked each one, every click, and each link&apos;s share of the
				contacts who clicked a link. A link counts once whatever its tracking parameters, like utm_source, and link scanners and the
				unsubscribe link don&apos;t count. An issue sent before clicks were counted per link only has the clicks since then. The
				API and AI assistants get the same numbers, the comparison and the hours included, in the campaign&apos;s report.
			</p>
		</ArticleHelp>
	);
}
