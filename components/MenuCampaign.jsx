"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChartColumn, Copy, ExternalLink, GlobeOff, Link2, Loader2, MoreHorizontal, PenLine, Trash2 } from "lucide-react";
import { duplicateCampaign } from "@/app/(app)/campaigns/actions";
import DialogDiscardCampaign from "@/components/DialogDiscardCampaign";
import DialogUnpublishCampaign from "@/components/DialogUnpublishCampaign";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast";
import { useHasRole } from "@/lib/use-team-role";

const EDITABLE_STATUSES = ["draft", "scheduled"];

// pageUrl: only for an issue on the website, whose page can change or leave it.
export default function MenuCampaign({ id, status, subject, scheduledAt, pageUrl, isWebOnly }) {
	const [isDiscardOpen, setIsDiscardOpen] = useState(false);
	const [isUnpublishOpen, setIsUnpublishOpen] = useState(false);
	const [isDuplicating, startDuplicating] = useTransition();
	// A team's members change drafts only: the website and what's scheduled are the admins'.
	const isAdmin = useHasRole("admin");
	const isEditable = isAdmin ? EDITABLE_STATUSES.includes(status) : status === "draft";

	function duplicate() {
		startDuplicating(async () => {
			const result = await duplicateCampaign(id);
			if (result?.error) toast.error(result.error);
		});
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(pageUrl);
			toast.success("Link copied");
		} catch {
			toast.error("Couldn't copy the link");
		}
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Actions for ${subject || "Untitled"}`}
						disabled={isDuplicating}
						className="relative z-10 text-muted-foreground hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
					>
						{isDuplicating ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-52">
					<DropdownMenuItem asChild>
						<Link href={`/campaigns/${id}`}>
							{isEditable ? <PenLine /> : <ChartColumn />}
							{isEditable ? "Edit" : "Open report"}
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={duplicate}>
						<Copy />
						Duplicate
					</DropdownMenuItem>
					{pageUrl && (
						<>
							<DropdownMenuSeparator />
							{isAdmin && (
								<DropdownMenuItem asChild>
									<Link href={`/campaigns/${id}/web`}>
										<PenLine />
										Edit web page
									</Link>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onSelect={copyLink}>
								<Link2 />
								Copy link
							</DropdownMenuItem>
							<DropdownMenuItem asChild>
								<a href={pageUrl} target="_blank" rel="noreferrer">
									<ExternalLink />
									View page
								</a>
							</DropdownMenuItem>
							{isAdmin && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive" onSelect={() => setIsUnpublishOpen(true)}>
										<GlobeOff />
										Remove from website
									</DropdownMenuItem>
								</>
							)}
						</>
					)}
					{isEditable && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={() => setIsDiscardOpen(true)}>
								<Trash2 />
								Discard
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{isEditable && (
				<DialogDiscardCampaign
					id={id}
					subject={subject}
					scheduledAt={status === "scheduled" ? scheduledAt : null}
					isOpen={isDiscardOpen}
					onOpenChange={setIsDiscardOpen}
				/>
			)}
			{pageUrl && (
				<DialogUnpublishCampaign
					id={id}
					subject={subject}
					isWebOnly={isWebOnly}
					isOpen={isUnpublishOpen}
					onOpenChange={setIsUnpublishOpen}
				/>
			)}
		</>
	);
}
