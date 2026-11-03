"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, ChevronsUpDown, Globe, Layers, Loader2, Mail, Plus, Send, X } from "lucide-react";
import { setCampaignSegment } from "@/app/(app)/campaigns/actions";
import CardSettings from "@/components/CardSettings";
import { ListTips } from "@/components/CardTips";
import CardWebPage from "@/components/CardWebPage";
import DialogSegment from "@/components/DialogSegment";
import ListCleanupPreview from "@/components/ListCleanupPreview";
import NoticeOwnDomain from "@/components/NoticeOwnDomain";
import NoticePace from "@/components/NoticePace";
import PickerSendTime from "@/components/PickerSendTime";
import RowCampaign from "@/components/RowCampaign";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTipFix } from "@/lib/campaign-steps";
import { formatCount, formatNumber, formatSendTime } from "@/lib/format";
import { PUBLISH_OPTIONS } from "@/lib/publish-to";
import { toast } from "@/lib/toast";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

// The send step: where the issue goes (by email, on the website or both), who gets it, everyone unless one of the
// newsletter's segments narrows it, its page on the website, then now or at a time, and how fast it goes out. Its button
// is in the editor's bar, and lib/use-send-campaign.js holds what it does, with its count of contacts. everyoneCount: all
// the newsletter's active contacts, what a segment's count is out of. A web-only issue has no audience or pace: it goes
// on the website. subject, previewText, body and format: the draft as it's written, which its page's card follows
// (components/CardWebPage.jsx), and onBeforeSave saves. onEdit(field, words): a tip's fix, from the dialog a send or a
// schedule stopped in.
export default function PanelSend({
	sending,
	campaign,
	newsletter,
	subject,
	previewText,
	body,
	format,
	contactFields,
	otherPictures,
	onBeforeSave,
	everyoneCount,
	segments,
	isSegmentDeleted,
	pace,
	newContacts,
	gmailShare = 0,
	isSharedSender = false,
	archiveUrlBase,
	publishTo,
	onPublishToChange,
	isChangingPublishTo,
	websiteHref,
	domainNudge = null,
	onEdit,
}) {
	const isClient = useIsClient();
	const [segmentId, setSegmentId] = useState(campaign.segmentId ?? null);
	const [isCreatingSegment, setIsCreatingSegment] = useState(false);
	const [isChangingSegment, startChangingSegment] = useTransition();
	const isOpeningDialogRef = useRef(false);
	const isEditingTipRef = useRef(false);
	const segment = segments.find(({ id }) => id === segmentId) ?? null;
	const scheduledAt = campaign.status === "scheduled" ? campaign.scheduledAt : null;
	// The browser's time zone, which the server doesn't know.
	const scheduledTime = scheduledAt && isClient ? formatSendTime(scheduledAt) : null;
	const isNow = sending.choice === "now";
	const isEmail = publishTo !== "web";
	const isWebsiteOn = Boolean(newsletter.archiveEnabled);
	// As the send and schedule dialogs counted them: a send with its last-chance emails, a schedule its contacts.
	const paceEmails = isNow ? sending.sendEmails : sending.scheduleRecipients;
	const isCleanupEnabled = isEmail && Boolean(newsletter.cleanup?.enabled);
	const from = newsletter.fromName ? `${newsletter.fromName} <${newsletter.fromEmail}>` : newsletter.fromEmail;
	const recipients = sending.scheduleRecipients;
	const isDeleted = Boolean(segmentId && !segment && isSegmentDeleted && segmentId === campaign.segmentId);

	// Saved right away: the page counts the new audience, and the list cleanup's preview reads it again.
	function changeSegment(id) {
		const previous = segmentId;
		setSegmentId(id);
		startChangingSegment(async () => {
			const result = await setCampaignSegment(campaign._id, id);
			if (result?.error) {
				setSegmentId(previous);
				return void toast.error(result.error);
			}
			sending.prepare();
		});
	}

	function createSegment() {
		isOpeningDialogRef.current = true;
		setIsCreatingSegment(true);
	}

	// The segment dialog keeps the focus the menu would give back to its button.
	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	// The field a tip's fix moves the focus to keeps it as the dialog closes.
	function editTip(fix) {
		isEditingTipRef.current = true;
		sending.setIsConfirmOpen(false);
		onEdit(fix.field, fix.words);
	}

	function keepEditFocus(event) {
		if (!isEditingTipRef.current) return;
		isEditingTipRef.current = false;
		event.preventDefault();
	}

	return (
		<div className="flex flex-col gap-6">
			<CardSettings title="Where it goes">
				<div className="flex flex-col gap-3 p-3">
					<div role="radiogroup" aria-label="Where it goes" className="grid gap-2 sm:grid-cols-3">
						{PUBLISH_OPTIONS.map(({ value, label, description }) => (
							<CardChoice
								key={value}
								icon={PUBLISH_ICONS[value]}
								title={label}
								description={description}
								isSelected={publishTo === value}
								isDisabled={(value === "web" && !isWebsiteOn && publishTo !== "web") || isChangingPublishTo}
								onSelect={() => onPublishToChange(value)}
							/>
						))}
					</div>
					{!isWebsiteOn && (
						<p className="px-1 text-sm text-pretty text-muted-foreground">
							Your website is off, so issues only go out by email.{" "}
							{websiteHref && (
								<Link href={websiteHref} className="font-medium text-foreground underline underline-offset-4">
									Turn it on
								</Link>
							)}
						</p>
					)}
				</div>
			</CardSettings>

			{isEmail && (
				<CardSettings title="Who gets it" stagger={1}>
					<div>
						<RowCampaign label="From">
							<span className="truncate text-sm">{from}</span>
						</RowCampaign>
						{domainNudge && <NoticeOwnDomain nudge={domainNudge} newsletter={newsletter} className="mx-3 mb-3" />}
					</div>
					<RowCampaign label="To">
						<span className="flex min-w-0 items-center gap-3">
							<MenuAudience
								segments={segments}
								segmentId={segmentId}
								label={isDeleted ? "Deleted segment" : segmentId ? segment?.name : "Everyone"}
								isDeleted={isDeleted}
								onSegmentChange={changeSegment}
								onNewSegment={createSegment}
								onCloseAutoFocus={keepDialogFocus}
							/>
							{!isDeleted && (
								<span
									className={cn(
										"ml-auto shrink-0 text-sm text-muted-foreground tabular-nums transition-opacity duration-150",
										isChangingSegment && "opacity-40"
									)}
								>
									{recipients < everyoneCount
										? `${formatNumber(recipients)} of ${formatCount(everyoneCount, "contact")}`
										: formatCount(recipients, "contact")}
								</span>
							)}
						</span>
					</RowCampaign>
					{/* A cap set through the API or kept from an earlier send: the dashboard sets none, so removing it holds from
					    the next send or schedule. */}
					{sending.limit && (
						<RowCampaign label="Limit">
							<span className="flex min-w-0 items-center gap-2 text-sm">
								<span className="truncate tabular-nums">The {formatNumber(Number.parseInt(sending.limit, 10))} most engaged</span>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Remove the limit"
									onClick={() => sending.setLimit("")}
									className="ml-auto text-muted-foreground"
								>
									<X />
								</Button>
							</span>
						</RowCampaign>
					)}
					{isCleanupEnabled &&
						(isNow ? (
							<div className="p-3">
								<ListCleanupPreview summary={sending.summary} isCounting={sending.isCounting} error={sending.preview?.error} />
							</div>
						) : (
							<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
								The list cleanup runs when it goes out, so cold contacts get the last-chance email instead.
							</p>
						))}
				</CardSettings>
			)}

			{archiveUrlBase && publishTo !== "email" && (
				<CardWebPage
					campaign={campaign}
					newsletter={newsletter}
					subject={subject}
					previewText={previewText}
					body={body}
					format={format}
					contactFields={contactFields}
					otherPictures={otherPictures}
					archiveUrlBase={archiveUrlBase}
					onBeforeSave={onBeforeSave}
				/>
			)}

			<CardSettings title="When" stagger={2}>
				<div className="flex flex-col gap-4 p-3">
					<div role="radiogroup" aria-label="When" className="grid gap-2 sm:grid-cols-2">
						<CardChoice
							icon={isEmail ? Send : Globe}
							title={isEmail ? "Send now" : "Publish now"}
							description={
								scheduledTime ? `Instead of ${scheduledTime}` : isEmail ? "Goes out right away" : "Goes on your website right away"
							}
							isSelected={isNow}
							onSelect={() => sending.setChoice("now")}
						/>
						<CardChoice
							icon={CalendarClock}
							title="Schedule"
							description={scheduledTime ? `Scheduled for ${scheduledTime}` : "Pick a day and time"}
							isSelected={!isNow}
							onSelect={() => sending.setChoice("later")}
						/>
					</div>
					{!isNow && sending.sendAt && (
						<div className="flex flex-col gap-4 px-1 pt-1 animate-enter">
							<PickerSendTime value={sending.sendAt} onChange={sending.setSendAt} />
							<div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-muted/60 py-1 pr-1 pl-3">
								<TextSendTime value={sending.sendAt} isLastIssueTime={sending.isLastIssueTime} verb={isEmail ? "Goes out" : "Goes live"} />
								{scheduledAt && (
									<Button variant="ghost" size="sm" onClick={sending.unschedule} disabled={sending.isPending}>
										Unschedule
									</Button>
								)}
							</div>
						</div>
					)}
					{isEmail && (
						<NoticePace pace={pace} emails={paceEmails} newContacts={newContacts} gmailShare={gmailShare} isSharedSender={isSharedSender} />
					)}
				</div>
			</CardSettings>

			<DialogSegment
				newsletterId={newsletter._id}
				open={isCreatingSegment}
				onOpenChange={setIsCreatingSegment}
				onSaved={changeSegment}
			/>

			<Dialog open={sending.isConfirmOpen} onOpenChange={sending.setIsConfirmOpen}>
				<DialogContent className={sending.tips ? "sm:max-w-md" : "sm:max-w-sm"} onCloseAutoFocus={keepEditFocus}>
					{sending.tips ? (
						<ContentTips tips={sending.tips} isPending={sending.isPending} onGoAhead={sending.goAhead} onEdit={editTip} />
					) : (
						<>
							<DialogHeader>
								{isEmail ? (
									<>
										<DialogTitle className="tabular-nums">Send to {formatCount(sending.sendRecipients, "contact")}?</DialogTitle>
										<DialogDescription>
											{scheduledTime ? `It goes out now instead of ${scheduledTime}.` : "Most engaged contacts receive it first."}
											{sending.sendRecipients < sending.issueAudience && " Send it to more later from its page."}
											{publishTo === "email" && " It won't be on your website."}
										</DialogDescription>
									</>
								) : (
									<>
										<DialogTitle>Publish on your website?</DialogTitle>
										<DialogDescription>
											{scheduledTime ? `It goes live now instead of ${scheduledTime}.` : "It goes live right away."} No email goes out.
										</DialogDescription>
									</>
								)}
							</DialogHeader>
							<DialogFooter>
								<DialogClose asChild>
									<Button variant="outline">Cancel</Button>
								</DialogClose>
								<Button onClick={() => sending.send()} disabled={sending.isPending} className="min-w-20">
									{sending.isPending ? <Loader2 className="animate-spin" /> : isEmail ? "Send" : "Publish"}
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

// Everyone, or one of the newsletter's segments, picked or made here. Without a label yet, a segment just made is on
// its way from the server.
function MenuAudience({ segments, segmentId, label, isDeleted, onSegmentChange, onNewSegment, onCloseAutoFocus }) {
	const hasSegments = segments.length > 0;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={label ? `Who gets it: ${label}` : "Who gets it"}
					className={cn(
						"-ml-2 flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] data-[state=open]:bg-muted",
						isDeleted && "text-destructive"
					)}
				>
					{label ? (
						<span className="truncate">{label}</span>
					) : (
						<Loader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
					)}
					<ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" collisionPadding={12} onCloseAutoFocus={onCloseAutoFocus} className="w-72">
				<DropdownMenuRadioGroup value={segmentId ?? EVERYONE} onValueChange={(value) => onSegmentChange(value === EVERYONE ? null : value)}>
					<DropdownMenuRadioItem value={EVERYONE}>Everyone</DropdownMenuRadioItem>
					{hasSegments && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-xs text-muted-foreground">Segments</DropdownMenuLabel>
						</>
					)}
					{segments.map(({ id, name, description }) => (
						<DropdownMenuRadioItem key={id} value={id} className="items-start py-2">
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="truncate">{name}</span>
								<span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{description}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onNewSegment} className={cn(hasSegments ? "text-muted-foreground" : "items-start py-2")}>
					<Plus className={cn(!hasSegments && "mt-0.5")} />
					{hasSegments ? (
						"New segment"
					) : (
						<span className="flex flex-col gap-0.5">
							<span>New segment</span>
							<span className="text-xs text-pretty text-muted-foreground">Like your most engaged contacts</span>
						</span>
					)}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// What stopped a send or a schedule: the content check's tips, each with its fix, and the way to go ahead as it is.
function ContentTips({ tips, isPending, onGoAhead, onEdit }) {
	const isSend = tips.choice === "now";

	return (
		<>
			<DialogHeader>
				<DialogTitle>{formatCount(tips.list.length, "tip")} for more opens</DialogTitle>
				<DialogDescription>
					Spam filters tend to catch these. Change them first, or {isSend ? "send" : "schedule"} it as it is.
				</DialogDescription>
			</DialogHeader>
			<ListTips
				tips={tips.list}
				renderFix={(tip) => {
					const fix = getTipFix(tip);
					return (
						<Button variant="outline" size="sm" onClick={() => onEdit(fix)}>
							{fix.label}
						</Button>
					);
				}}
				className="-mx-4 border-t border-border/60 pt-1.5"
			/>
			<DialogFooter>
				<DialogClose asChild>
					<Button variant="outline">Cancel</Button>
				</DialogClose>
				<Button onClick={onGoAhead} disabled={isPending} className="min-w-28">
					{isPending ? <Loader2 className="animate-spin" /> : isSend ? "Send as is" : "Schedule as is"}
				</Button>
			</DialogFooter>
		</>
	);
}

function CardChoice({ icon: Icon, title, description, isSelected, isDisabled = false, onSelect }) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={isSelected}
			disabled={isDisabled}
			onClick={onSelect}
			className={cn(
				"flex items-start gap-3 rounded-lg p-3 text-left outline-none transition-[background-color,box-shadow,scale,opacity] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] disabled:pointer-events-none",
				isSelected ? "bg-muted/60 shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "shadow-border hover:bg-muted/60",
				isDisabled && !isSelected && "opacity-50"
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"mt-0.5 grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-150",
					isSelected ? "bg-foreground" : "shadow-border"
				)}
			>
				{isSelected && <span className="size-1.5 rounded-full bg-background" />}
			</span>
			<span className="min-w-0">
				<span className="flex items-center gap-1.5 text-sm font-medium">
					<Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
					{title}
				</span>
				<span className="block text-sm text-pretty text-muted-foreground tabular-nums">{description}</span>
			</span>
		</button>
	);
}

function TextSendTime({ value, isLastIssueTime, verb }) {
	const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
		.formatToParts(value)
		.find(({ type }) => type === "timeZoneName")?.value;

	return (
		<p className="text-sm text-pretty tabular-nums">
			<span className="text-muted-foreground">{verb} </span>
			<span className="font-medium">{formatSendTime(value)}</span> <span className="text-muted-foreground">{zone}</span>
			{isLastIssueTime && <span className="text-muted-foreground"> · Same time as your last issue</span>}
		</p>
	);
}

const EVERYONE = "everyone";
const PUBLISH_ICONS = { both: Layers, email: Mail, web: Globe };
