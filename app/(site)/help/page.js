import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ScriptJsonLd from "@/components/ScriptJsonLd";
import { LAST_CHANCE_DAYS, getCleanupDefaults } from "@/lib/cleanup";
import { APP_NAME, FIRST_SEND, LIMITS, WARMUP, getSharedDomain, isCloud } from "@/lib/config";
import { formatNumber, formatPercent } from "@/lib/format";
import { HELP_PATH, getHelpGroups, getHelpHref } from "@/lib/help";
import { getPageMetadata } from "@/lib/site";

export const metadata = getPageMetadata({
	title: { absolute: `Help · ${APP_NAME}` },
	description:
		"How MailCheap works, in plain words: setting up your newsletter, contacts and imports, writing and sending issues, bounces and complaints, plans and your account.",
	path: HELP_PATH,
});

export default function HelpPage() {
	const groups = getHelpGroups();
	const questions = getQuestions();

	return (
		<>
			<header className="mb-12 max-w-2xl animate-enter">
				<h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">How MailCheap works</h1>
				<p className="mt-4 text-[17px] leading-8 text-pretty text-muted-foreground">
					Plain answers about your newsletter, your contacts, writing and sending issues, and your account. Building with the REST API or
					MCP? See the{" "}
					<Link href="/docs" className={LINK_CLASS}>
						API and MCP docs
					</Link>
					.
				</p>
			</header>

			<div className="flex flex-col gap-12">
				{groups.map(({ group, articles }, index) => (
					<section key={group} style={{ "--stagger": index + 1 }} className="animate-enter">
						<h2 className="font-semibold tracking-tight">{group}</h2>
						<div className="mt-4 grid gap-3 sm:grid-cols-2">
							{articles.map(({ slug, title, summary }) => (
								<Link
									key={slug}
									href={getHelpHref(slug)}
									className="group flex flex-col gap-1.5 rounded-xl bg-card p-4 shadow-border transition-shadow duration-150 hover:shadow-border-hover"
								>
									<span className="flex items-center justify-between gap-3 font-medium">
										{title}
										<ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
									</span>
									<span className="text-sm text-pretty text-muted-foreground">{summary}</span>
								</Link>
							))}
						</div>
					</section>
				))}
			</div>

			<section id="questions" style={{ "--stagger": groups.length + 1 }} className="mt-16 max-w-2xl scroll-mt-24 animate-enter">
				<h2 className="text-xl font-semibold tracking-tight">Common questions</h2>
				<dl className="mt-6 flex flex-col divide-y divide-border/60">
					{questions.map(({ question, answer, href }) => (
						<div key={question} className="py-5 first:pt-0">
							<dt className="font-medium">{question}</dt>
							<dd className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
								{answer}{" "}
								<Link href={href} className={LINK_CLASS}>
									Read more
								</Link>
							</dd>
						</div>
					))}
				</dl>
			</section>

			<ScriptJsonLd
				data={{
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: questions.map(({ question, answer }) => ({
						"@type": "Question",
						name: question,
						acceptedAnswer: { "@type": "Answer", text: answer },
					})),
				}}
			/>
		</>
	);
}

const LINK_CLASS = "font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground";

// Plain text: the structured data repeats them for search results.
function getQuestions() {
	const sharedDomain = getSharedDomain();
	const cleanup = getCleanupDefaults();
	const { pause, block } = LIMITS;
	return [
		isCloud() && {
			question: "What does warming up my account mean?",
			answer: `For ${WARMUP.days} days after its first campaign, an account sends gradually. At first, up to ${formatNumber(WARMUP.quickEmails)} emails go out at once, and that number grows a day after each send with few bounces and complaints. A bigger send goes out over a few hours, so inboxes like Gmail see your volume grow step by step.`,
			href: getHelpHref("warm-up"),
		},
		{
			question: "Why did my campaign pause?",
			answer: `Too many of its emails bounced or were marked as spam: more than ${formatPercent(pause.bounceRate)} hard bounces (at least ${pause.minBounces}) or ${formatPercent(pause.complaintRate)} complaints (at least ${pause.minComplaints}). Emails already sent stay sent, and you can resume the rest from the campaign's page. Past ${formatPercent(block.bounceRate)} bounces or ${formatPercent(block.complaintRate)} complaints, the whole account is blocked.`,
			href: getHelpHref("deliverability", "pauses"),
		},
		{
			question: "Why do new contacts get my issue in steps?",
			answer: `The first time you email contacts who never got an email from you, a slice of them goes first. The rest follows ${FIRST_SEND.waitMinutes / 60} hours later if the slice's bounces and complaints stay low. A list with problems shows itself in that slice, before it reaches everyone.`,
			href: getHelpHref("sending", "first-send"),
		},
		sharedDomain && {
			question: "Do I need my own domain?",
			answer: `No. Each newsletter can send from hello@your-newsletter.${sharedDomain}, with its website at your-newsletter.${sharedDomain}. Add your own domain anytime on the Domains page, and your emails move to it.`,
			href: getHelpHref("sender-addresses"),
		},
		{
			question: "What happens to subscribers who stop opening?",
			answer: `With list cleanup on, a contact who ignored ${cleanup.issues} issues in a row and showed no sign of life for ${cleanup.days} days gets one last-chance email instead of your issue. If they don't click it, they become dormant at your first send ${LAST_CHANCE_DAYS} days or more after it: they stay in your list, but stop getting issues and stop counting as subscribers.`,
			href: getHelpHref("list-cleanup"),
		},
		{
			question: "Can I unsend an email?",
			answer: "No. Emails can't be recalled once they go out. While a send is still going out, you can pause it: what's sent stays sent, and the rest waits until you resume.",
			href: getHelpHref("sending", "pause"),
		},
		isCloud() && {
			question: "What counts as an email?",
			answer: "Every email MailCheap sends for you: issues, test emails, and welcome and confirmation emails. The count starts over every month, on the day your plan started.",
			href: getHelpHref("plans"),
		},
	].filter(Boolean);
}
