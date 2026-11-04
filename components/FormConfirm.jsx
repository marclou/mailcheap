"use client";

import { startTransition, useActionState, useEffect } from "react";
import { Link2Off, Loader2, MailCheck } from "lucide-react";
import { confirmSubscription } from "@/app/confirm/actions";
import CardNotice from "@/components/CardNotice";
import { Button } from "@/components/ui/button";

// Confirms once the page's script runs, so a link scanner that only loads the page doesn't. No <form>: posted without
// the script from this page, which sends no referrer, it would come with Origin: null, which Next.js refuses with an
// error, and some scanners post forms that way.
export default function FormConfirm({ token, newsletterName, fromName, fromEmail, archiveUrl }) {
	const [state, confirm, isPending] = useActionState(confirmSubscription.bind(null, token), null);

	useEffect(() => {
		startTransition(confirm);
	}, [confirm]);

	if (state?.ok) {
		return (
			<CardNotice icon={MailCheck} tone="success" title="You're in">
				The next issue of {newsletterName} comes from{" "}
				<span className="font-medium text-foreground">{fromName || fromEmail}</span>
				{fromName && ` (${fromEmail})`}. If it lands in Promotions, drag it to Primary.
				{archiveUrl && (
					<Button asChild size="lg" variant="outline" className="mt-6 w-full">
						<a href={archiveUrl}>Read past issues</a>
					</Button>
				)}
			</CardNotice>
		);
	}

	if (state?.error) {
		return (
			<CardNotice icon={Link2Off} title="This link doesn't work">
				It may be older than 30 days. Sign up again and use the newest confirmation email.
			</CardNotice>
		);
	}

	return (
		<CardNotice
			icon={isPending ? Loader2 : MailCheck}
			spin={isPending}
			title={`Confirm your subscription to ${newsletterName}`}
		>
			One click and the next issue lands in your inbox.
			<Button size="lg" disabled={isPending} onClick={() => startTransition(confirm)} className="mt-6 w-full">
				{isPending ? "Confirming…" : "Confirm my subscription"}
			</Button>
		</CardNotice>
	);
}
