"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { sendSigninCode, verifySigninCode } from "@/app/signin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CODE_PATTERN = /^\d{6}$/;

// oauthQuery: the authorization request of an app connecting with OAuth, resumed once the code checks out. invitation:
// { token, email } from a team invitation's link: the code goes to the address it went to, which stays as it is, and
// signing in joins the team. A code's sixth digit, typed or pasted, signs in.
export default function FormSignin({ next, oauthQuery, invitation = null }) {
	const [sent, sendAction, isSending] = useActionState(sendSigninCode, null);
	const [checked, verifyAction, isVerifying] = useActionState(verifySigninCode, null);
	const [dismissed, setDismissed] = useState(null);
	const email = sent?.email && sent !== dismissed ? sent.email : null;
	const invitationField = invitation && <input type="hidden" name="invitation" value={invitation.token} />;

	function submitFullCode(event) {
		if (isVerifying || !CODE_PATTERN.test(event.target.value.replace(/\s/g, ""))) return;
		event.target.form.requestSubmit();
	}

	if (!email) {
		// React empties the form once the action returns; sent.value puts back an address to send as it is or to fix.
		const value = invitation?.email ?? sent?.value ?? dismissed?.email;
		return (
			<form action={sendAction} data-goal="signup_started" className="flex flex-col gap-3">
				{invitationField}
				<Input
					key={value}
					name="email"
					type="email"
					placeholder="Email"
					autoComplete="email"
					defaultValue={value}
					readOnly={Boolean(invitation)}
					aria-label="Email"
					required
					autoFocus={!invitation}
					className={cn("h-11", invitation && "bg-muted/60 text-muted-foreground")}
				/>
				{sent?.error && <p className="text-sm text-destructive">{sent.error}</p>}
				<Button type="submit" size="lg" disabled={isSending} autoFocus={Boolean(invitation)} className="mt-1 h-11">
					{isSending ? <Loader2 className="animate-spin" /> : "Email me a code"}
					{!isSending && <ArrowRight data-icon="inline-end" />}
				</Button>
			</form>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<form action={verifyAction} className="flex flex-col gap-3">
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="next" value={next} />
				{oauthQuery && <input type="hidden" name="oauth_query" value={oauthQuery} />}
				{invitationField}
				<p className="text-sm text-pretty text-muted-foreground">
					Enter the code sent to <span className="font-medium text-foreground">{email}</span>
				</p>
				<Input
					name="code"
					inputMode="numeric"
					autoComplete="one-time-code"
					placeholder="000000"
					maxLength={10}
					required
					autoFocus
					aria-label="Code"
					onChange={submitFullCode}
					className="h-11 text-center font-mono text-lg tracking-[0.4em] tabular-nums"
				/>
				{checked?.error && <p className="text-sm text-destructive">{checked.error}</p>}
				<Button type="submit" size="lg" disabled={isVerifying} className="h-11">
					{isVerifying ? <Loader2 className="animate-spin" /> : "Sign in"}
				</Button>
			</form>
			<div className={cn("flex items-center gap-3 text-sm", invitation ? "justify-end" : "justify-between")}>
				{!invitation && (
					<button
						type="button"
						onClick={() => setDismissed(sent)}
						className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
					>
						Use another email
					</button>
				)}
				<form action={sendAction}>
					<input type="hidden" name="email" value={email} />
					{invitationField}
					<button
						type="submit"
						disabled={isSending}
						className="text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
					>
						{isSending ? "Sending…" : "Send a new code"}
					</button>
				</form>
			</div>
		</div>
	);
}
