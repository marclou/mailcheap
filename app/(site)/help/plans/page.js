import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { BLOCKED_PLAN_DAYS } from "@/lib/account-state";
import { SIGNUPS_PER_KEY, TRIAL_CONTACTS } from "@/lib/actions/contacts";
import { LIMITS } from "@/lib/config";
import { formatNumber, formatUsd } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { PLANS, YEARLY_MONTHS } from "@/lib/plans";
import { SIGNUP_FORM_RATE_LIMITS } from "@/lib/signup-form";

export const metadata = getHelpPageMetadata("plans");

export default function PlansPage() {
	const largest = PLANS.at(-1);

	return (
		<ArticleHelp slug="plans">
			<h2 id="plans">Plans</h2>
			<p>
				Each plan gives a number of emails a month and a number of subscribers. A yearly plan costs {YEARLY_MONTHS} months and gets the
				same emails every month. <Link href="/pricing">Pricing</Link> has the details.
			</p>
			<table>
				<thead>
					<tr>
						<th>Plan</th>
						<th>Emails a month</th>
						<th>Subscribers</th>
						<th>Monthly</th>
					</tr>
				</thead>
				<tbody>
					{PLANS.map(({ id, name, emailsPerMonth, subscribers, monthlyPrice }) => (
						<tr key={id}>
							<td>{name}</td>
							<td>{formatNumber(emailsPerMonth)}</td>
							<td>{formatNumber(subscribers)}</td>
							<td>{formatUsd(monthlyPrice)}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p>
				Sending more than {formatNumber(largest.emailsPerMonth)} emails a month? Chat with us for a price. There&apos;s no free trial.
			</p>

			<h2 id="emails">What counts as an email</h2>
			<p>
				Every email MailCheap sends for you: issues, last-chance emails, test emails, and welcome and confirmation emails. An issue
				sent to 1,000 subscribers is 1,000 emails. The count starts over every month, on the day your plan started. The{" "}
				<LinkApp href="/billing">billing page</LinkApp> and the <LinkApp href="/">overview</LinkApp> show how many you&apos;ve used.
			</p>

			<h2 id="subscribers">What counts as a subscriber</h2>
			<p>
				An active contact: someone who gets your issues, in any of your newsletters. People who haven&apos;t confirmed yet, dormant
				contacts and those who unsubscribed, bounced or complained stay in your list and don&apos;t count.
			</p>

			<h2 id="limits">At the limit</h2>
			<ul>
				<li>Signups keep working, and confirmation emails still go out.</li>
				<li>
					A send or a test email that needs more emails than you have left this month waits until you upgrade or your next month
					starts.
				</li>
				<li>
					Once the month&apos;s emails are used up, welcome emails pause too, and people who join meanwhile don&apos;t get one later.
				</li>
				<li>With more active contacts than your plan allows, sending waits until you upgrade.</li>
			</ul>

			<h2 id="signup-limits">Signup limits</h2>
			<p>
				So that a script or a leaked API key can&apos;t flood strangers&apos; inboxes, signups have limits that grow with your plan.
				Past a newsletter&apos;s signup emails, people who sign up get no welcome or confirmation email until it slows down. Past the
				others, new signups are refused for a while: API signups count each <LinkApp href="/api-keys">API key</LinkApp>, and the whole
				account with AI assistants and contacts added by hand, and form signups come from a newsletter&apos;s{" "}
				<LinkApp href="/newsletters/form">form for your site</LinkApp>. You get an email when one is reached.
			</p>
			<table>
				<thead>
					<tr>
						<th>Plan</th>
						<th>Signup emails every 10 minutes</th>
						<th>API signups an hour</th>
						<th>Form signups every 10 minutes</th>
					</tr>
				</thead>
				<tbody>
					{PLANS.map(({ id, name, signupScale }) => (
						<tr key={id}>
							<td>{name}</td>
							<td>{formatNumber(LIMITS.welcomeEmailsPer10Minutes * signupScale)}</td>
							<td>{formatNumber(SIGNUPS_PER_KEY.limit * signupScale)}</td>
							<td>{formatNumber(SIGNUP_FORM_RATE_LIMITS.perNewsletter.limit * signupScale)}</td>
						</tr>
					))}
				</tbody>
			</table>

			<h2 id="without-a-plan">Without a plan</h2>
			<p>
				You can set up your newsletter, write and preview drafts, upload pictures, and add {TRIAL_CONTACTS.limit} contacts a day by
				hand. Sending, test emails, imports, exports, your own domain, API keys and AI assistants need a plan, and so do your website
				and its signup form, which go online with your plan.
			</p>

			<h2 id="change">Changing or canceling</h2>
			<p>
				Change your plan from the <LinkApp href="/billing">billing page</LinkApp>, anytime: Stripe shows what you&apos;ll pay before
				you confirm, in US dollars. The same
				page opens Stripe&apos;s portal for your card, invoices and cancellation.
			</p>
			<p>
				When you cancel, your plan runs until the end of the month or year you paid for. Then sending stops, and your newsletter,
				subscribers and issues are kept for when you come back. Partial months and years aren&apos;t refunded. If a payment fails,
				your account keeps working while Stripe tries your card again. If your card&apos;s bank reports a payment as unauthorized,
				we refund it and end the plan it paid for.
			</p>
			<p>
				While your account is blocked, your plan isn&apos;t billed and can&apos;t change, and it ends if the block lasts{" "}
				{BLOCKED_PLAN_DAYS} days.{" "}
				<Link href={getHelpHref("deliverability", "blocks")}>When an account is blocked</Link>
			</p>
			<p>
				Deleting your account is a separate step. <Link href={getHelpHref("account", "delete")}>Your account</Link>
			</p>
		</ArticleHelp>
	);
}
