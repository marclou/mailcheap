"use client";

import { useActionState } from "react";
import { ArrowUpRight, KeyRound, Loader2, UserPlus } from "lucide-react";
import { connectSparkLoop } from "@/app/(app)/sparkloop/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SPARKLOOP_SIGNUP_URL, SPARKLOOP_URLS } from "@/lib/sparkloop-content";

// Two steps: an account (free, through the signup link), then its API key.
export default function CardConnectSparkLoop({ note }) {
	const [state, action, isPending] = useActionState(connectSparkLoop, null);

	return (
		<section className="overflow-hidden rounded-2xl bg-card shadow-border">
			<div className="grid divide-y divide-border/60 md:grid-cols-2 md:divide-x md:divide-y-0">
				<div className="flex flex-col gap-3 p-5 sm:p-6">
					<StepNumber icon={UserPlus} step={1} />
					<div>
						<h3 className="font-semibold tracking-tight">Create a free SparkLoop account</h3>
						<p className="mt-1 text-sm text-pretty text-muted-foreground">
							Add your newsletter as a publication. When SparkLoop asks for your email platform, pick{" "}
							<strong className="font-medium text-foreground">Custom ESP</strong>. Already have an account? Skip to step 2.
						</p>
					</div>
					<Button asChild variant="outline" className="mt-auto w-fit">
						<a href={SPARKLOOP_SIGNUP_URL} target="_blank" rel="noopener">
							Sign up on SparkLoop
							<ArrowUpRight data-icon="inline-end" />
						</a>
					</Button>
				</div>

				<form action={action} className="flex flex-col gap-3 p-5 sm:p-6">
					<StepNumber icon={KeyRound} step={2} />
					<div>
						<h3 className="font-semibold tracking-tight">Connect it to Mailcheap</h3>
						<p className="mt-1 text-sm text-pretty text-muted-foreground">
							In SparkLoop, open{" "}
							<a
								href={SPARKLOOP_URLS.apiKey}
								target="_blank"
								rel="noopener"
								className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
							>
								Settings → Integrations
							</a>{" "}
							and copy your API key. It&apos;s stored encrypted in your database.
						</p>
					</div>
					<div className="mt-auto flex flex-col gap-2 sm:flex-row">
						<Input
							name="apiKey"
							type="password"
							required
							autoComplete="off"
							spellCheck={false}
							placeholder="SparkLoop API key"
							aria-label="SparkLoop API key"
							className="font-mono placeholder:font-sans"
						/>
						<Button type="submit" disabled={isPending} className="min-w-24">
							{isPending ? <Loader2 className="animate-spin" /> : "Connect"}
						</Button>
					</div>
					{state?.error && (
						<p role="alert" className="text-sm text-destructive">
							{state.error}
						</p>
					)}
				</form>
			</div>
			{note && (
				<p className="border-t border-border/60 bg-muted/40 px-5 py-3 text-xs text-pretty text-muted-foreground sm:px-6">
					{note}
				</p>
			)}
		</section>
	);
}

function StepNumber({ icon: Icon, step }) {
	return (
		<span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<span className="grid size-7 place-items-center rounded-lg bg-muted text-foreground">
				<Icon className="size-3.5" />
			</span>
			Step {step}
		</span>
	);
}
