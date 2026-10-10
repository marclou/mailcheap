import { Suspense } from "react";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { setSignupFlowEmbed, setSignupFlowStage } from "@/app/(app)/sparkloop/actions";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCopy from "@/components/ButtonCopy";
import GridStats from "@/components/GridStats";
import LinkExternal from "@/components/LinkExternal";
import SectionPage from "@/components/SectionPage";
import ShellSparkLoop, { NoticeError } from "@/components/ShellSparkLoop";
import SwitchAction from "@/components/SwitchAction";
import { Skeleton } from "@/components/ui/skeleton";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { formatMoney, formatNumber } from "@/lib/format";
import { createSparkLoop } from "@/lib/sparkloop";
import { loadSparkLoopPage } from "@/lib/sparkloop-account";
import { getScriptTag, isShownOn } from "@/lib/sparkloop-embed";
import { SPARKLOOP_URLS } from "@/lib/sparkloop-content";

export const metadata = { title: "Signup flow" };

export default async function SignupFlowPage({ searchParams }) {
	const page = await loadSparkLoopPage((await searchParams).newsletter);

	return (
		<ShellSparkLoop
			feature="signup-flow"
			page={page}
			basePath="/sparkloop/signup-flow"
			dashboardHref={SPARKLOOP_URLS.signupFlowEditor}
		>
			<Suspense key={page.publicationUuid} fallback={<SkeletonSignupFlow />}>
				<SectionsSignupFlow apiKey={page.apiKey} newsletter={page.selected} />
			</Suspense>
		</ShellSparkLoop>
	);
}

async function SectionsSignupFlow({ apiKey, newsletter }) {
	const { publicationUuid } = newsletter.sparkloop;
	let flow;
	try {
		({ signup_flow: flow } = await createSparkLoop(apiKey).publication(publicationUuid).getSignupFlow());
	} catch (error) {
		return <NoticeError error={error.message} href={SPARKLOOP_URLS.signupFlow} />;
	}

	const id = newsletter._id.toString();
	const stats = flow.stats ?? {};
	const recommendations = stats.recommendations ?? {};
	const offers = stats.offers ?? {};
	const survey = stats.survey ?? {};
	const archiveUrl = getArchiveUrls(newsletter).siteIndex;
	// What this page controls: the flow opening after signups on Mailcheap's own forms.
	const isShowing =
		Boolean(newsletter.sparkloop.signupFlowEnabled) &&
		newsletter.archiveEnabled &&
		flow.status === "active" &&
		isShownOn(flow.visibility, archiveUrl);

	const embed = (
		<SectionPage key="embed" title="Mailcheap signup forms" stagger={isShowing ? 2 : 0}>
			<div className="overflow-hidden rounded-xl bg-card shadow-border">
				<div className="flex items-start justify-between gap-4 p-4">
					<div className="min-w-0">
						<p className="text-sm font-medium">Show after each signup</p>
						<p id="embed-description" className="mt-0.5 text-sm text-pretty text-muted-foreground">
							Adds SparkLoop&apos;s script to {newsletter.name}&apos;s archive. Each signup there, on the page or in the
							popup, opens the flow.
						</p>
					</div>
					<SwitchAction
						action={setSignupFlowEmbed.bind(null, id)}
						checked={Boolean(newsletter.sparkloop.signupFlowEnabled)}
						label="Show the signup flow after each signup on Mailcheap's forms"
						describedBy="embed-description"
						disabled={!newsletter.archiveEnabled}
						messages={{ on: "The signup flow opens after each signup", off: "The signup flow is off your signup forms" }}
					/>
				</div>
				<NoticeEmbed newsletter={newsletter} flow={flow} archiveUrl={archiveUrl} />
			</div>
		</SectionPage>
	);

	return (
		<div className="flex flex-col gap-8 animate-fade-in">
			{!isShowing && embed}

			<SectionPage
				title="Last 30 days"
				stagger={1}
				meta={
					<BadgeStatus
						status={isShowing ? "active" : "pending"}
						label={isShowing ? "On your forms" : "Not on your forms"}
					/>
				}
			>
				<GridStats
					items={[
						{ label: "Visits", value: formatNumber(stats.visits) },
						{
							label: "Earnings",
							value: formatMoney(stats.earnings?.total),
							detail: `${formatMoney(stats.earnings?.confirmed)} confirmed`,
							tone: stats.earnings?.total > 0 ? "good" : undefined,
						},
						{ label: "Per visit", value: formatMoney(stats.earnings_per_visit) },
						{
							label: "Referrals",
							value: formatNumber(recommendations.referrals?.total),
							detail: `${formatNumber(recommendations.referrals?.free)} free · ${formatNumber(
								(recommendations.referrals?.confirmed_paid ?? 0) + (recommendations.referrals?.pending_paid ?? 0)
							)} paid`,
						},
					]}
				/>
			</SectionPage>

			<SectionPage title="Steps" stagger={2}>
				<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
					<RowStage
						id="stage-recommendations"
						title="Recommendations"
						description="Newsletters new readers can join in one click: your free swaps and paid recommendations."
						detail={`${formatNumber(recommendations.impressions)} views · ${formatNumber(recommendations.referrals?.total)} referrals · ${formatMoney(recommendations.earnings?.total)}`}
						action={setSignupFlowStage.bind(null, id, "recommendations")}
						checked={Boolean(flow.display?.recommendations)}
						href="/sparkloop/recommendations"
					/>
					<RowStage
						id="stage-offers"
						title="Offers"
						description="Brand offers that pay you per lead, click or sale."
						detail={`${formatNumber(offers.impressions)} views · ${formatNumber(offers.claims?.total)} claims · ${formatMoney(offers.earnings)}`}
						action={setSignupFlowStage.bind(null, id, "offers")}
						checked={Boolean(flow.display?.offers)}
						href="/sparkloop/offers"
					/>
					<RowStage
						id="stage-survey"
						title="Welcome survey"
						description="A few questions about who your new readers are."
						detail={`${formatNumber(survey.impressions)} views · ${formatNumber(survey.completions)} answers`}
						action={setSignupFlowStage.bind(null, id, "survey")}
						checked={Boolean(flow.display?.survey)}
						href="/sparkloop/survey"
					/>
				</ul>
				<p className="text-xs text-muted-foreground">
					New readers need at least recommendations or offers. Design, wording and order are edited in{" "}
					<LinkExternal href={SPARKLOOP_URLS.signupFlowEditor}>SparkLoop&apos;s editor</LinkExternal>.
				</p>
			</SectionPage>

			{isShowing && embed}

			<SectionPage title="Your own website" stagger={3}>
				<CardCode
					title="Add to every page with a signup form"
					code={getScriptTag(newsletter.sparkloop.publicationUuid)}
					note="Forms with an email field are picked up on their own."
				/>
				<CardCode
					title="Forms that submit without a page load"
					code={`// After your form adds the subscriber:\nwindow.SL?.trackSubscriber(email);`}
					note={`Add data-sparkloop-form-ignore to the form, so the flow opens once, after the signup worked. Signups through the Mailcheap API need this too.`}
				/>
			</SectionPage>
		</div>
	);
}

function NoticeEmbed({ newsletter, flow, archiveUrl }) {
	if (!newsletter.archiveEnabled) {
		return (
			<Notice tone="warn">
				The signup form lives on the public archive, which is off.{" "}
				<Link href={`/newsletters/${newsletter._id}`} className="font-medium underline underline-offset-2">
					Turn it on
				</Link>{" "}
				in the newsletter settings.
			</Notice>
		);
	}
	if (!isShownOn(flow.visibility, archiveUrl)) {
		return (
			<Notice tone="warn">
				<span>
					Not showing yet. SparkLoop only opens the flow on {flow.visibility?.page_rules?.join(", ") || "the pages you listed"}.
					Add your archive to its <LinkExternal href={SPARKLOOP_URLS.signupFlowEditor}>visibility settings</LinkExternal>, or
					pick &ldquo;All pages&rdquo;.
				</span>
				<span className="mt-1.5 flex items-center gap-1">
					<code className="truncate font-mono text-xs text-foreground">{archiveUrl}</code>
					<ButtonCopy value={archiveUrl} label="Copy archive URL" />
				</span>
			</Notice>
		);
	}
	if (flow.status !== "active") {
		return (
			<Notice tone="warn">
				The flow is off in SparkLoop. <LinkExternal href={SPARKLOOP_URLS.signupFlow}>Turn it on there</LinkExternal>.
			</Notice>
		);
	}
	return (
		<Notice>
			Allowed on <code className="font-mono text-xs">{archiveUrl}</code> by SparkLoop&apos;s visibility rules.
		</Notice>
	);
}

function RowStage({ id, title, description, detail, action, checked, href }) {
	return (
		<li className="flex items-start justify-between gap-4 p-4">
			<div className="min-w-0">
				<p className="text-sm font-medium">
					<Link href={href} className="hover:underline hover:underline-offset-2">
						{title}
					</Link>
				</p>
				<p id={id} className="mt-0.5 text-sm text-pretty text-muted-foreground">
					{description}
				</p>
				<p className="mt-1.5 text-xs text-muted-foreground tabular-nums">{detail}</p>
			</div>
			<SwitchAction
				action={action}
				checked={checked}
				label={`Show ${title.toLowerCase()} in the signup flow`}
				describedBy={id}
				messages={{ on: `${title} shown in the signup flow`, off: `${title} hidden from the signup flow` }}
			/>
		</li>
	);
}

function CardCode({ title, code, note }) {
	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-border">
			<div className="flex h-10 items-center justify-between border-b border-border/60 pr-2 pl-4">
				<span className="text-sm">{title}</span>
				<ButtonCopy value={code} label="Copy" />
			</div>
			<pre className="overflow-x-auto p-4 font-mono text-xs leading-5 text-muted-foreground">{code}</pre>
			{note && <p className="border-t border-border/60 px-4 py-2.5 text-xs text-pretty text-muted-foreground">{note}</p>}
		</div>
	);
}

function Notice({ tone, children }) {
	const Icon = tone === "warn" ? TriangleAlert : CircleCheck;
	return (
		<div className="flex items-start gap-2.5 border-t border-border/60 bg-muted/40 px-4 py-3 text-sm text-pretty text-muted-foreground">
			<Icon className={tone === "warn" ? "mt-0.5 size-4 shrink-0 text-amber-500" : "mt-0.5 size-4 shrink-0 text-emerald-500"} />
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function SkeletonSignupFlow() {
	return (
		<div className="flex flex-col gap-8">
			<Skeleton className="h-[89px] rounded-xl" />
			<Skeleton className="h-64 rounded-xl" />
			<Skeleton className="h-32 rounded-xl" />
		</div>
	);
}
