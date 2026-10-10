"use client";

import { useState, useTransition } from "react";
import { Archive, Check, Handshake, Loader2, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { manageSparkLoop } from "@/app/(app)/sparkloop/actions";
import { Button } from "@/components/ui/button";

// Server pages render these, so icons go by name: components can't cross into the client.
const ICONS = { add: Plus, archive: Archive, restore: Undo2, swap: Handshake };

// One change on the SparkLoop account (add, archive, bring back…); the page refreshes with the result.
// confirm asks first, for a change that reaches another publisher; undo is the action that reverses it,
// offered in the toast; doneLabel replaces the button once it worked, when the page can't show it.
export default function ButtonSparkLoop({
	newsletterId,
	action,
	uuid,
	success,
	confirm,
	undo,
	doneLabel,
	icon,
	children,
	...props
}) {
	const [isPending, startTransition] = useTransition();
	const [isDone, setIsDone] = useState(false);
	const Icon = ICONS[icon];

	function run(name = action, message = success) {
		startTransition(async () => {
			const result = await manageSparkLoop(newsletterId, name, uuid);
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			if (doneLabel) setIsDone(true);
			if (message) {
				toast.success(message, name === action && undo ? { action: { label: "Undo", onClick: () => run(undo, "Undone") } } : undefined);
			}
		});
	}

	if (isDone) {
		return (
			<Button type="button" variant="ghost" size="sm" disabled {...props}>
				<Check data-icon="inline-start" />
				{doneLabel}
			</Button>
		);
	}

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => (!confirm || window.confirm(confirm)) && run()}
			disabled={isPending}
			{...props}
		>
			{isPending ? <Loader2 className="animate-spin" /> : Icon && <Icon data-icon="inline-start" />}
			{children}
		</Button>
	);
}
