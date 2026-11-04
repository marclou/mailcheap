import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleCampaign, sendCampaign, unscheduleCampaign } from "@/app/(app)/campaigns/actions";
import { countRecipients } from "@/components/InputAudienceLimit";
import { getSendProblems } from "@/lib/campaign-steps";
import { summarizePreview } from "@/lib/cleanup";
import { showConfetti } from "@/lib/confetti";
import { formatSendTime } from "@/lib/format";
import { getScheduleProblem, getScheduleSuggestions } from "@/lib/schedule";
import { toast } from "@/lib/toast";
import { useCleanupPreview } from "@/lib/use-cleanup-preview";
import { useToastError } from "@/lib/use-toast-error";

const FALLBACK_MINUTES = 9 * 60;

// The send step (FormCampaign): who gets the issue, now or at a time, and what sending and scheduling do. blocking:
// what stops any send, each with its fix (lib/campaign-steps.js). limit: the cap the campaign was scheduled with
// through the API or an earlier send, which the dashboard can only remove; empty for everyone. isWebOnly: it goes on
// the website and sends nothing, so it has no audience, limit or plan emails. A send or a schedule first stops for
// the content check's tips, if it has any: they show in the send dialog, and onTips gets them too.
export function useSendCampaign({
	campaignId,
	audienceCount,
	audienceLimit,
	emailsLeft,
	scheduledAt,
	isCleanupEnabled,
	sendTimes,
	blocking,
	hasPlan,
	isWebOnly = false,
	onBeforeSend,
	onTips,
}) {
	const router = useRouter();
	const toastError = useToastError();
	const { preview, isCounting, loadPreview } = useCleanupPreview(campaignId);
	const [choice, setChoice] = useState(scheduledAt ? "later" : "now");
	const [limit, setLimit] = useState(audienceLimit ? String(audienceLimit) : "");
	const [sendAt, setSendAt] = useState(null);
	const [lastIssueAt, setLastIssueAt] = useState(null);
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	// What stopped the last send or schedule (choice: which one), until its dialog closes.
	const [tips, setTips] = useState(null);
	const [isPending, startPending] = useTransition();
	// With the list cleanup on, cold contacts get the last-chance email instead and don't count.
	const summary = preview?.enabled ? summarizePreview(preview, Number.parseInt(limit, 10)) : null;
	const issueAudience = preview?.enabled ? preview.issue : audienceCount;
	const sendRecipients = summary ? summary.issue : countRecipients(limit, audienceCount);
	const sendEmails = sendRecipients + (summary?.lastChance ?? 0);
	const scheduleRecipients = countRecipients(limit, audienceCount);
	const problems = getSendProblems({
		hasPlan,
		choice,
		blocking,
		scheduleProblem: getScheduleProblem(sendAt),
		sendEmails,
		scheduleRecipients,
		emailsLeft,
		isWebOnly,
	});
	const sendLimit = isWebOnly ? undefined : Number.parseInt(limit, 10) || undefined;

	// Each time the step opens: the cleanup count reads the whole list. The time starts on the weekday and time of the
	// last issue, the next time it comes around.
	function prepare() {
		if (isCleanupEnabled && !isWebOnly) loadPreview();
		const suggested = getScheduleSuggestions(sendTimes).find(({ isLastIssue }) => isLastIssue);
		setLastIssueAt(suggested?.at ?? null);
		setSendAt((current) => current ?? (scheduledAt ? new Date(scheduledAt) : (suggested?.at ?? tomorrowAt(FALLBACK_MINUTES))));
	}

	function openConfirm(isOpen) {
		setIsConfirmOpen(isOpen);
		if (!isOpen) setTips(null);
	}

	function stopForTips(list, tipsChoice) {
		setTips({ list, choice: tipsChoice });
		setIsConfirmOpen(true);
		onTips?.(list);
	}

	// checkTips: false to go ahead as it is, once its tips were shown.
	function send({ checkTips = true } = {}) {
		startPending(async () => {
			if (!(await onBeforeSend())) return;
			const result = await sendCampaign(campaignId, { audienceLimit: sendLimit, checkTips });
			if (result?.error) return toastError(result);
			if (result?.tips) return stopForTips(result.tips, "now");
			openConfirm(false);
			if (result?.held) toast.success("Under review: it goes out once it's checked");
			else {
				toast.success(isWebOnly ? "Published on your website" : "Sending started");
				showConfetti();
			}
			router.refresh();
		});
	}

	function schedule({ checkTips = true } = {}) {
		startPending(async () => {
			if (!(await onBeforeSend())) return;
			const result = await scheduleCampaign(campaignId, { scheduledAt: sendAt.toISOString(), audienceLimit: sendLimit, checkTips });
			if (result?.error) return toastError(result);
			if (result?.tips) return stopForTips(result.tips, "later");
			openConfirm(false);
			toast.success(`Scheduled for ${formatSendTime(sendAt)}`);
			router.refresh();
		});
	}

	function goAhead() {
		if (tips?.choice === "later") schedule({ checkTips: false });
		else send({ checkTips: false });
	}

	function unschedule() {
		startPending(async () => {
			const result = await unscheduleCampaign(campaignId);
			if (result?.error) return toast.error(result.error);
			toast.success("Unscheduled, it's a draft again");
			router.refresh();
		});
	}

	return {
		choice,
		setChoice,
		limit,
		setLimit,
		sendAt,
		setSendAt,
		isLastIssueTime: Boolean(sendAt && lastIssueAt && sendAt.getTime() === lastIssueAt.getTime()),
		preview,
		isCounting,
		summary,
		issueAudience,
		sendRecipients,
		sendEmails,
		scheduleRecipients,
		problems,
		isConfirmOpen,
		setIsConfirmOpen: openConfirm,
		tips,
		isPending,
		prepare,
		send,
		schedule,
		goAhead,
		unschedule,
	};
}

function tomorrowAt(minutes) {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, Math.floor(minutes / 60), minutes % 60);
}
