"use client";

import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import {
	ArrowRight,
	CalendarClock,
	ChevronLeft,
	CircleAlert,
	CircleX,
	Copy,
	Eye,
	FlaskConical,
	Loader2,
	MoreHorizontal,
	Send,
	Trash2,
	UserRound,
} from "lucide-react";
import { duplicateCampaign, saveCampaign, sendTestCampaign } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import CardSettings from "@/components/CardSettings";
import DialogDiscardCampaign from "@/components/DialogDiscardCampaign";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import EditorRich from "@/components/EditorRich";
import ListChecks from "@/components/ListChecks";
import NavSteps from "@/components/NavSteps";
import PanelSend from "@/components/PanelSend";
import RowCampaign from "@/components/RowCampaign";
import StatusSaved from "@/components/StatusSaved";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { getCheckFix } from "@/lib/campaign-steps";
import { markdownToHtml } from "@/lib/markdown";
import { fillSampleName, firstNameTag } from "@/lib/merge-tags";
import { getPresendChecks } from "@/lib/presend-checks";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail, withResponsiveImages } from "@/lib/render-email";
import { SEGMENT_DELETED } from "@/lib/segments";
import { toast } from "@/lib/toast";
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
	isSegmentDeleted,
	senderProblem,
	isSendingEnabled,
	testEmail,
	sendTimes,
	archiveUrlBase,
	planProblem,
	emailsLeft,
	pace,
	newContacts,
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
	});
	const save = useCallback((snapshot) => saveCampaign(campaign._id, { ...snapshot, format }), [campaign._id, format]);
	const { isDirty, isSaving, savedAt, error, flush } = useAutosave(values, save);
	const [isTesting, startTesting] = useTransition();
	const [isWorking, startWorking] = useTransition();
	const toastError = useToastError();
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const deferredValues = useDeferredValue(values);
	const isUploading = values.body.includes('src="blob:');
	const scheduledAt = campaign.status === "scheduled" ? campaign.scheduledAt : null;
	const isCompact = useMediaQuery(COMPACT_SCREEN);
	const rootRef = useRef(null);
	const subjectRef = useRef(null);
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
	const previewHtml = useMemo(
		() => withResponsiveImages(fillSampleName(rendered.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"), { isHtml: true })),
		[rendered.html]
	);
	const { checks } = getPresendChecks({
		campaign: { ...campaign, ...values },
		newsletter,
		rendered,
		senderProblem,
		isSendingEnabled,
		planProblem,
	});
	const reviewChecks = checks.map((check) => ({ ...check, fix: getCheckFix(check, { newsletterId: newsletter._id }) }));
	// Without a plan, Send and Schedule open the paywall first, and the checks wait until there's one.
	const accountProblems = hasPlan ? reviewChecks.filter(({ isAccount, isOk }) => isAccount && !isOk) : [];
	const blocking = [
		...(isUploading ? [{ id: "uploading", message: UPLOADING_MESSAGE }] : []),
		...(isSegmentDeleted ? [{ id: "segment", message: SEGMENT_DELETED }] : []),
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
		onBeforeSend: persist,
	});
	const isTestDisabled = hasPlan && !isSendingEnabled;

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

	function editField(field) {
		goToStep("write");
		const target =
			field === "subject"
				? subjectRef.current
				: field === "previewText"
					? previewTextRef.current
					: rootRef.current?.querySelector('[aria-label="Content"]');
		target?.focus({ preventScroll: true });
		target?.scrollIntoView({ block: "center" });
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

	// {{first_name|there}} where the cursor is in the subject, or at its end (lib/merge-tags.js). The button keeps the
	// focus in the subject, so its cursor is still there.
	function insertFirstName() {
		const input = subjectRef.current;
		const tag = firstNameTag();
		const isTyping = document.activeElement === input;
		const start = isTyping ? input.selectionStart : input.value.length;
		const end = isTyping ? input.selectionEnd : start;
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
			? { label: "Send now", icon: Send, reason: "send", title: "Before you send", run: () => sending.setIsConfirmOpen(true) }
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

	// Saved shows for a moment after each save, first in every step so a step change doesn't replay it.
	function renderStatus() {
		if (error) return <ButtonRetrySave error={error} onRetry={flush} />;
		const saved = <StatusSaved savedAt={savedAt} />;
		if (step !== "write") return saved;
		return (
			<>
				{saved}
				<Button
					variant="ghost"
					size="sm"
					onClick={(event) => openPreview(event.currentTarget)}
					aria-label="Preview"
					className="text-muted-foreground max-sm:px-2"
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
			<header className="sticky top-[calc(var(--plan-bar-height)+3.5rem)] z-20 -mx-4 mb-6 border-b border-border/60 bg-background/80 px-4 py-2 backdrop-blur-md md:top-(--plan-bar-height) md:-mx-10 md:px-10 lg:-mt-10 lg:mb-8 lg:grid lg:h-16 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-6 lg:border-b-0 lg:py-0">
				<div className="hidden min-w-0 lg:flex">{title}</div>
				<NavSteps step={step} onStep={goToStep} />
				<div className="hidden min-w-0 items-center justify-end gap-2 lg:flex">
					<BarAction action={action} status={renderStatus()} onEdit={editField} />
					{menu}
				</div>
			</header>

			<div className="mx-auto w-full max-w-2xl">
				{step !== "write" && accountProblems.length > 0 && <NoticeAccountProblems problems={accountProblems} />}

				<section aria-label="Write" hidden={step !== "write"}>
					<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
						<div className="divide-y divide-border/60 border-b border-border/60">
							<RowCampaign label="Subject">
								<div className="flex min-w-0 items-center gap-1">
									<input
										ref={subjectRef}
										value={values.subject}
										onChange={update("subject")}
										placeholder="Subject"
										aria-label="Subject"
										maxLength={SUBJECT_MAX}
										className="h-11 w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										onMouseDown={(event) => event.preventDefault()}
										onClick={insertFirstName}
										aria-label="Insert first name"
										title="Insert first name"
										className="-mr-2 shrink-0 text-muted-foreground"
									>
										<UserRound />
									</Button>
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
							<EditorRich content={initialBody} onChange={updateBody} />
						)}
					</div>
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
						emailsLeft={emailsLeft}
						pace={pace}
						newContacts={newContacts}
						archiveUrlBase={archiveUrlBase}
					/>
				</section>
			</div>

			{/* Below lg the step's button floats at the bottom like a save bar, clear of the support chat's button, and the
			    get-started pill steps aside for it (app/globals.css). */}
			<div
				data-save-bar={isCompact ? "" : undefined}
				data-shown={isCompact ? "" : undefined}
				className="fixed right-(--dock-right) bottom-(--dock-bottom) left-4 z-30 flex h-12 items-center rounded-xl bg-card p-1.5 pl-4 shadow-float md:left-64 lg:hidden"
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
				subject={fillSampleName(deferredValues.subject)}
				previewText={fillSampleName(deferredValues.previewText)}
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

// Above the review and send steps while the account can't send: the account's doing rather than the email's, so not
// in its checklist.
function NoticeAccountProblems({ problems }) {
	return (
		<div role="status" className="mb-6 flex flex-col gap-2 animate-enter">
			{problems.map(({ id, message, fix }) => (
				<div key={id} className="flex min-h-12 items-center gap-3 rounded-xl bg-red-500/10 py-2 pr-2 pl-4 text-sm">
					<CircleX aria-hidden="true" className="size-4 shrink-0 text-red-500" />
					<p className="min-w-0 flex-1 font-medium text-pretty">{message}</p>
					{fix?.href && (
						<Button asChild size="sm" variant="outline" className="bg-background">
							<Link href={fix.href}>{fix.label}</Link>
						</Button>
					)}
				</div>
			))}
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
		<div className={cn("flex min-w-0 items-center gap-3", className)}>
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
					<ul className="pb-2">
						{problems.map((problem) => (
							<li key={problem.id} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
								<CircleX aria-hidden="true" className="size-4 shrink-0 text-red-500" />
								<span className="min-w-0 flex-1 text-sm text-pretty">{problem.message}</span>
								{problem.fix && <ButtonFix fix={problem.fix} onEdit={fix} />}
							</li>
						))}
					</ul>
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
		<Button variant="outline" size="sm" onClick={() => onEdit(fix.field)}>
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
