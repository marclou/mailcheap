"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { unpublishCampaign } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

// Opened from a menu, so the caller owns the open state. A web-only issue leaves the campaigns too: redirectTo is where
// its own page goes then. onRemoved: called once it's off the website, with whether it left the campaigns.
export default function DialogUnpublishCampaign({ id, subject, isWebOnly, isOpen, onOpenChange, redirectTo, onRemoved }) {
	const router = useRouter();
	const [isRemoving, startRemoving] = useTransition();

	function remove() {
		startRemoving(async () => {
			const result = await unpublishCampaign(id);
			if (result?.error) return void toast.error(result.error);
			onOpenChange(false);
			toast.success("Removed from your website");
			if (result.deleted && redirectTo) router.replace(redirectTo);
			onRemoved?.({ isDeleted: Boolean(result.deleted) });
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Remove this issue from your website?</DialogTitle>
					<DialogDescription>
						<span className="font-medium text-foreground">{subject || "Untitled"}</span>{" "}
						{isWebOnly
							? "leaves your website and your campaigns. It went out on the web only."
							: "leaves your website, and the Read online link in its emails stops working. It stays in your campaigns as email only."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={remove} disabled={isRemoving} className="min-w-20">
						{isRemoving ? <Loader2 className="animate-spin" /> : "Remove"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
