import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { FIRST_SEND, WARMUP } from "@/lib/config";
import { formatCount, formatNumber } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { getAllowance, getPaceHours } from "@/lib/send-spread";

export const metadata = getHelpPageMetadata("warm-up");

// A new account's first issue to contacts it never emailed, paced the way the send step says it.
const FIRST_ISSUES = [WARMUP.quickEmails, 1_000, 5_000, 20_000];
const NEW_ACCOUNT = { proven: 0, recent: 0, warmup: { day: 1 } };

export default function WarmupPage() {
	const afterClean = Math.floor(getAllowance({ proven: 1_000, day: 2 }) / 100) * 100;

	return (
		<ArticleHelp slug="warm-up">
			<h2 id="what">What warming up means</h2>
			<p>
				Inboxes like Gmail, Yahoo and Outlook watch how a new sender&apos;s volume grows. A new account that sends thousands of emails
				at once looks like a spammer and lands in spam. One whose volume grows step by step, with few bounces and complaints, earns a
				reputation that gets its emails to the inbox.
			</p>
			<p>
				So for the {WARMUP.days} days after its first campaign, your account sends gradually: each send goes out at full speed up to
				what your account has shown it can send cleanly, and a bigger one is spread over a few hours. If a list has a problem, it shows
				in the first hours instead of in every inbox.
			</p>

			<h2 id="pace">How a send&apos;s pace is set</h2>
			<ul>
				<li>
					<strong>From the start, up to {formatNumber(WARMUP.quickEmails)} emails go out at once.</strong>
				</li>
				<li>
					<strong>Your proven volume</strong> is your largest campaign of the last {WARMUP.provenDays} days whose bounces and
					complaints stayed low, counted a day after it went out, once they&apos;ve come in.
				</li>
				<li>
					<strong>A send goes out at once</strong> up to your proven volume times {WARMUP.growth.first} on the first day of the
					warm-up. That multiplier grows a little each day, to {WARMUP.growth.last} on day {WARMUP.days}.
				</li>
				<li>
					<strong>A bigger send goes out over {formatCount(WARMUP.minHours, "hour")}</strong>, plus {WARMUP.hoursPerDoubling} for each
					time it doubles that, {formatCount(WARMUP.maxHours / 24, "day")} at most. Its first emails leave right away, the last ones at
					the end, the others evenly between.
				</li>
				<li>
					<strong>Sends count together</strong>: what your other sends still have to send, or sent in the last{" "}
					{formatCount(WARMUP.recentHours, "hour")}, adds to a new one, so splitting a send doesn&apos;t make it faster.
				</li>
			</ul>
			<p>
				For example, a day after a clean send to 1,000 contacts, a send of up to about {formatNumber(afterClean)} goes out at once. A
				new account&apos;s first issue, to contacts it never emailed, goes out over:
			</p>
			<table>
				<thead>
					<tr>
						<th>First issue to</th>
						<th>Goes out over</th>
					</tr>
				</thead>
				<tbody>
					{FIRST_ISSUES.map((emails) => {
						const hours = getPaceHours(NEW_ACCOUNT, { emails, newContacts: emails });
						return (
							<tr key={emails}>
								<td>{formatCount(emails, "contact")}</td>
								<td>{hours ? `About ${formatCount(hours, "hour")}` : "At once"}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<p>
				Those times include the {FIRST_SEND.waitMinutes / 60}-hour check that follows the first slice of contacts you never emailed.{" "}
				<Link href={getHelpHref("sending", "first-send")}>First sends in steps</Link>
			</p>

			<h2 id="dashboard">Where you see it</h2>
			<ul>
				<li>
					The <LinkApp href="/">overview</LinkApp> shows your day in the warm-up and how many emails go out at once right now.
				</li>
				<li>
					The send step says when an issue will be spread, and over how many hours. A send at full speed only shows your day in the
					warm-up.
				</li>
				<li>A campaign that is going out over hours says about how long it has left.</li>
			</ul>
			<p>
				A scheduled issue follows the same pace from its send time. Paused and resumed, a send keeps its pace, and each step of a send
				to more contacts gets its own.
			</p>

			<h2 id="after">After the warm-up</h2>
			<p>
				After day {WARMUP.days}, a send goes out at once up to {WARMUP.growth.last} times your proven volume. A much bigger one, like a
				first send to a newly imported list, is still spread over hours, the same way. Each clean send raises your proven volume, so
				growing your list gradually keeps your sends fast.
			</p>
			<p>
				Bounces and complaints matter during the warm-up and after it.{" "}
				<Link href={getHelpHref("deliverability")}>Bounces, complaints and pauses</Link>
			</p>
		</ArticleHelp>
	);
}
