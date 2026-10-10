"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

// A switch whose change is a server action (bound to what it changes), shown at once and undone if it
// fails. messages: { on, off }, the toasts once the change is saved.
export default function SwitchAction({ action, checked, label, describedBy, disabled, messages }) {
	const [isOn, setIsOn] = useOptimistic(checked);
	const [isPending, startTransition] = useTransition();

	function onCheckedChange(next) {
		if (isPending) return;
		startTransition(async () => {
			setIsOn(next);
			const result = await action(next);
			if (result?.error) toast.error(result.error);
			else if (messages) toast.success(next ? messages.on : messages.off);
		});
	}

	return (
		<Switch
			checked={isOn}
			onCheckedChange={onCheckedChange}
			disabled={disabled}
			aria-label={label}
			aria-describedby={describedBy}
			aria-busy={isPending}
		/>
	);
}
