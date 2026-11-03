"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { joinTeam } from "@/app/join/actions";
import { Button } from "@/components/ui/button";

// Join on the invitation page: it answers with why it can't, or opens the newsletter.
export default function FormJoinTeam({ token, newsletterName }) {
	const [state, action, isPending] = useActionState(joinTeam, null);

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="token" value={token} />
			<Button type="submit" size="lg" disabled={isPending} className="w-full">
				{isPending ? <Loader2 className="animate-spin" /> : `Join ${newsletterName}`}
			</Button>
			{state?.error && <p className="text-center text-sm text-pretty text-destructive">{state.error}</p>}
		</form>
	);
}
