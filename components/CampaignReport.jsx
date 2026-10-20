import Link from "next/link";
import { Globe, Pause, Play } from "lucide-react";
import { pauseCampaign, resumeCampaign } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCampaignAction from "@/components/ButtonCampaignAction";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonPreview from "@/components/ButtonPreview";
import CardStat from "@/components/CardStat";
import ChartOpens from "@/components/ChartOpens";
import DialogSendMore from "@/components/DialogSendMore";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import IconWarmup from "@/components/IconWarmup";
import ImageFavicon from "@/components/ImageFavicon";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import LinkHelp from "@/components/LinkHelp";
import ListLegend from "@/components/ListLegend";
import MenuReport from "@/components/MenuReport";
import TableCampaignLinks from "@/components/TableCampaignLinks";
import TextEmpty from "@/components/TextEmpty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPlanLimitCode } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { FIRST_SEND, LIMITS, isSendingEnabled } from "@/lib/config";
import { formatCount, formatNumber, formatPoints, formatRate, formatWeekdayHour } from "@/lib/format";
import { rateTone } from "@/lib/health";
import { fillSampleName } from "@/lib/merge-tags";
import { PROVIDER_DOMAINS, PROVIDER_LABELS } from "@/lib/providers";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail, withResponsiveImages } from "@/lib/render-email";
import { TIMELINE_HOURS, findPeak, hoursToHalf, reachedOf } from "@/lib/report-stats";
import { getIssueWebUrl } from "@/lib/sending-rules";
import { timeZoneLabel } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

export default function CampaignReport({
	campaign,
	newsletter,
	providers,
	links,
	timeline = null,
	comparison = null,
	timeZone,
	remainingCount = 0,
	emailsLeft = 0,
	isBlocked = false,
	pace = null,
	newContacts = 0,
}) {
	const { stats } = campaign;
	const id = campaign._id.toString();
	const isOnArchive = newsletter.archiveEnabled && Boolean(campaign.archiveSlug) && campaign.archiveListed !== false;
	const reached = reachedOf(stats);
	const progress = stats.recipients ? Math.min(stats.sent / stats.recipients, 1) : 0;
	const { html } = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter,
	});
	const sender = {
		name: newsletter.name,
		fromName: newsletter.fromName,
		fromEmail: newsletter.fromEmail,
		imageUrl: newsletter.imageUrl,
	};

	return (
		<>
			<HeaderPage
				title={campaign.subject || "Untitled"}
				backHref="/campaigns"
				icon={<AvatarNewsletter newsletter={newsletter} size={28} />}
				meta={<BadgeStatus status={campaign.status} />}
			>
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
						/>
					</GatePlan>
				)}
				{campaign.status === "sending" && (
					<ButtonCampaignAction action={pauseCampaign} id={id}>
						<Pause data-icon="inline-start" />
						Pause
					</ButtonCampaignAction>
				)}
				{campaign.status === "paused" && (
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
				<ButtonPreview
					html={withResponsiveImages(fillSampleName(html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"), { isHtml: true }))}
					sender={sender}
					subject={fillSampleName(campaign.subject)}
					previewText={fillSampleName(campaign.previewText)}
				/>
				<MenuReport
					id={id}
					pageUrl={isOnArchive ? getArchiveUrls(newsletter).post(campaign.archiveSlug) : null}
					isPinned={Boolean(campaign.archivePinned)}
				/>
			</HeaderPage>

			<div className="flex flex-col gap-6">
				{campaign.status === "paused" && campaign.pauseReason && (
					<TextPauseReason reason={campaign.pauseReason} code={campaign.pauseCode} />
				)}
				{["sending", "paused"].includes(campaign.status) && (
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
						{campaign.status === "sending" && campaign.firstSend?.held > 0 && !campaign.firstSend.checkedAt && (
							<p className="text-xs text-pretty text-muted-foreground">
								{formatNumber(campaign.firstSend.slice)} contacts who never got an email from you go first. The other{" "}
								{formatNumber(campaign.firstSend.held)} follow {FIRST_SEND.waitMinutes / 60} hours after them if their bounces and
								complaints stay low. If they don&apos;t, the rest waits for you to resume, and if they&apos;re far over, your account is
								blocked. <LinkHelp article="sending" section="first-send" />
							</p>
						)}
						{campaign.status === "sending" && campaign.sendingUntil && campaign.spreadHours > 0 && (
							<p className="flex gap-1.5 text-xs text-pretty text-muted-foreground">
								<IconWarmup className="size-3.5 translate-y-px" />
								<span>
									It goes out over hours while your account warms up{pace?.warmup ? "" : " to sends this size"}: about{" "}
									{formatCount(hoursUntil(campaign.sendingUntil), "hour")} to go. <LinkHelp article="warm-up" />
								</span>
							</p>
						)}
					</div>
				)}

				<div className="flex flex-col gap-3">
					<div style={{ "--stagger": 1 }} className="grid grid-cols-3 gap-3 animate-enter">
						<CardStat label="Delivered" value={formatRate(stats.delivered, stats.sent)} detail={formatNumber(stats.delivered)} />
						<CardStat
							label="Opened"
							value={formatRate(stats.opened, reached)}
							detail={formatNumber(stats.opened)}
							change={toChange(comparison, "opened")}
						/>
						<CardStat
							label="Clicked"
							value={formatRate(stats.clicked, reached)}
							detail={formatNumber(stats.clicked)}
							change={toChange(comparison, "clicked")}
						/>
					</div>
					<ListStatsQuiet
						style={{ "--stagger": 2 }}
						items={[
							{
								label: "Bounced",
								value: formatQuietRate(stats.bounced, stats.sent, 2),
								count: stats.bounced,
								tone: rateTone(stats.bounced, stats.sent, LIMITS.pause.bounceRate),
							},
							{
								label: "Complaints",
								value: formatQuietRate(stats.complained, stats.sent, 3),
								count: stats.complained,
								tone: rateTone(stats.complained, stats.sent, LIMITS.pause.complaintRate),
							},
							{ label: "Unsubscribed", value: formatQuietRate(stats.unsubscribed, reached, 2), count: stats.unsubscribed },
						]}
					/>
				</div>

				{timeline && reached > 0 && <CardOpens style={{ "--stagger": 3 }} timeline={timeline} timeZone={timeZone} />}

				{links?.links.length > 0 && (
					<TableCampaignLinks
						style={{ "--stagger": 4 }}
						stats={links}
						html={html}
						webUrl={getIssueWebUrl({ campaign, newsletter })}
					/>
				)}

				{providers.length > 0 && <TableProviders style={{ "--stagger": 5 }} providers={providers} />}

				{newsletter.archiveEnabled && campaign.archiveSlug && (
					<div
						style={{ "--stagger": 6 }}
						className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl bg-card px-4 shadow-border transition-colors duration-150 animate-enter focus-within:bg-muted/40"
					>
						<span className="text-sm text-muted-foreground">URL</span>
						<InputCampaignSlug
							campaignId={id}
							initialSlug={campaign.archiveSlug}
							urlBase={getArchiveUrls(newsletter).absolutePost("")}
							isPublished
						/>
						<ButtonCopy value={getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug)} label="Copy link" />
					</div>
				)}
			</div>
		</>
	);
}

// Bounces, complaints and unsubscribes in one quiet row: colored only once they near the level that pauses sends.
function ListStatsQuiet({ items, style }) {
	return (
		<dl style={style} className="grid grid-cols-3 divide-x divide-border rounded-xl bg-card shadow-border animate-enter">
			{items.map(({ label, value, count, tone }) => (
				<div key={label} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
					<dt className="truncate text-xs text-muted-foreground">{label}</dt>
					<dd className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
						<span className={cn("text-sm font-medium", QUIET_TONES[tone])}>{value ?? <TextEmpty />}</span>
						<span className="text-xs text-muted-foreground">{formatNumber(count)}</span>
					</dd>
				</div>
			))}
		</dl>
	);
}

// Opens and clicks hour by hour after sending, with when most came and how fast half of the opens did.
function CardOpens({ timeline, timeZone, style }) {
	const peak = findPeak(timeline.hours);
	const half = hoursToHalf(timeline);
	const summary = [
		peak !== null && `Peak ${formatWeekdayHour(timeline.hours[peak].at, timeZone)}`,
		half !== null && `half of opens in ${half === 1 ? "the first hour" : formatSpan(half)}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<section style={style} className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-border animate-enter sm:p-6">
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
function TableProviders({ providers, style }) {
	const total = providers.reduce((sum, { sent }) => sum + sent, 0);

	return (
		<div style={style} className="overflow-hidden rounded-xl shadow-border animate-enter">
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

function TextPauseReason({ reason, code }) {
	return (
		<p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-500/10 px-4 py-3 text-sm animate-enter">
			<span className="text-pretty">Paused: {reason}</span>
			{isPlanLimitCode(code) && (
				<Link href="/billing" className="font-medium underline underline-offset-4">
					Upgrade
				</Link>
			)}
		</p>
	);
}

// "+4.2 pts vs avg" against the newsletter's earlier issues, with their average in the title; none while the send's
// own opens still come in.
function toChange(comparison, key) {
	if (!comparison?.isSettled) return null;
	const points = formatPoints(comparison.delta[key]);
	if (!points) return null;
	return {
		text: points,
		note: "vs avg",
		isUp: points.startsWith("+"),
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

// Whole hours left, at least one: the last batch's time is approximate.
function hoursUntil(date) {
	return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 3_600_000));
}

const QUIET_TONES = {
	default: "",
	warn: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
};
