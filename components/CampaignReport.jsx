import Link from "next/link";
import { ChartColumn, Globe, Inbox, Link2, Pause, PenLine, Play, Users } from "lucide-react";
import { pauseCampaign, resumeCampaign } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCampaignAction from "@/components/ButtonCampaignAction";
import ButtonClickMap from "@/components/ButtonClickMap";
import CardPageViews from "@/components/CardPageViews";
import CardPublishedPage from "@/components/CardPublishedPage";
import CardStat from "@/components/CardStat";
import ChartOpens from "@/components/ChartOpens";
import DialogSendMore from "@/components/DialogSendMore";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import ImageFavicon from "@/components/ImageFavicon";
import LinkHelp from "@/components/LinkHelp";
import ListLegend from "@/components/ListLegend";
import MenuReport from "@/components/MenuReport";
import NoticeWarmup from "@/components/NoticeWarmup";
import RefreshPage from "@/components/RefreshPage";
import SectionRecipients from "@/components/SectionRecipients";
import TableCampaignLinks from "@/components/TableCampaignLinks";
import TabsPage, { PanelTab } from "@/components/TabsPage";
import TextEmpty from "@/components/TextEmpty";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPlanLimitCode } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getAuthorByline } from "@/lib/author-rules";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { REVIEW_CODES, REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { formatCount, formatDateTime, formatNumber, formatRate, formatRateChange, formatWeekdayHour } from "@/lib/format";
import { rateTone } from "@/lib/health";
import { toPreviewFrame } from "@/lib/email-preview";
import { withLinkKeys } from "@/lib/link-stats";
import { PROVIDER_DOMAINS, PROVIDER_LABELS } from "@/lib/providers";
import { describePublishTo, isOnWebsite, readPublishTo } from "@/lib/publish-to";
import { renderEmail } from "@/lib/render-email";
import { withEmailSections } from "@/lib/sections";
import { REFRESH_SECONDS, TIMELINE_HOURS, findPeak, hoursToHalf, isRefreshing, reachedOf } from "@/lib/report-stats";
import { formatPaceTime } from "@/lib/send-spread";
import { getIssueWebUrl } from "@/lib/sending-rules";
import { OWNER_ROLE, hasRole } from "@/lib/team-rules";
import { timeZoneLabel } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { BACKOFF_WHY, GMAIL_WHY, STEPS_WHY, getGmailLaterTrack, getGmailTrack, getStepItems } from "@/lib/warmup-status";

// A sent campaign: its numbers on top, the details in tabs under them. readOnly: an admin looking at a customer's
// campaign (app/admin/campaigns/[id]): its numbers without its owner's actions, and children above them. contactFields:
// the account's, for the preview and the click map to fill in. recipients: who it went to and what they did
// (components/SectionRecipients.jsx), for its owner only. webPage: its card as its website shows it, { title,
// description, imageUrl }, for an issue on the website. pageViews: its page's views by day (lib/page-views.js). role: the
// user's on the newsletter (lib/team-rules.js): sending more, pausing and the page's actions are its admins', the plan
// its owner's.
export default function CampaignReport({
	campaign,
	newsletter,
	contactFields = [],
	providers,
	links,
	recipients = null,
	timeline = null,
	comparison = null,
	timeZone,
	remainingCount = 0,
	emailsLeft = 0,
	isBlocked = false,
	pace = null,
	newContacts = 0,
	gmail = null,
	gmailShare = 0,
	isSharedSender = false,
	readOnly = false,
	backHref = "/campaigns",
	webPage = null,
	pageViews = null,
	role = OWNER_ROLE,
	children,
}) {
	const canManage = !readOnly && hasRole(role, "admin");
	const { stats } = campaign;
	const id = campaign._id.toString();
	// Held by the content check (lib/content-review.js): only MailCheap's review starts it, so it has no Resume.
	const reviewCode = campaign.status === "paused" && REVIEW_CODES.has(campaign.pauseCode) ? campaign.pauseCode : null;
	// A web-only issue sent no email (lib/publish-to.js): its page and views stand in for the email's numbers.
	const publishTo = readPublishTo(campaign);
	const isWebOnly = publishTo === "web";
	const hasPage = newsletter.archiveEnabled && Boolean(campaign.archiveSlug) && isOnWebsite(campaign);
	const isOnArchive = hasPage && campaign.archiveListed !== false;
	const statusLabel = reviewCode
		? reviewCode === REVIEW_PAUSE_CODE
			? "In review"
			: "Not sent"
		: isWebOnly && campaign.status === "sent"
			? "Published"
			: null;
	const reached = reachedOf(stats);
	const progress = stats.recipients ? Math.min(stats.sent / stats.recipients, 1) : 0;
	// Going out: its contacts never emailed in steps (a send from before had one slice), its Gmail readers a new domain
	// sends a later day, or a send from before steps spread over hours.
	const { firstSend } = campaign;
	const stepSizes = firstSend?.steps ?? (firstSend?.slice ? [firstSend.slice, firstSend.held ?? 0] : null);
	const step = firstSend?.step ?? 1;
	const isInSteps = campaign.status === "sending" && Boolean(stepSizes) && !firstSend.checkedAt;
	const gmailLater = campaign.status === "sending" && gmail?.later > 0 ? getGmailLaterTrack({ domain: newsletter.sendingDomain, ...gmail }) : null;
	const isSpread = campaign.status === "sending" && !isInSteps && Boolean(campaign.sendingUntil) && campaign.spreadHours > 0;
	const backoffTrack = gmail ? getGmailTrack(pace?.sender ?? null, gmail.waiting) : null;
	// With the Read online link its emails had, whose clicks the preview shows with the others', and every section any of
	// them had, whose links' clicks too.
	const { html } = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.format === "rich" ? withEmailSections(campaign.html) : campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter,
		webUrl: getIssueWebUrl({ campaign, newsletter }),
		author: getAuthorByline(campaign.sentAuthor, "email"),
	});
	const clicks = links?.links.length
		? { clickers: links.clickers, links: links.links.map(({ key, clickers }) => ({ key, clickers })) }
		: null;
	// The email as it went out, for Preview in the ⋯ menu and for the click map, which shows its clicks on it.
	const email = {
		html: toPreviewFrame(html),
		sender: {
			name: newsletter.name,
			fromName: newsletter.fromName,
			fromEmail: newsletter.fromEmail,
			imageUrl: newsletter.imageUrl,
		},
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletterId: String(newsletter._id),
		contactFields,
	};
	const clickMap = !readOnly && !isWebOnly && (
		<ButtonClickMap {...email} html={clicks ? toPreviewFrame(withLinkKeys(html)) : email.html} clicks={clicks} />
	);
	const pageUrl = hasPage ? getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug) : null;
	const views = <CardPageViews views={pageViews ?? { total: campaign.webViews ?? 0, days: null }} />;
	const page = !readOnly && hasPage && (
		<CardPublishedPage
			id={id}
			page={webPage ?? { title: campaign.subject, description: campaign.previewText, imageUrl: null }}
			slug={campaign.archiveSlug}
			newsletter={newsletter}
			isPinned={Boolean(campaign.archivePinned)}
			isListed={campaign.archiveListed !== false}
		/>
	);

	return (
		<>
			{isRefreshing(campaign) && <RefreshPage seconds={REFRESH_SECONDS} />}
			<HeaderPage
				title={campaign.subject || "Untitled"}
				backHref={backHref}
				icon={<AvatarNewsletter newsletter={newsletter} size={40} className="rounded-xl" />}
				details={
					<LineCampaign
						campaign={campaign}
						statusLabel={statusLabel}
						publishTo={publishTo}
						pageUrl={pageUrl}
						timeZone={timeZone}
					/>
				}
			>
				{canManage && (
					<>
						{campaign.status === "sent" && remainingCount > 0 && isSendingEnabled() && !isBlocked && (
							<GatePlan reason="send">
								<DialogSendMore
									campaignId={id}
									sentCount={stats.recipients}
									remainingCount={remainingCount}
									emailsLeft={emailsLeft}
									isCleanupEnabled={Boolean(newsletter.cleanup?.enabled)}
									pace={pace}
									newContacts={newContacts}
									gmailShare={gmailShare}
									isSharedSender={isSharedSender}
								/>
							</GatePlan>
						)}
						{campaign.status === "sending" && (
							<ButtonCampaignAction action={pauseCampaign} id={id}>
								<Pause data-icon="inline-start" />
								Pause
							</ButtonCampaignAction>
						)}
						{campaign.status === "paused" && !reviewCode && (
							<GatePlan reason="send">
								<ButtonCampaignAction
									action={resumeCampaign}
									id={id}
									disabledReason={isBlocked ? "The account is blocked" : isSendingEnabled() ? null : "Sending is off"}
								>
									<Play data-icon="inline-start" />
									Resume
								</ButtonCampaignAction>
							</GatePlan>
						)}
						{hasPage && (
							<Button asChild variant="outline">
								<Link href={`/campaigns/${id}/web`}>
									<PenLine data-icon="inline-start" />
									Edit web page
								</Link>
							</Button>
						)}
						<MenuReport
							id={id}
							subject={campaign.subject}
							pageUrl={isOnArchive ? getArchiveUrls(newsletter).post(campaign.archiveSlug) : null}
							isPinned={Boolean(campaign.archivePinned)}
							isWebOnly={isWebOnly}
							preview={isWebOnly ? null : email}
						/>
					</>
				)}
			</HeaderPage>

			<div className="flex flex-col gap-6">
				{campaign.status === "paused" && campaign.pauseCode === "rate_limited" ? (
					<NoticeWarmup
						sections={[
							{
								title: "Paused: Gmail asked to slow down",
								tracks: backoffTrack ? [backoffTrack] : [],
								why: BACKOFF_WHY,
								help: { article: "warm-up", section: "gmail" },
								children: !backoffTrack && <p className="text-pretty">{campaign.pauseReason}</p>,
							},
						]}
						className="animate-enter"
					/>
				) : (
					campaign.status === "paused" &&
					campaign.pauseReason && <TextPauseReason reason={campaign.pauseReason} code={campaign.pauseCode} canUpgrade={!readOnly && role === OWNER_ROLE} />
				)}
				{["sending", "paused"].includes(campaign.status) && !(reviewCode && !stats.recipients) && (
					<div className="flex flex-col gap-2 animate-enter">
						<div className="flex justify-between text-sm tabular-nums">
							<span className="text-muted-foreground">
								{formatNumber(stats.sent)} of {formatNumber(stats.recipients)}
							</span>
							<span>{Math.round(progress * 100)}%</span>
						</div>
						<div className="h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-foreground transition-[width] duration-500"
								style={{ width: `${progress * 100}%` }}
							/>
						</div>
					</div>
				)}
				{(isInSteps || gmailLater || isSpread) && (
					<NoticeWarmup
						sections={[
							isInSteps && {
								title: `New contacts get it in steps: ${step} of ${stepSizes.length}`,
								progress: { value: step, max: stepSizes.length, label: "Steps" },
								steps: getStepItems(stepSizes, { step, nextAt: firstSend.checkAt }),
								why: STEPS_WHY,
								help: { article: "sending", section: "first-send" },
							},
							gmailLater && {
								title: "Some Gmail readers get it tomorrow",
								tracks: [gmailLater],
								why: GMAIL_WHY,
								help: { article: "warm-up", section: "new-domain" },
							},
							isSpread && !gmailLater && { title: `Going out gradually: ${formatTimeLeft(hoursUntil(campaign.sendingUntil))} to go` },
						]}
						className="animate-enter"
					/>
				)}

				{children}

				{isWebOnly ? (
					!reviewCode && <GridPage page={page} views={views} style={{ "--stagger": 1 }} className="animate-enter" />
				) : (
					<EmailResults
						campaign={campaign}
						newsletter={newsletter}
						html={html}
						stats={stats}
						reached={reached}
						comparison={comparison}
						timeline={timeline}
						timeZone={timeZone}
						links={links}
						providers={providers}
						recipients={readOnly ? null : recipients}
						clickMap={clickMap}
						page={page}
						views={views}
						showComplaints={readOnly}
					/>
				)}
			</div>
		</>
	);
}

// What the email did, always on top: delivery, opens and clicks against the newsletter's average, bounces and
// unsubscribes. Once it has gone out, its details in tabs under them: opens and clicks over time, its links with their
// click map, who it went to, its inboxes, and its page on the website. Complaints are for an admin to act on: the
// owner, who can't, sees them by inbox.
function EmailResults({
	campaign,
	newsletter,
	html,
	stats,
	reached,
	comparison,
	timeline,
	timeZone,
	links,
	providers,
	recipients,
	clickMap,
	page,
	views,
	showComplaints,
}) {
	// Bounced is hard bounces only: the rest are on their way, or an inbox refused them for now, like a full mailbox.
	const notDelivered = Math.max(0, stats.sent - stats.delivered - stats.bounced);
	const cards = [
		{
			label: "Delivered",
			value: formatRate(stats.delivered, stats.sent),
			detail: notDelivered > 0 ? `${formatNumber(stats.delivered)} · ${formatNumber(notDelivered)} not delivered` : formatNumber(stats.delivered),
		},
		{ label: "Opened", value: formatRate(stats.opened, reached), detail: formatNumber(stats.opened), change: toChange(comparison, "opened") },
		{ label: "Clicked", value: formatRate(stats.clicked, reached), detail: formatNumber(stats.clicked), change: toChange(comparison, "clicked") },
		{
			label: "Bounced",
			value: formatQuietRate(stats.bounced, stats.sent, 2),
			detail: formatNumber(stats.bounced),
			tone: rateTone(stats.bounced, stats.sent, LIMITS.pause.bounceRate),
		},
		showComplaints && {
			label: "Complaints",
			value: formatQuietRate(stats.complained, stats.sent, 3),
			detail: formatNumber(stats.complained),
			tone: rateTone(stats.complained, stats.sent, LIMITS.pause.complaintRate),
		},
		{ label: "Unsubscribed", value: formatQuietRate(stats.unsubscribed, reached, 2), detail: formatNumber(stats.unsubscribed) },
	].filter(Boolean);
	const isRow = cards.length === 5;
	const hasRecipients = recipients?.counts.all > 0;
	const tabs = [TABS.timeline, TABS.links, hasRecipients && TABS.recipients, TABS.inboxes, page && TABS.website].filter(Boolean);
	// Picking whom to show, or showing more of them, reloads the page on its recipients.
	const isOnRecipients = hasRecipients && (recipients.filter !== "all" || recipients.shown > recipients.step);

	return (
		<>
			<div style={{ "--stagger": 1 }} className={cn("grid grid-cols-2 gap-3 animate-enter", isRow ? "lg:grid-cols-5" : "sm:grid-cols-3")}>
				{cards.map((card, index) => (
					<CardStat key={card.label} {...card} className={isRow && index === 0 ? "max-lg:col-span-2" : undefined} />
				))}
			</div>

			{(stats.sent > 0 || hasRecipients) && (
				<TabsPage tabs={tabs} defaultValue={isOnRecipients ? "recipients" : "timeline"} style={{ "--stagger": 2 }}>
					<PanelTab value="timeline">{timeline && reached > 0 && <CardOpens timeline={timeline} timeZone={timeZone} />}</PanelTab>
					<PanelTab value="links" className="flex flex-col gap-3">
						<div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<p className="text-sm text-muted-foreground tabular-nums">
								{links?.clickers > 0 ? `${formatCount(links.clickers, "contact")} clicked a link` : "No clicks yet"}
							</p>
							{clickMap}
						</div>
						{links?.links.length > 0 && <TableCampaignLinks stats={links} html={html} webUrl={getIssueWebUrl({ campaign, newsletter })} />}
					</PanelTab>
					{hasRecipients && (
						<PanelTab value="recipients">
							<SectionRecipients campaignId={campaign._id.toString()} timeZone={timeZone} {...recipients} />
						</PanelTab>
					)}
					<PanelTab value="inboxes">
						{providers.length > 0 ? <TableProviders providers={providers} /> : <TextPanelEmpty>No emails sent yet</TextPanelEmpty>}
					</PanelTab>
					{page && (
						<PanelTab value="website">
							<GridPage page={page} views={views} />
						</PanelTab>
					)}
				</TabsPage>
			)}
		</>
	);
}

// The issue's page beside its views, on wide screens.
function GridPage({ page, views, className, style }) {
	return (
		<div style={style} className={cn("grid gap-3", page && "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]", className)}>
			{page}
			{views}
		</div>
	);
}

// Under its subject: where it stands and since when, and where it went when that's not both email and the website: an
// issue on the website links to its page.
function LineCampaign({ campaign, statusLabel, publishTo, pageUrl, timeZone }) {
	const isOut = campaign.status === "sent";
	const at = isOut ? (campaign.sentAt ?? campaign.startedAt) : campaign.startedAt;
	const host = pageUrl && new URL(pageUrl).host;
	const items = [
		at && (
			<time key="at" dateTime={new Date(at).toISOString()} className="tabular-nums">
				{isOut ? formatDateTime(at, timeZone) : `Started ${formatDateTime(at, timeZone)}`}
			</time>
		),
		pageUrl ? (
			<a
				key="page"
				href={pageUrl}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-foreground"
			>
				<ImageFavicon domain={host} size={14} />
				On your website
			</a>
		) : (
			publishTo !== "both" && <span key="where">{describePublishTo(campaign)}</span>
		),
	].filter(Boolean);

	return (
		<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
			<BadgeStatus status={campaign.status} label={statusLabel} />
			{items.map((item, index) => (
				<span key={item.key} className="flex items-center gap-2">
					{index > 0 && <span aria-hidden="true">·</span>}
					{item}
				</span>
			))}
		</span>
	);
}

function TextPanelEmpty({ children }) {
	return <p className="rounded-xl bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-border">{children}</p>;
}

// Opens and clicks hour by hour after sending, with when most came and how fast half of the opens did.
function CardOpens({ timeline, timeZone }) {
	const peak = findPeak(timeline.hours);
	const half = hoursToHalf(timeline);
	const summary = [
		peak !== null && `Peak ${formatWeekdayHour(timeline.hours[peak].at, timeZone)}`,
		half !== null && `half of opens in ${half === 1 ? "the first hour" : formatSpan(half)}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<section className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-border sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">After sending</h2>
					{summary && <p className="text-sm text-pretty tabular-nums">{summary}</p>}
				</div>
				<ListLegend
					items={[{ swatch: "ghost", label: "Opens" }, { swatch: "bar", label: "Clicks" }, { label: timeZoneLabel(timeZone) }]}
				/>
			</div>
			<ChartOpens timeline={timeline} timeZone={timeZone} />
			{timeline.later.opens > 0 && (
				<p className="text-xs text-muted-foreground tabular-nums">
					{formatCount(timeline.later.opens, "open")} came after {formatSpan(TIMELINE_HOURS)}.
				</p>
			)}
		</section>
	);
}

// Results by inbox provider, each with its share of the send.
function TableProviders({ providers }) {
	const total = providers.reduce((sum, { sent }) => sum + sent, 0);

	return (
		<div className="overflow-hidden rounded-xl shadow-border">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Inbox</TableHead>
						<TableHead className="text-right">Share</TableHead>
						<TableHead className="text-right">Delivered</TableHead>
						<TableHead className="text-right max-sm:pr-4">Opened</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Clicked</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Bounced</TableHead>
						<TableHead className="hidden pr-4 text-right sm:table-cell">Complaints</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{providers.map((row) => (
						<TableRow key={row.provider} className="tabular-nums">
							<TableCell className="pl-4">
								<span className="flex items-center gap-2.5">
									{PROVIDER_DOMAINS[row.provider] ? (
										<ImageFavicon domain={PROVIDER_DOMAINS[row.provider]} size={16} />
									) : (
										<Globe className="size-4 shrink-0 text-muted-foreground" />
									)}
									<span className="flex min-w-0 flex-col">
										<span className="truncate font-medium">{PROVIDER_LABELS[row.provider] || PROVIDER_LABELS.other}</span>
										<span className="text-xs text-muted-foreground">{formatNumber(row.sent)} sent</span>
									</span>
								</span>
							</TableCell>
							<TableCell>
								<span className="flex items-center justify-end gap-2.5">
									<span aria-hidden="true" className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted sm:block">
										<span className="block h-full rounded-full bg-foreground/70" style={{ width: `${(row.sent / total) * 100}%` }} />
									</span>
									<span className="w-9 text-right">{formatRate(row.sent, total, 0)}</span>
								</span>
							</TableCell>
							<TableCell className="text-right">{formatRate(row.delivered, row.sent) ?? <TextEmpty />}</TableCell>
							<TableCell className="text-right max-sm:pr-4">{formatRate(row.opened, row.delivered) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden text-right sm:table-cell">{formatRate(row.clicked, row.delivered) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden text-right sm:table-cell">{formatQuietRate(row.bounced, row.sent, 2) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden pr-4 text-right sm:table-cell">
								{formatQuietRate(row.complained, row.sent, 3) ?? <TextEmpty />}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function TextPauseReason({ reason, code, canUpgrade }) {
	if (REVIEW_CODES.has(code)) {
		return (
			<p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-pretty animate-enter">
				{reason} <LinkHelp article="sending" section="content-check" />
			</p>
		);
	}
	return (
		<p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-500/10 px-4 py-3 text-sm animate-enter">
			<span className="text-pretty">Paused: {reason}</span>
			{canUpgrade && isPlanLimitCode(code) && (
				<Link href="/billing" className="font-medium underline underline-offset-4">
					Upgrade
				</Link>
			)}
		</p>
	);
}

// "+4.2% vs avg" against the newsletter's earlier issues, with their average in the title; none while the send's own
// opens still come in.
function toChange(comparison, key) {
	if (!comparison?.isSettled) return null;
	const text = formatRateChange(comparison.delta[key]);
	if (!text) return null;
	return {
		text,
		note: "vs avg",
		isUp: text.startsWith("+"),
		title: `Your last ${formatCount(comparison.issues, "issue")} averaged ${(comparison.average[key] * 100).toFixed(1)}%`,
	};
}

// A rate with its decimals, or "0%" when nothing happened, so a quiet row stays quiet.
function formatQuietRate(part, total, digits) {
	return part === 0 && total ? "0%" : formatRate(part, total, digits);
}

// "12 h", "3 days"
function formatSpan(hours) {
	if (hours < 48) return `${hours} h`;
	return `${Math.round(hours / 24)} days`;
}

const TABS = {
	timeline: { value: "timeline", icon: ChartColumn, label: "Timeline" },
	links: { value: "links", icon: Link2, label: "Links" },
	recipients: { value: "recipients", icon: Users, label: "Recipients" },
	inboxes: { value: "inboxes", icon: Inbox, label: "Inboxes" },
	website: { value: "website", icon: Globe, label: "Website" },
};

// Whole hours left, at least one: the last batch's time is approximate.
function hoursUntil(date) {
	return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 3_600_000));
}

function formatTimeLeft(hours) {
	return hours >= 48 ? formatPaceTime(hours) : `about ${formatCount(hours, "hour")}`;
}