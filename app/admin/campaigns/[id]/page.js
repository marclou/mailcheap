import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import CampaignReport from "@/components/CampaignReport";
import CardContentReview from "@/components/CardContentReview";
import TextEmpty from "@/components/TextEmpty";
import { describeBlocker, getAccountStatus, getSendingStatus, isBlocked } from "@/lib/account-state";
import { getCampaignForAdmin } from "@/lib/admin-stats";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { requireAdmin } from "@/lib/auth";
import { findCampaignAuthor } from "@/lib/authors";
import { findCampaignLinks } from "@/lib/campaign-links";
import { getCampaignActivity, getCampaignComparison } from "@/lib/campaign-report";
import { isCloud } from "@/lib/config";
import { REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { toPreviewHtml } from "@/lib/email-preview";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { getAccountPlan, isOnFreePlan } from "@/lib/plans";
import { getPostalAddress } from "@/lib/postal-address";
import { describePublishTo, isOnWebsite, sendsEmail } from "@/lib/publish-to";
import { renderEmail } from "@/lib/render-email";
import { withAllSections } from "@/lib/sections";
import { serialize } from "@/lib/serialize";
import { siteExtensions } from "@/lib/site-extensions";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";
import { removeTracking } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { isObjectIdString } from "@/lib/validation";

export const metadata = { title: "Campaign" };

// Any account's campaign, read-only: the report its owner sees, who sent it and to whom, and the email itself. The
// layout lets only ADMIN_EMAILS in; this page checks again, and everyone else gets the same 404 as a missing campaign.
export default async function AdminCampaignPage({ params }) {
	await requireAdmin();
	const { id } = await params;
	if (!isObjectIdString(id)) notFound();
	const found = await getCampaignForAdmin(id);
	if (!found) notFound();

	const { campaign } = found;
	const newsletter = { ...found.newsletter, postalAddress: getPostalAddress(found.newsletter, siteExtensions.defaultPostalAddress) };
	const [{ providers, timeline }, comparison, links, cookieStore, author] = await Promise.all([
		getCampaignActivity(campaign),
		getCampaignComparison(campaign),
		findCampaignLinks(campaign),
		cookies(),
		findCampaignAuthor(campaign),
	]);
	const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
	// Every section, whoever and wherever it's for: the content as its author wrote it, and the name the check read,
	// shown or not.
	const { html } = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.format === "rich" ? withAllSections(campaign.html) : campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter,
		author: author && { name: author.name, imageUrl: author.imageUrl || null },
	});

	return (
		<>
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				providers={providers}
				links={serialize(links)}
				timeline={timeline}
				comparison={comparison}
				timeZone={timeZone}
				readOnly
				backHref="/admin"
			>
				<ListDetails {...found} newsletter={newsletter} timeZone={timeZone} />
			</CampaignReport>
			{campaign.review ? (
				<CardContentReview
					campaignId={String(campaign._id)}
					review={serialize(campaign.review)}
					isPending={campaign.status === "paused" && campaign.pauseCode === REVIEW_PAUSE_CODE}
					ownerEmail={found.ownerEmail}
				/>
			) : (
				campaign.draftReview && <CardContentReview campaignId={String(campaign._id)} review={serialize(campaign.draftReview)} isDraft />
			)}
			<section style={{ "--stagger": 7 }} className="mt-6 flex flex-col gap-3 animate-enter">
				<h2 className="text-sm font-medium text-muted-foreground">Email</h2>
				{/* No permissions at all: nothing in it runs, submits or navigates the page. */}
				<iframe
					title="Email content"
					sandbox=""
					referrerPolicy="no-referrer"
					srcDoc={removeTracking(toPreviewHtml(html))}
					className="block h-[42rem] w-full rounded-xl bg-white shadow-border"
				/>
			</section>
		</>
	);
}

// Who sent it, from where, to whom and when; the account links to its row on the admin page.
function ListDetails({ campaign, account, ownerEmail, newsletter, segmentName, alerts, timeZone }) {
	const sendingNote = getAccountNote(account);
	const hasPage = newsletter.archiveEnabled && Boolean(campaign.archiveSlug) && campaign.archiveListed !== false && isOnWebsite(campaign);
	const websiteUrl = hasPage ? getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug) : null;
	const dates = [
		["Created", campaign.createdAt],
		campaign.status === "scheduled" && ["Scheduled for", campaign.scheduledAt],
		["Started", campaign.startedAt],
		["Sent", campaign.sentAt],
	].filter((entry) => entry && entry[1]);
	const rows = [
		{
			label: "Account",
			value: (
				<>
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<Link href={`/admin?account=${account._id}`} className="truncate font-medium underline decoration-foreground/30 underline-offset-4">
							{ownerEmail ?? "Unknown owner"}
						</Link>
						{isCloud() && <span className="text-muted-foreground">{describePlan(account)}</span>}
						<BadgeStatus status={getAccountStatus(account)} />
					</span>
					{sendingNote && <span className={cn("block text-xs", isBlocked(account) ? RED : "text-muted-foreground")}>{sendingNote}</span>}
				</>
			),
		},
		{
			label: "Newsletter",
			value: (
				<span className="flex min-w-0 items-center gap-2">
					<AvatarNewsletter newsletter={newsletter} size={20} />
					<span className="truncate">
						{newsletter.name}
						<span className="text-muted-foreground">
							{" "}
							· {newsletter.fromName || newsletter.name} &lt;{newsletter.fromEmail}&gt;
						</span>
					</span>
				</span>
			),
		},
		{ label: "Goes", value: describePublishTo(campaign) },
		sendsEmail(campaign) && {
			label: "To",
			value: `${segmentName ?? "Everyone"} · ${formatNumber(campaign.stats?.recipients ?? 0)} recipients`,
		},
		{ label: "Dates", value: dates.map(([label, at]) => `${label} ${formatDateTime(at, timeZone)}`).join(" · ") },
		{
			label: "Website",
			value: websiteUrl ? (
				<a
					href={websiteUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex max-w-full items-center gap-1 underline decoration-foreground/30 underline-offset-4"
				>
					<span className="truncate">{websiteUrl}</span>
					<ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
				</a>
			) : (
				<span className="text-muted-foreground">Not on the website</span>
			),
		},
		{ label: "Via", value: SOURCES[campaign.source] ?? campaign.source },
		{ label: "Preview text", value: campaign.previewText || <TextEmpty /> },
		alerts.length > 0 && {
			label: "Alerts",
			value: (
				<ul className="flex flex-col gap-0.5">
					{alerts.map((alert) => (
						<li key={alert.id} className="flex gap-2">
							<span className="min-w-0 truncate">{alert.title}</span>
							<span className="shrink-0 text-muted-foreground tabular-nums">{formatRelative(alert.at)}</span>
						</li>
					))}
				</ul>
			),
		},
	].filter(Boolean);

	return (
		<dl className="divide-y divide-border rounded-xl bg-card text-sm shadow-border animate-enter">
			{rows.map(({ label, value }) => (
				<div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-4 py-2.5">
					<dt className="text-muted-foreground">{label}</dt>
					<dd className="min-w-0">{value}</dd>
				</div>
			))}
		</dl>
	);
}

// "Growth · monthly", "Free · Scale", or none.
function describePlan(account) {
	const plan = getAccountPlan(account);
	if (!plan) return "No plan";
	if (isOnFreePlan(account)) return `Free · ${plan.name}`;
	return `${plan.name} · ${account.interval === "year" ? "yearly" : "monthly"}`;
}

// A blocked account first; nothing for an account that sends normally.
function getAccountNote(account) {
	if (isBlocked(account)) return `Blocked by ${describeBlocker(account.pausedBy)}${account.pauseReason ? `: ${account.pauseReason}` : ""}`;
	const sending = getSendingStatus(account);
	return sending.tone === "green" ? null : sending.label;
}

const SOURCES = { dashboard: "Dashboard", api: "API or MCP" };
const RED = "text-red-600 dark:text-red-400";
