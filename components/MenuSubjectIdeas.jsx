"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { suggestSubjects } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Three subject and preview text pairs for the draft as it is, from the Neon AI Gateway. Picking one
// fills both fields, and the autosave keeps it.
export default function MenuSubjectIdeas({ campaignId, getDraft, onPick }) {
	const [ideas, setIdeas] = useState([]);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startTransition] = useTransition();

	function load() {
		startTransition(async () => {
			const result = await suggestSubjects(campaignId, getDraft());
			if (result?.error) {
				toast.error(result.error);
				setIsOpen(false);
				return;
			}
			setIdeas(result.ideas);
		});
	}

	function onOpenChange(open) {
		setIsOpen(open);
		if (open && ideas.length === 0) load();
	}

	return (
		<DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Subject ideas" title="Subject ideas" className="size-8 shrink-0">
					{isPending && !isOpen ? <Loader2 className="animate-spin" /> : <Sparkles />}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-[min(26rem,calc(100vw-2rem))]">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Subject ideas</DropdownMenuLabel>
				{isPending ? (
					<p className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Reading the issue…
					</p>
				) : (
					ideas.map((idea) => (
						<DropdownMenuItem key={idea.subject} onSelect={() => onPick(idea)} className="flex-col items-start gap-0.5">
							<span className="font-medium">{idea.subject}</span>
							<span className="text-xs text-muted-foreground">{idea.previewText}</span>
						</DropdownMenuItem>
					))
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={isPending}
					onSelect={(event) => {
						event.preventDefault();
						load();
					}}
				>
					<RefreshCw />
					More ideas
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
