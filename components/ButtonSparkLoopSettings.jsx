"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { disconnectSparkLoop, setUpReferralWebhook } from "@/app/(app)/sparkloop/actions";
import { Button } from "@/components/ui/button";

export function ButtonDisconnectSparkLoop() {
	const [isPending, startTransition] = useTransition();

	function disconnect() {
		if (!window.confirm("Disconnect SparkLoop? The signup flow leaves your signup forms. Nothing changes on SparkLoop.")) return;
		startTransition(async () => {
			const result = await disconnectSparkLoop();
			if (result?.error) toast.error(result.error);
			else toast.success("SparkLoop disconnected");
		});
	}

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={disconnect}
			disabled={isPending}
			className="text-muted-foreground hover:text-destructive"
		>
			{isPending ? <Loader2 className="animate-spin" /> : "Disconnect"}
		</Button>
	);
}

export function ButtonSetUpWebhook() {
	const [isPending, startTransition] = useTransition();

	function setUp() {
		startTransition(async () => {
			const result = await setUpReferralWebhook();
			if (result?.error) toast.error(result.error);
			else toast.success("SparkLoop now sends new readers to Mailcheap");
		});
	}

	return (
		<Button variant="outline" size="sm" onClick={setUp} disabled={isPending} className="min-w-16">
			{isPending ? <Loader2 className="animate-spin" /> : "Set up"}
		</Button>
	);
}
