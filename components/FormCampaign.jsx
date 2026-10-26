"use client";

import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import {
	ArrowRight,
	CalendarClock,
	ChevronLeft,
	CircleAlert,
	Copy,
	Eye,
	FlaskConical,
	Globe,
	Loader2,
	MoreHorizontal,
	Send,
	Trash2,
	UserRound,
} from "lucide-react";
import { duplicateCampaign, saveCampaign, sendTestCampaign, setCampaignPublishTo } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import CardSettings from "@/components/CardSettings";
import CardTips from "@/components/CardTips";
import DialogDiscardCampaign from "@/components/DialogDiscardCampaign";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import EditorRich from "@/components/EditorRich";
import EditorSms from "@/components/EditorSms";
import SmartphonePreview from "@/components/SmartphonePreview";
import IconField from "@/components/IconField";
import LinkHelpFields from "@/components/LinkHelpFields";
import ListChecks from "@/components/ListChecks";
import NavSteps from "@/components/NavSteps";
import NoticeSendProblems, { ListSendProblems } from "@/components/NoticeSendProblems";
import PanelSend from "@/components/PanelSend";
import RowCampaign from "@/components/RowCampaign";
import StatusSaved from "@/components/StatusSaved";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { getCheckFix, getTipFix } from "@/lib/campaign-steps";
import { toPreviewFrame } from "@/lib/email-preview";
import { formatCount } from "@/lib/format";
import { markdownToHtml } from "@/lib/markdown";
import { fieldTag, firstNameTag } from "@/lib/merge-tags";
import { getPresendChecks } from "@/lib/presend-checks";
import { readPublishTo } from "@/lib/publish-to";
import { renderEmail } from "@/lib/render-email";
import { SEGMENT_DELETED } from "@/lib/segments";
import { toast } from "@/lib/toast";
import { useCollapsedSidebar } from "@/lib/use-collapsed-sidebar";
import { useMediaQuery } from "@/lib/use-media-query";
import { usePaywall } from "@/lib/use-paywall";
import { useSendCampaign } from "@/lib/use-send-campaign";
import { useToastError } from "@/lib/use-toast-error";
import { useAutosave } from "@/lib/use-autosave";
import { cn } from "@/lib/utils";

const UPLOADING_MESSAGE = "Wait for images to finish uploading";
const SUBJECT_MAX = 200;
// Below lg, as the step bar's classes.
const COMPACT_SCREEN = "(width < 64rem)";

export default function FormCampaign({
	campaign,
	newsletter,
	audienceCount,
	everyoneCount,
	segments,
	contactFields = [],
	isSegmentDeleted,
	senderProblem,
	isSharedSender = false,
	domainNudge = null,
	isSendingEnabled,
	testEmail,
	sendTimes,
	archiveUrlBase,
	planProblem,
	emailsLeft,
	pace,
	newContacts,
	gmailShare = 0,
	tips: storedTips = [],
}) {
	const isHtml = campaign.format === "html";
	const [step, setStep] = useState("write");
	const [isDiscardOpen, setIsDiscardOpen] = useState(false);
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const format = isHtml ? "html" : "rich";
	const [initialBody] = useState(() =>
		campaign.format === "markdown" ? markdownToHtml(campaign.markdown) : campaign.html
	);
	const [values, setValues] = useState({
		subject: campaign.subject,
		previewText: campaign.previewText,
		body: initialBody,
		channel: campaign.channel || "email",
		smsText: campaign.smsText || "",
	});
	const save = useCallback((snapshot) => saveCampaign(campaign._id, { ...snapshot, format }), [campaign._id, format]);
	const { isDirty, isSaving, savedAt, error, flush } = useAutosave(values, save);
	// The content check's tips for the draft as it is: the page's, or those a send or a schedule stopped for. A change
	// hides them, and the next send or schedule checks again.
	const [knownTips, setKnownTips] = useState(() => ({ values, list: storedTips }));
	useCollapsedSidebar();
	const [isTesting, startTesting] = useTransition();
	const [isWorking, startWorking] = useTransition();
	const [publishTo, setPublishTo] = useState(() => readPublishTo(campaign));
	const [isChangingPublishTo, startChangingPublishTo] = useTransition();
	const isWebOnly = publishTo === "web";
	const toastError = useToastError();
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const deferredValues = useDeferredValue(values);
	// The editor's own pictures: an HTML block's code is text.
	const isUploading = /<img\b[^>]*\ssrc="blob:/.test(values.body);
	const scheduledAt = campaign.status === "scheduled" ? campaign.scheduledAt : null;
	const isCompact = useMediaQuery(COMPACT_SCREEN);
	const rootRef = useRef(null);
	const subjectRef = useRef(null);
	const subjectSelectionRef = useRef(null);
	const previewTextRef = useRef(null);
	const previewOpenerRef = useRef(null);
	const scrollsRef = useRef({});

	async function persist() {
		if (await flush()) return true;
		toast.error("Couldn't save the draft");
		return false;
	}

	const rendered = useMemo(
		() =>
			renderEmail({
				format,
				html: deferredValues.body,
				subject: deferredValues.subject,
				previewText: deferredValues.previewText,
				newsletter,
			}),
		[format, deferredValues, newsletter]
	);
	const previewHtml = useMemo(() => toPreviewFrame(rendered.html), [rendered.html]);
	const { checks } = getPresendChecks({
		campaign: { ...campaign, ...values, publishTo },
		newsletter,
		rendered,
		contactFields,
		senderProblem,
		isSharedSender,
		isSendingEnabled,
		planProblem,
	});
	const reviewChecks = checks.map((check) => ({ ...check, fix: getCheckFix(check, { newsletterId: newsletter._id }) }));
	const blocking = [
		...(isUploading ? [{ id: "uploading", message: UPLOADING_MESSAGE }] : []),
		...(isSegmentDeleted && !isWebOnly ? [{ id: "segment", message: SEGMENT_DELETED }] : []),
		...reviewChecks.filter(({ isOk, isWarning }) => !isOk && !isWarning),
	];
	const sending = useSendCampaign({
		campaignId: campaign._id,
		audienceCount,
		audienceLimit: campaign.audienceLimit,
		emailsLeft,
		scheduledAt,
		isCleanupEnabled: Boolean(newsletter.cleanup?.enabled),
		sendTimes,
		blocking,
		hasPlan,
		isWebOnly,
		onBeforeSend: persist,
		onTips: (list) => setKnownTips({ values, list }),
	});
	// A web-only issue goes to no inbox.
	const tips = knownTips.values === values && !isWebOnly ? knownTips.list : [];
	// The account's doing rather than the email's, so above the review and send steps instead of in the checklist; the
	// send step adds the plan's emails a send now would go over. Without a plan, Send and Schedule open the paywall
	// first, and the checks wait until there's one.
	const accountProblems = hasPlan ? (step === "send" ? sending.problems : blocking).filter(({ isAccount }) => isAccount) : [];
	const isTestDisabled = hasPlan && !isSendingEnabled;

	// Saved right away, like the segment: the send step and the checks follow it.
	function changePublishTo(next) {
		const previous = publishTo;
		if (next === previous) return;
		setPublishTo(next);
		startChangingPublishTo(async () => {
			const result = await setCampaignPublishTo(campaign._id, next);
			if (result?.error) {
				setPublishTo(previous);
				return void toast.error(result.error);
			}
			if (previous === "web") sending.prepare();
		});
	}

	function sendTest() {
		if (!hasPlan) return paywall.open("test");
		startTesting(async () => {
			if (isUploading) return void toast.error(UPLOADING_MESSAGE);
			if (!(await persist())) return;
			const result = await sendTestCampaign(campaign._id);
			if (result?.error) toastError(result);
			else toast.success(`Test sent to ${testEmail}`);
		});
	}

	function runAction(action) {
		startWorking(async () => {
			const result = await action(campaign._id);
			if (result?.error) toast.error(result.error);
		});
	}

	// Each step keeps its own scroll, so going back to the draft lands where the writing was.
	function goToStep(next) {
		if (next === step) return;
		scrollsRef.current[step] = window.scrollY;
		if (next === "send") sending.prepare();
		flushSync(() => setStep(next));
		window.scrollTo({ top: scrollsRef.current[next] ?? 0 });
	}

	// words: a tip's, selected where the field has them as they are, so typing replaces them.
	function editField(field, words) {
		goToStep("write");
		const target =
			field === "subject"
				? subjectRef.current
				: field === "previewText"
					? previewTextRef.current
					: rootRef.current?.querySelector('[aria-label="Content"]');
		target?.focus({ preventScroll: true });
		target?.scrollIntoView({ block: "center" });
		const start = words && typeof target?.value === "string" ? target.value.toLowerCase().indexOf(words.toLowerCase()) : -1;
		if (start >= 0) target.setSelectionRange(start, start + words.length);
	}

	// opener: what gets the focus back once the preview closes.
	function openPreview(opener) {
		previewOpenerRef.current = opener;
		setIsPreviewOpen(true);
	}

	const onKeyDown = useEffectEvent((event) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			flush();
		}
	});
	const onBeforeUnload = useEffectEvent((event) => {
		if (!isDirty && !isSaving) return;
		flush();
		event.preventDefault();
	});

	useEffect(() => {
		function handleKeyDown(event) {
			onKeyDown(event);
		}
		function handleBeforeUnload(event) {
			onBeforeUnload(event);
		}
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, []);

	function update(key) {
		return (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
	}

	// A merge tag (lib/merge-tags.js) where the cursor last was in the subject, or at its end if it never was there: the
	// fields' menu takes the focus, so the subject's selection is kept as it changes.
	function insertTag(tag) {
		const input = subjectRef.current;
		const [start, end] = (subjectSelectionRef.current ?? [input.value.length, input.value.length]).map((index) =>
			Math.min(index, input.value.length)
		);
		const subject = `${input.value.slice(0, start)}${tag}${input.value.slice(end)}`.slice(0, SUBJECT_MAX);
		setValues((current) => ({ ...current, subject }));
		requestAnimationFrame(() => {
			input.focus();
			input.setSelectionRange(start + tag.length, start + tag.length);
		});
	}

	const updateBody = useCallback((body) => setValues((current) => ({ ...current, body })), []);

	const sendAction =
		sending.choice === "now"
			? {
					label: isWebOnly ? "Publish now" : "Send now",
					icon: isWebOnly ? Globe : Send,
					reason: "send",
					title: isWebOnly ? "Before you publish" : "Before you send",
					run: () => sending.setIsConfirmOpen(true),
				}
			: { label: "Schedule", icon: CalendarClock, reason: "schedule", title: "Before you schedule", run: sending.schedule };
	const action = {
		write: { label: "Next: review", icon: ArrowRight, isIconAfter: true, onClick: () => goToStep("review") },
		review: { label: "Next: send", icon: ArrowRight, isIconAfter: true, onClick: () => goToStep("send") },
		send: {
			label: sendAction.label,
			icon: sendAction.icon,
			onClick: () => (hasPlan ? sendAction.run() : paywall.open(sendAction.reason)),
			problems: sending.problems,
			problemsTitle: sendAction.title,
			isPending: sending.isPending,
		},
	}[step];

	// Saved shows for a moment after each save, first in every step so a step change doesn't replay it. In the top bar its
	// place stays taken: where the bar is tight, the steps would shift each time it shows.
	function renderStatus() {
		if (error) return <ButtonRetrySave error={error} onRetry={flush} />;
		const saved = (
			<span className="lg:flex lg:min-w-14 lg:justify-end">
				<StatusSaved savedAt={savedAt} />
			</span>
		);
		if (step !== "write") return saved;
		return (
			<>
				{saved}
				<Button
					variant="outline"
					onClick={(event) => openPreview(event.currentTarget)}
					aria-label="Preview"
					className="max-sm:w-9 max-sm:px-0"
				>
					<Eye data-icon="inline-start" />
					<span className="max-sm:sr-only">Preview</span>
				</Button>
			</>
		);
	}

	const title = <TitleCampaign title={values.subject} newsletter={newsletter} status={campaign.status} />;
	const menu = (
		<MenuMore
			isWorking={isWorking}
			isTesting={isTesting}
			isTestDisabled={isTestDisabled}
			onTest={sendTest}
			onPreview={openPreview}
			onDuplicate={() => runAction(duplicateCampaign)}
			onDiscard={() => setIsDiscardOpen(true)}
		/>
	);

	return (
		<div ref={rootRef} data-campaign-steps className="pb-(--step-bar-space) lg:pb-0">
			{/* Phones and tablets: the title and the menu first, then the steps, which stick under the top bar. */}
			<div className="mb-4 flex items-center gap-2 animate-enter lg:hidden">
				{title}
				{menu}
			</div>
			<header className="sticky top-[calc(var(--plan-bar-height)+3.5rem)] z-20 -mx-4 mb-6 border-b border-border/60 bg-background/80 px-4 py-2 backdrop-blur-md md:top-(--plan-bar-height) md:-mx-10 md:px-10 lg:-mt-10 lg:mb-8 lg:grid lg:h-16 lg:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] lg:items-center lg:gap-6 lg:border-b-0 lg:py-0">
				<div className="hidden min-w-0 lg:flex">{title}</div>
				<NavSteps step={step} onStep={goToStep} />
				<div className="hidden min-w-0 items-center justify-end gap-2 lg:flex">
					<BarAction action={action} status={renderStatus()} onEdit={editField} />
					{menu}
				</div>
			</header>

			<div className="mx-auto w-full max-w-2xl">
				{step !== "write" && accountProblems.length > 0 && (
					<NoticeSendProblems
						problems={accountProblems}
						renderFix={({ fix }) => fix && <ButtonFix fix={fix} onEdit={editField} />}
						className="mb-6 animate-enter"
					/>
				)}

				<section aria-label="Write" hidden={step !== "write"}>
					<div className="mb-4 flex items-center justify-between">
						<div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs">
							<button
								type="button"
								onClick={() => setValues((v) => ({ ...v, channel: "email" }))}
								className={cn(
									"rounded-md px-3 py-1 font-medium transition-colors",
									values.channel === "email" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
								)}
							>
								Email
							</button>
							<button
								type="button"
								onClick={() => setValues((v) => ({ ...v, channel: "sms" }))}
								className={cn(
									"rounded-md px-3 py-1 font-medium transition-colors",
									values.channel === "sms" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
								)}
							>
								SMS
							</button>
						</div>
					</div>

					{values.channel === "sms" ? (
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,300px]">
							<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
								<EditorSms
									value={values.smsText}
									onChange={(smsText) => setValues((v) => ({ ...v, smsText }))}
								/>
							</div>
							<div className="hidden lg:block">
								<SmartphonePreview
									message={values.smsText}
									senderName={newsletter.name || "MailCheap"}
								/>
							</div>
						</div>
					) : (
						<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
							<div className="divide-y divide-border/60 border-b border-border/60">
								<RowCampaign label="Subject">
									<div className="flex min-w-0 items-center gap-1">
										<input
											ref={subjectRef}
											value={values.subject}
											onChange={update("subject")}
											onSelect={(event) => (subjectSelectionRef.current = [event.target.selectionStart, event.target.selectionEnd])}
											placeholder="Subject"
											aria-label="Subject"
											maxLength={SUBJECT_MAX}
											className="h-11 w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
										/>
										<ButtonInsertTag contactFields={contactFields} onInsert={insertTag} />
									</div>
								</RowCampaign>
								<RowCampaign label="Preview text">
									<input
										ref={previewTextRef}
										value={values.previewText}
										onChange={update("previewText")}
										placeholder="Shown after the subject in inboxes"
										aria-label="Preview text"
										maxLength={300}
										className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
									/>
								</RowCampaign>
							</div>
							{isHtml ? (
								<div className="relative">
									<span className="pointer-events-none absolute top-3 right-4 text-xs text-muted-foreground">HTML</span>
									<textarea
										value={values.body}
										onChange={update("body")}
										placeholder="<html>"
										spellCheck={false}
										aria-label="Content"
										className="block min-h-[560px] w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
									/>
								</div>
							) : (
								<EditorRich content={initialBody} onChange={updateBody} contactFields={contactFields} newsletter={newsletter} />
							)}
						</div>
					)}
				</section>

				<section aria-label="Review" hidden={step !== "review"} className="flex flex-col gap-6">
					<ListChecks
						checks={reviewChecks.filter(({ isAccount }) => !isAccount)}
						renderFix={({ fix }) =>
							fix && (
								<ButtonFix
									fix={fix}
									onEdit={editField}
									onTest={sendTest}
									isTesting={isTesting}
									isTestDisabled={isTestDisabled}
								/>
							)
						}
					/>
					{tips.length > 0 && <CardTips tips={tips} renderFix={(tip) => <ButtonFix fix={getTipFix(tip)} onEdit={editField} />} />}
					<p role="status" className="sr-only">
						{tips.length > 0 ? `${formatCount(tips.length, "tip")} for more opens` : ""}
					</p>
					<CardSettings title="Test and preview" stagger={1}>
						<ButtonRow
							icon={FlaskConical}
							title="Send a test email"
							description={isTestDisabled ? "Sending is off" : `Goes to ${testEmail}`}
							onClick={sendTest}
							isDisabled={isTestDisabled}
							isPending={isTesting}
						/>
						<ButtonRow
							icon={Eye}
							title="Preview"
							description="On desktop and mobile, at their real width"
							onClick={(event) => openPreview(event.currentTarget)}
						/>
					</CardSettings>
				</section>

				<section aria-label="Send" hidden={step !== "send"}>
					<PanelSend
						sending={sending}
						campaign={campaign}
						newsletter={newsletter}
						subject={values.subject}
						everyoneCount={everyoneCount}
						segments={segments}
						isSegmentDeleted={isSegmentDeleted}
						pace={pace}
						newContacts={newContacts}
						gmailShare={gmailShare}
						isSharedSender={isSharedSender}
						archiveUrlBase={archiveUrlBase}
						publishTo={publishTo}
						onPublishToChange={changePublishTo}
						isChangingPublishTo={isChangingPublishTo}
						websiteHref={getCheckFix({ id: "website" }, { newsletterId: newsletter._id })?.href}
						domainNudge={domainNudge}
						onEdit={editField}
					/>
				</section>
			</div>

			{/* Below lg the step's button floats at the bottom like a save bar, clear of the support chat's button, and the
			    get-started pill steps aside for it (app/globals.css). */}
			<div
				data-save-bar={isCompact ? "" : undefined}
				data-shown={isCompact ? "" : undefined}
				className="fixed right-(--dock-right) bottom-(--dock-bottom) left-4 z-30 flex h-12 items-center rounded-xl bg-card p-1.5 pl-4 shadow-float transition-[left] duration-250 ease-drawer motion-reduce:transition-none md:left-[calc(var(--sidebar-width)+1rem)] lg:hidden"
			>
				<BarAction action={action} status={renderStatus()} onEdit={editField} side="top" className="w-full" />
			</div>

			<DialogPreviewEmail
				isOpen={isPreviewOpen}
				onOpenChange={setIsPreviewOpen}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					previewOpenerRef.current?.focus();
				}}
				html={previewHtml}
				sender={newsletter}
				subject={deferredValues.subject}
				previewText={deferredValues.previewText}
				newsletterId={newsletter._id}
				contactFields={contactFields}
			/>
			<DialogDiscardCampaign
				id={campaign._id}
				subject={values.subject}
				scheduledAt={scheduledAt}
				isOpen={isDiscardOpen}
				onOpenChange={setIsDiscardOpen}
				redirectTo="/campaigns"
			/>
		</div>
	);
}

function TitleCampaign({ title, newsletter, status }) {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<Link
				href="/campaigns"
				aria-label="Back"
				className="-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
			>
				<ChevronLeft className="size-5" />
			</Link>
			<AvatarNewsletter newsletter={newsletter} size={24} />
			<h1 className="truncate text-lg font-semibold tracking-tight lg:text-base">{title || "Untitled"}</h1>
			<BadgeStatus status={status} />
		</div>
	);
}

// The subject's merge tags: the first name in one click, or with the account's own fields, a menu of them all that ends
// on how to add them. Once one is picked, the subject keeps the focus onInsert gives it, instead of the menu's button.
function ButtonInsertTag({ contactFields, onInsert }) {
	const isInsertingRef = useRef(false);
	const className = "-mr-2 shrink-0 text-muted-foreground";

	if (contactFields.length === 0) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => onInsert(firstNameTag())}
				aria-label="Insert first name"
				title="Insert first name"
				className={className}
			>
				<UserRound />
			</Button>
		);
	}

	function insert(tag) {
		isInsertingRef.current = true;
		onInsert(tag);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Insert a first name or a field"
					title="Insert a first name or a field"
					className={className}
				>
					<UserRound />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-56"
				onCloseAutoFocus={(event) => {
					if (isInsertingRef.current) event.preventDefault();
					isInsertingRef.current = false;
				}}
			>
				<DropdownMenuItem onSelect={() => insert(firstNameTag())}>
					<UserRound />
					First name
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Your fields</DropdownMenuLabel>
				{contactFields.map((field) => (
					<DropdownMenuItem key={field.key} onSelect={() => insert(fieldTag(field.key))}>
						<IconField type={field.type} />
						<span className="min-w-0 truncate">{field.label}</span>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild className="gap-2 text-xs text-muted-foreground">
					<LinkHelpFields />
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// The test and the preview from any step. A dialog opened from here keeps the focus the menu would give back to its
// button as it closes; the preview hands it to that button once it closes, as the item that opened it is gone.
function MenuMore({ isWorking, isTesting, isTestDisabled, onTest, onPreview, onDuplicate, onDiscard }) {
	const triggerRef = useRef(null);
	const isOpeningDialogRef = useRef(false);

	function openDialog(open) {
		isOpeningDialogRef.current = true;
		open();
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button ref={triggerRef} variant="ghost" size="icon" aria-label="More" disabled={isWorking}>
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="w-52">
				<DropdownMenuItem onSelect={onTest} disabled={isTestDisabled || isTesting}>
					{isTesting ? <Loader2 className="animate-spin" /> : <FlaskConical />}
					Send a test email
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => openDialog(() => onPreview(triggerRef.current))}>
					<Eye />
					Preview
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onDuplicate}>
					<Copy />
					Duplicate
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onSelect={() => openDialog(onDiscard)}>
					<Trash2 />
					Discard
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// The step's one button, with the step's status next to it; the width doesn't change from a step to the next. What
// stops it shows when it's pressed, each with its fix. A fix keeps the focus it moves; otherwise it goes back to the button.
function BarAction({ action, status, onEdit, side = "bottom", className }) {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef(null);
	const isFixingRef = useRef(false);
	const Icon = action.icon;
	const problems = action.problems ?? [];

	function fix(field) {
		isFixingRef.current = true;
		setIsOpen(false);
		onEdit(field);
	}

	function returnFocus(event) {
		event.preventDefault();
		if (!isFixingRef.current) buttonRef.current?.focus();
		isFixingRef.current = false;
	}

	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)}>
			<div className="flex min-w-0 flex-1 items-center justify-start gap-1 lg:justify-end">{status}</div>
			<Popover open={isOpen && problems.length > 0} onOpenChange={setIsOpen}>
				<PopoverAnchor asChild>
					<Button
						ref={buttonRef}
						onClick={() => (problems.length > 0 ? setIsOpen(true) : action.onClick())}
						disabled={action.isPending}
						aria-haspopup={problems.length > 0 ? "dialog" : undefined}
						className="min-w-32"
					>
						{action.isPending ? (
							<Loader2 className="animate-spin" />
						) : action.isIconAfter ? (
							<>
								{action.label}
								<Icon data-icon="inline-end" />
							</>
						) : (
							<>
								<Icon data-icon="inline-start" />
								{action.label}
							</>
						)}
					</Button>
				</PopoverAnchor>
				<PopoverContent side={side} align="end" onCloseAutoFocus={returnFocus} className="w-80 p-0">
					<p className="px-4 pt-3.5 pb-1 text-sm font-medium">{action.problemsTitle}</p>
					<ListSendProblems
						problems={problems}
						renderFix={(problem) => problem.fix && <ButtonFix fix={problem.fix} onEdit={fix} />}
						className="px-4 pb-2"
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function ButtonFix({ fix, onEdit, onTest, isTesting, isTestDisabled }) {
	if (fix.href) {
		return (
			<Button asChild variant="outline" size="sm">
				<Link href={fix.href}>{fix.label}</Link>
			</Button>
		);
	}
	if (fix.action === "test") {
		return (
			<Button variant="outline" size="sm" onClick={onTest} disabled={isTestDisabled || isTesting} className="min-w-24">
				{isTesting ? <Loader2 className="animate-spin" /> : fix.label}
			</Button>
		);
	}
	return (
		<Button variant="outline" size="sm" onClick={() => onEdit(fix.field, fix.words)}>
			{fix.label}
		</Button>
	);
}

function ButtonRow({ icon: Icon, title, description, onClick, isDisabled = false, isPending = false }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={isDisabled || isPending}
			className="group/row flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 disabled:pointer-events-none disabled:opacity-50"
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
				<Icon className="size-4" aria-hidden="true" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium">{title}</span>
				<span className="block truncate text-sm text-muted-foreground">{description}</span>
			</span>
			{isPending ? (
				<Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
			) : (
				<ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover/row:translate-x-0.5" />
			)}
		</button>
	);
}

// Stays until a save goes through, unlike Saved.
function ButtonRetrySave({ error, onRetry }) {
	return (
		<button type="button" onClick={onRetry} title={error} className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
			<CircleAlert className="size-3.5" />
			Not saved, retry
		</button>
	);
}
