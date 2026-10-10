"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { linkPublication } from "@/app/(app)/sparkloop/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NO_PUBLICATION, SPARKLOOP_URLS } from "@/lib/sparkloop-content";

// Compact, in the settings' list of newsletters, it saves as soon as a publication is picked, and can
// unlink. Otherwise it's the first-run question, with a button.
export default function FormLinkPublication({ newsletterId, publications, selectedUuid, isCompact = false }) {
	const [publicationUuid, setPublicationUuid] = useState(
		selectedUuid ?? (publications.length === 1 && !isCompact ? publications[0].uuid : "")
	);
	const [isPending, startTransition] = useTransition();

	if (publications.length === 0) {
		return (
			<p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
				This SparkLoop account has no publications yet.
				<a
					href={SPARKLOOP_URLS.publications}
					target="_blank"
					rel="noopener"
					className="inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
				>
					Add one in SparkLoop
					<ArrowUpRight className="size-3" />
				</a>
			</p>
		);
	}

	function save(uuid) {
		const previous = publicationUuid;
		setPublicationUuid(uuid);
		startTransition(async () => {
			const result = await linkPublication(newsletterId, uuid);
			if (result?.error) {
				setPublicationUuid(previous);
				toast.error(result.error);
			} else {
				toast.success(uuid === NO_PUBLICATION ? "Unlinked" : "Linked");
			}
		});
	}

	if (isCompact) {
		return (
			<span className="flex items-center gap-2">
				{isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
				<Select value={publicationUuid || NO_PUBLICATION} onValueChange={save} disabled={isPending}>
					<SelectTrigger className="w-56" aria-label="SparkLoop publication">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{publications.map(({ uuid, name }) => (
							<SelectItem key={uuid} value={uuid}>
								{name}
							</SelectItem>
						))}
						<SelectSeparator />
						<SelectItem value={NO_PUBLICATION}>Not on SparkLoop</SelectItem>
					</SelectContent>
				</Select>
			</span>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Select value={publicationUuid} onValueChange={setPublicationUuid}>
				<SelectTrigger className="w-64" aria-label="SparkLoop publication">
					<SelectValue placeholder="Pick a publication" />
				</SelectTrigger>
				<SelectContent>
					{publications.map(({ uuid, name }) => (
						<SelectItem key={uuid} value={uuid}>
							{name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button type="button" onClick={() => save(publicationUuid)} disabled={isPending || !publicationUuid} className="min-w-16">
				{isPending ? <Loader2 className="animate-spin" /> : "Link"}
			</Button>
		</div>
	);
}
