"use client";

import { useTransition } from "react";
import { Copy, ExternalLink, Loader2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { duplicateCampaign, toggleArchivePin } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToastError } from "@/lib/use-toast-error";

// A sent campaign's other actions: its page on the newsletter's website and its place there, and a copy to edit.
// pageUrl: only for an issue on the website.
export default function MenuReport({ id, pageUrl, isPinned }) {
	const [isPending, startTransition] = useTransition();
	const toastError = useToastError();

	function run(action) {
		startTransition(async () => {
			const result = await action(id);
			if (result?.error) toastError(result);
		});
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon" aria-label="More actions" disabled={isPending} className="aria-expanded:bg-muted">
					{isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44">
				{pageUrl && (
					<>
						<DropdownMenuItem asChild>
							<a href={pageUrl} target="_blank" rel="noreferrer">
								<ExternalLink />
								View page
							</a>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => run(toggleArchivePin)}>
							{isPinned ? <PinOff /> : <Pin />}
							{isPinned ? "Unpin" : "Pin to top"}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem onSelect={() => run(duplicateCampaign)}>
					<Copy />
					Duplicate
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
