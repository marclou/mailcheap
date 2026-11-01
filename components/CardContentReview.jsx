"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { approveContentReview, approveSignupEmail, rejectContentReview, rejectSignupEmail } from "@/app/admin/actions";
import BadgeStatus from "@/components/BadgeStatus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import { toast } from "@/lib/toast";

// What the automated content check found (lib/content-review.js), for admins only, and the decision on what it holds: an
// issue (campaignId), or a newsletter's own welcome, confirmation or last-chance email (newsletterId and kind). isDraft: an issue's
// check at its review step, before any send, which holds nothing yet.
export default function CardContentReview({ campaignId, newsletterId, kind, review, isPending = false, ownerEmail, isDraft = false, stagger = 6 }) {
	const status = getStatus(review, isPending, isDraft);
	const target = campaignId ? getCampaignTarget(campaignId) : getSignupEmailTarget(newsletterId, kind);
	const rows = [
		review.categories?.length > 0 && { label: "Found", value: review.categories.map((name) => name.replaceAll("_", " ")).join(", ") },
		review.reasons?.length > 0 && {
			label: "Why",
			value: (
				<ul className="flex flex-col gap-1">
					{review.reasons.map((reason) => (
						<li key={reason} className="text-pretty">
							{reason}
						</li>
					))}
				</ul>
			),
		},
		review.verdict && {
			label: "Classifier",
			value: `${review.verdict}${review.confidence != null ? ` · ${Math.round(review.confidence * 100)}% sure` : ""}`,
		},
		review.scores && Object.keys(review.scores).length > 0 && {
			label: "Moderation",
			value: Object.entries(review.scores)
				.map(([name, score]) => `${name} ${score.toFixed(2)}`)
				.join(" · "),
		},
		// What its owner saw at the review step: nothing of content it would hold.
		review.tips?.length > 0 &&
			review.outcome !== "block" && {
				label: "Tips",
				value: (
					<ul className="flex flex-col gap-1">
						{review.tips.map(({ quote, tip }) => (
							<li key={quote} className="text-pretty">
								&ldquo;{quote}&rdquo; <span className="text-muted-foreground">{tip}</span>
							</li>
						))}
					</ul>
				),
			},
		review.decision && {
			label: review.decision === "approved" ? "Approved" : "Rejected",
			value: `${review.decidedBy ?? "An admin"}, ${formatRelative(review.decidedAt)}${review.note ? ` · "${review.note}"` : ""}`,
		},
		{ label: "Checked", value: `${formatRelative(review.checkedAt)}${review.model ? ` · ${review.model}` : ""}` },
	].filter(Boolean);

	return (
		<section style={{ "--stagger": stagger }} className="mt-6 flex flex-col gap-3 animate-enter">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-sm font-medium text-muted-foreground">{isDraft ? "Content check at the review step" : "Content check"}</h2>
				<BadgeStatus status={status.tone} label={status.label} />
			</div>
			<dl className="divide-y divide-border rounded-xl bg-card text-sm shadow-border">
				{rows.map(({ label, value }) => (
					<div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-4 py-2.5">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="min-w-0">{value}</dd>
					</div>
				))}
			</dl>
			{isPending && <ActionsReview target={target} ownerEmail={ownerEmail} />}
		</section>
	);
}

// What a decision does, by what the check holds: an issue sends or stays paused, a newsletter's own email goes out or
// stays replaced.
function getCampaignTarget(campaignId) {
	return {
		approve: () => approveContentReview(campaignId),
		reject: (options) => rejectContentReview(campaignId, options),
		approveLabel: "Approve and send",
		approved: "Approved, it's going out",
		rejectTitle: "Reject this issue?",
		rejectEffect: "It stays paused for good.",
	};
}

function getSignupEmailTarget(newsletterId, kind) {
	const { name, approved, rejectEffect } = SIGNUP_EMAILS[kind] ?? SIGNUP_EMAILS.confirmation;
	return {
		approve: () => approveSignupEmail(newsletterId, kind),
		reject: (options) => rejectSignupEmail(newsletterId, kind, options),
		approveLabel: "Approve",
		approved,
		rejectTitle: `Reject this ${name} email?`,
		rejectEffect,
	};
}

// The newsletter's own emails the check reads (lib/signup-email-review.js), each by its kind.
const SIGNUP_EMAILS = {
	welcome: {
		name: "welcome",
		approved: "Approved, new subscribers get it",
		rejectEffect: "New subscribers keep getting no welcome email until it's changed.",
	},
	confirmation: {
		name: "confirmation",
		approved: "Approved, new subscribers get it",
		rejectEffect: "New subscribers keep getting the built-in confirmation email until it's changed.",
	},
	lastChance: {
		name: "last-chance",
		approved: "Approved, it goes out from the next send",
		rejectEffect: "Contacts who stopped opening keep getting the built-in last-chance email until it's changed.",
	},
};

function ActionsReview({ target, ownerEmail }) {
	const router = useRouter();
	const [isRejecting, setIsRejecting] = useState(false);
	const [isPending, startTransition] = useTransition();

	function approve() {
		startTransition(async () => {
			const result = await target.approve();
			if (result?.error) return toast.error(result.error);
			toast.success(target.approved);
			router.refresh();
		});
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button onClick={approve} disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : <Check data-icon="inline-start" />}
				{target.approveLabel}
			</Button>
			<Button variant="outline" onClick={() => setIsRejecting(true)} disabled={isPending}>
				<X data-icon="inline-start" />
				Reject
			</Button>
			<Dialog open={isRejecting} onOpenChange={setIsRejecting}>
				<DialogContent className="sm:max-w-md">
					<FormReject target={target} ownerEmail={ownerEmail} onDone={() => setIsRejecting(false)} />
				</DialogContent>
			</Dialog>
		</div>
	);
}

function FormReject({ target, ownerEmail, onDone }) {
	const router = useRouter();
	const [note, setNote] = useState("");
	const [isBlocking, setIsBlocking] = useState(false);
	const [isPending, startTransition] = useTransition();

	function reject(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await target.reject({ note, block: isBlocking });
			if (result?.error) return toast.error(result.error);
			toast.success(isBlocking ? "Rejected and account blocked" : "Rejected");
			onDone();
			router.refresh();
		});
	}

	return (
		<form onSubmit={reject} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>{target.rejectTitle}</DialogTitle>
				<DialogDescription>
					{ownerEmail ?? "Its owner"} gets an email saying it can&apos;t be sent, with your message if you write one.{" "}
					{target.rejectEffect}
				</DialogDescription>
			</DialogHeader>
			<Textarea
				value={note}
				onChange={(event) => setNote(event.target.value)}
				placeholder="Message to the owner (optional)"
				maxLength={300}
				aria-label="Message to the owner"
			/>
			<Label className="flex items-center gap-3 text-sm font-normal">
				<Switch checked={isBlocking} onCheckedChange={setIsBlocking} />
				Block the account too
			</Label>
			<DialogFooter>
				<DialogClose asChild>
					<Button variant="outline">Cancel</Button>
				</DialogClose>
				<Button type="submit" variant="destructive" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Reject"}
				</Button>
			</DialogFooter>
		</form>
	);
}

// The badge's tone by a status it knows (components/BadgeStatus.jsx), with this check's own words.
function getStatus(review, isPending, isDraft) {
	if (isPending) return { tone: "pending", label: "Waiting for you" };
	if (isDraft && review.outcome === "block") return { tone: "paused", label: "Would be held" };
	if (review.decision === "approved") return { tone: "success", label: "Approved" };
	if (review.decision === "rejected") return { tone: "blocked", label: "Rejected" };
	if (review.outcome === "flag") return { tone: "paused", label: "Flagged" };
	if (review.outcome === "error") return { tone: "none", label: "Didn't run" };
	return { tone: "success", label: "Passed" };
}
