"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { updateArchiveSlug } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { toSlugInput } from "@/lib/slug";

// A draft's URL saves when the field loses focus. A sent issue's URL is live, so it waits for Save. isCompact: its path
// only, where its host shows nearby.
export default function InputCampaignSlug({ campaignId, initialSlug = "", placeholder, urlBase, isPublished = false, isCompact = false }) {
	const [savedSlug, setSavedSlug] = useState(initialSlug);
	const [value, setValue] = useState(initialSlug);
	const [error, setError] = useState(null);
	const [isSaved, setIsSaved] = useState(false);
	const [isSaving, startSaving] = useTransition();
	const savedTimeout = useRef(null);
	const { host, pathname } = new URL(urlBase);
	const isDirty = value.replace(/-+$/, "") !== savedSlug;

	useEffect(() => () => clearTimeout(savedTimeout.current), []);

	function save() {
		if (!isDirty || isSaving) return;
		startSaving(async () => {
			const result = await updateArchiveSlug(campaignId, value);
			if (result?.error) return void setError(result.error);
			setError(null);
			setSavedSlug(result.archiveSlug);
			setValue(result.archiveSlug);
			setIsSaved(true);
			clearTimeout(savedTimeout.current);
			savedTimeout.current = setTimeout(() => setIsSaved(false), 1500);
		});
	}

	function reset() {
		setValue(savedSlug);
		setError(null);
	}

	function onKeyDown(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			save();
		}
		if (event.key === "Escape" && isPublished) reset();
	}

	return (
		<div className="flex min-w-0 flex-col gap-1.5 py-2.5">
			<div className="flex min-h-6 min-w-0 items-center gap-2">
				<label className="flex min-w-0 flex-1 items-center text-sm">
					{!isCompact && <span className="hidden shrink-0 text-muted-foreground sm:inline">{host}</span>}
					<span className="shrink-0 text-muted-foreground">{pathname}</span>
					<input
						value={value}
						onChange={(event) => {
							setValue(toSlugInput(event.target.value));
							setError(null);
						}}
						onBlur={isPublished ? undefined : save}
						onKeyDown={onKeyDown}
						placeholder={placeholder}
						aria-label="URL"
						aria-invalid={Boolean(error)}
						spellCheck={false}
						autoCapitalize="none"
						autoComplete="off"
						maxLength={120}
						className="h-6 w-full min-w-[8ch] bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
					/>
				</label>
				{isPublished && isDirty ? (
					<span className="flex shrink-0 items-center gap-1">
						<Button type="button" variant="ghost" size="sm" onClick={reset} disabled={isSaving}>
							Cancel
						</Button>
						<Button type="button" size="sm" onClick={save} disabled={isSaving} className="min-w-14">
							{isSaving ? <Loader2 className="animate-spin" /> : "Save"}
						</Button>
					</span>
				) : (
					<span aria-live="polite" className="grid size-4 shrink-0 place-items-center text-muted-foreground">
						{isSaving && <Loader2 className="size-3.5 animate-spin" />}
						{!isSaving && isSaved && <Check key="saved" className="size-3.5 animate-draw-check" />}
						{!isSaving && isSaved && <span className="sr-only">URL saved</span>}
					</span>
				)}
			</div>
			{error && <p className="text-xs text-destructive">{error}</p>}
			{!error && isPublished && isDirty && (
				<p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
					<TriangleAlert className="mt-px size-3.5 shrink-0" />
					Links to the current URL stop working: sent emails, shares and search results.
				</p>
			)}
		</div>
	);
}
