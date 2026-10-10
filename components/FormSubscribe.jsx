"use client";

import { useActionState, useEffect } from "react";
import { Check, Loader2, MailOpen } from "lucide-react";
import { subscribe } from "@/app/archive/actions";
import { Button } from "@/components/ui/button";
import { openSignupFlow } from "@/lib/sparkloop-embed";
import { storeValue, subscribedKey } from "@/lib/storage";
import { cn } from "@/lib/utils";

export default function FormSubscribe({ newsletterSlug, className }) {
	const [state, action, isPending] = useActionState(subscribe, null);

	useEffect(() => {
		if (state?.ok && !state.pending) storeValue(subscribedKey(newsletterSlug), 1);
		// Only a signup that went through opens SparkLoop's flow, when the archive has its script.
		if (state?.ok) openSignupFlow(state.email);
	}, [state, newsletterSlug]);

	if (state?.pending) return <CardConfirmEmail email={state.email} inbox={state.inbox} className={className} />;

	if (state?.ok) {
		return (
			<p
				role="status"
				className={cn("flex h-12 items-center justify-center gap-2 font-medium animate-enter", className)}
			>
				<span className="grid size-6 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
					<Check className="size-3.5 animate-icon-in" />
				</span>
				You&apos;re in. The next issue lands in your inbox.
			</p>
		);
	}

	return (
		<form action={action} data-sparkloop-form-ignore="" className={cn("w-full", className)}>
			<input type="hidden" name="newsletter" value={newsletterSlug} />
			<div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
				<input type="text" name="website" tabIndex={-1} autoComplete="off" />
			</div>
			<div className="flex items-center gap-1.5 rounded-xl bg-background p-1.5 shadow-border transition-shadow duration-150 focus-within:shadow-border-hover focus-within:ring-3 focus-within:ring-ring/25">
				<input
					type="email"
					name="email"
					required
					autoComplete="email"
					placeholder="you@example.com"
					aria-label="Email"
					className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none placeholder:text-muted-foreground"
				/>
				<Button type="submit" disabled={isPending} className="h-9 min-w-24 rounded-[8px] px-4">
					{isPending ? <Loader2 className="animate-spin" /> : "Subscribe"}
				</Button>
			</div>
			{state?.error && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{state.error}
				</p>
			)}
		</form>
	);
}

// Until they click the link, they get nothing: say so plainly and put their inbox one tap away.
function CardConfirmEmail({ email, inbox, className }) {
	return (
		<div
			role="status"
			className={cn(
				"w-full rounded-2xl bg-amber-50 p-5 text-left ring-1 ring-amber-500/30 animate-enter dark:bg-amber-500/10",
				className
			)}
		>
			<div className="flex items-start gap-3.5">
				<span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
					<MailOpen className="size-5 animate-icon-in" aria-hidden="true" />
					<span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full bg-red-500 ring-2 ring-amber-50 dark:ring-transparent" />
				</span>
				<div className="min-w-0">
					<p className="font-semibold text-amber-950 dark:text-amber-50">You&apos;re not subscribed yet</p>
					<p className="mt-1 text-sm leading-relaxed text-pretty text-amber-950/75 dark:text-amber-50/75">
						Click the link we just sent to{" "}
						<strong className="font-semibold break-words text-amber-950 dark:text-amber-50">{email}</strong>.
						Until you do, you won&apos;t get a single issue.
					</p>
				</div>
			</div>
			{inbox && (
				<Button asChild size="lg" className="mt-4 w-full">
					<a href={inbox.url} target="_blank" rel="noopener noreferrer">
						Open {inbox.name}
					</a>
				</Button>
			)}
			<p className="mt-3 text-xs text-amber-950/60 dark:text-amber-50/60">
				Not in your inbox? Check Promotions or Spam.
			</p>
		</div>
	);
}
