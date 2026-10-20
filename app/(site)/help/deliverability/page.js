import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import { LIMITS, isCloud } from "@/lib/config";
import { formatPercent } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { ACCOUNT_CHECK_DAYS } from "@/lib/sending-rules";

export const metadata = getHelpPageMetadata("deliverability");

export default function DeliverabilityPage() {
	const { pause, block } = LIMITS;

	return (
		<ArticleHelp slug="deliverability">
			<h2 id="bounces">Bounces</h2>
			<p>
				A hard bounce means the address doesn&apos;t exist or can&apos;t receive email. The contact becomes bounced and never gets
				another email, and MailCheap remembers the address for every sender for 180 days. A soft bounce, like a full mailbox, is
				temporary and changes nothing.
			</p>

			<h2 id="complaints">Spam complaints</h2>
			<p>
				When a reader marks your email as spam, most inboxes report it: the contact becomes complained and never gets another email.
				Gmail only reports a spam rate for each sending domain, without naming anyone. Inboxes count complaints against you: Google asks
				senders to stay under 0.1% and never reach 0.3%.
			</p>

			<h2 id="pauses">When a send pauses</h2>
			<p>
				A campaign pauses by itself when more than {formatPercent(pause.bounceRate)} of its emails hard bounce (at least{" "}
				{pause.minBounces}) or more than {formatPercent(pause.complaintRate)} are marked as spam (at least {pause.minComplaints}), and
				you get an email about it. Emails already sent stay sent. Look at the campaign&apos;s report: if you know why, resume it from
				its page to send the rest. Once resumed, only the block level below stops it again.
			</p>
			<p>
				The first slice of a send to contacts you never emailed follows the same rule before the rest goes out.{" "}
				<Link href={getHelpHref("sending", "first-send")}>First sends in steps</Link>
			</p>

			<h2 id="blocks">When an account is blocked</h2>
			<p>
				Past {formatPercent(block.bounceRate)} hard bounces (at least {block.minBounces}) or {formatPercent(block.complaintRate)}{" "}
				complaints (at least {block.minComplaints}), the whole account is blocked. So is an account whose email reaches a spam trap,
				an address that exists only on bought, scraped or old lists. MailCheap also adds up each account&apos;s sends of the last{" "}
				{ACCOUNT_CHECK_DAYS} days, so sends that each stay just under the levels add up too
				{isCloud() && ", as does a high spam rate reported by Gmail"}.
			</p>
			<p>
				A blocked account stops everything: every newsletter&apos;s sends, welcome and confirmation emails, imports, new contacts and
				its tracked links. You can still pause, unschedule and change billing.{" "}
				{isCloud()
					? "Chat with us from the dashboard's banner: we review it and unblock it when it's safe."
					: "An admin of this server unblocks it from the admin page."}
			</p>

			<h2 id="tips">Keeping bounces and complaints low</h2>
			<ul>
				<li>Only email people who signed up for your newsletter, and never a bought or scraped list.</li>
				<li>
					Keep <Link href={getHelpHref("newsletters", "confirm-signups")}>confirmed opt-in</Link> on, so typos and fake signups never
					join.
				</li>
				<li>
					Keep <Link href={getHelpHref("list-cleanup")}>list cleanup</Link> on, so readers who stopped opening stop getting issues.
				</li>
				<li>Before importing an old list, import it as dormant and mark the readers you know as active.</li>
				<li>
					Send from your own domain with a DMARC record. <Link href={getHelpHref("sender-addresses")}>Sender addresses and domains</Link>
				</li>
				<li>Send regularly, so readers remember who you are.</li>
			</ul>
			{isCloud() && (
				<p>
					MailCheap publishes its customers&apos; delivery, bounce and spam rates, every day, on the{" "}
					<Link href="/open">deliverability page</Link>.
				</p>
			)}
		</ArticleHelp>
	);
}
