import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { BLOCKED_PLAN_DAYS } from "@/lib/account-state";
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
				you get an email about it, which the bell in the dashboard shows too, with a link to the campaign. Emails already sent stay
				sent. Look at the campaign&apos;s report: if you know why, resume it from its page to send the rest. Once resumed, only the
				block level below stops it again.{" "}
				<Link href={getHelpHref("notifications")}>Notifications</Link>
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
				its tracked links. Your website stays online, and you can still pause and unschedule campaigns.{" "}
				{isCloud()
					? "Chat with us from the dashboard's banner: we review it and unblock it when it's safe."
					: "An admin of this server unblocks it from the admin page."}
			</p>
			{isCloud() && (
				<p>
					While your account is blocked, your plan isn&apos;t billed: it stays active, and its renewals are skipped. Plans can&apos;t
					change until it&apos;s unblocked, and the <LinkApp href="/billing">billing page</LinkApp> still opens Stripe for your card,
					invoices and canceling. If it&apos;s still blocked {BLOCKED_PLAN_DAYS} days later, your plan ends: your newsletters,
					contacts and campaigns are kept, and you can pick a plan again once it&apos;s unblocked.
				</p>
			)}
			<p>
				Once it&apos;s unblocked, you get an email, and the bounces and complaints from before don&apos;t count again: only the
				emails sent from then on count toward these levels. A send the block stopped waits for you to resume it from its page, and
				goes on from where it stopped.
				{isCloud() &&
					" Your plan is billed again from its next renewal, or, when a renewal was skipped, starts a new month or year that day, billed then."}
			</p>

			<h2 id="test-in-spam">When a test lands in spam</h2>
			<p>
				Inboxes are careful with a sender they don&apos;t know yet, and your first test email is often the first email they see from
				your domain, so it can land in spam even when everything is set up. Your readers&apos; inboxes then learn from how they treat
				your issues: the ones they open and reply to, and the ones they mark as spam.
			</p>
			<ul>
				<li>
					Send from your own domain, with every record found on the <LinkApp href="/domains">Domains page</LinkApp>. On Cloudflare,
					each record is set to DNS only.{" "}
					<Link href={getHelpHref("sender-addresses", "own-domain")}>Your own domain</Link>
				</li>
				<li>
					In Gmail, open the test, click the three dots, then Show original: SPF, DKIM and DMARC should each say PASS. One that
					doesn&apos;t points to the record to fix.
				</li>
				<li>Use a from name your readers know, and link to your own website rather than a link shortener.</li>
				<li>Marking the test as not spam only teaches your own inbox, not your readers&apos;.</li>
			</ul>

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
