"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { manageSparkLoop } from "@/app/(app)/sparkloop/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// Programs that screen their partners read why you'd recommend them; the others start right away.
export default function DialogRecommendPaid({ newsletterId, uuid, name }) {
	const [isOpen, setIsOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [isPending, startTransition] = useTransition();

	function submit(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await manageSparkLoop(newsletterId, "recommendPaid", uuid, { reason });
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			setIsOpen(false);
			toast.success(result.status === "awaiting_approval" ? `Sent to ${name} for approval` : `Recommending ${name}`);
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" size="sm">
					<Plus data-icon="inline-start" />
					Recommend
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Recommend {name}</DialogTitle>
						<DialogDescription>
							You earn for each reader they confirm. Some programs approve their partners first: tell them about your
							readers and why they&apos;d like it.
						</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-1.5">
						<span className="text-xs text-muted-foreground">Note to {name} (optional)</span>
						<Textarea
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							rows={4}
							maxLength={1000}
							placeholder="My readers are early-stage founders who…"
						/>
					</label>
					<DialogFooter>
						<Button type="submit" disabled={isPending} className="min-w-28">
							{isPending ? <Loader2 className="animate-spin" /> : "Recommend"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
