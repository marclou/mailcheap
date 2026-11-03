"use client";

import { useTransition } from "react";
import { Loader2, Pin, PinOff } from "lucide-react";
import { toggleArchivePin } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { useToastError } from "@/lib/use-toast-error";

// Pins an issue's page to the top of its newsletter's website, or unpins it, at once.
export default function ButtonPinPage({ id, isPinned, size = "sm", className }) {
	const [isPending, startTransition] = useTransition();
	const toastError = useToastError();
	const Icon = isPending ? Loader2 : isPinned ? PinOff : Pin;

	function toggle() {
		startTransition(async () => {
			const result = await toggleArchivePin(id);
			if (result?.error) return void toastError(result);
			toast.success(isPinned ? "Unpinned from your website" : "Pinned to the top of your website");
		});
	}

	return (
		<Button type="button" variant="outline" size={size} onClick={toggle} disabled={isPending} className={className}>
			<Icon data-icon="inline-start" className={isPending ? "animate-spin" : undefined} />
			{isPinned ? "Unpin" : "Pin to top"}
		</Button>
	);
}
