"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A form's save bar, the form's last child: centered on the form's column at the bottom of the screen while the form
// has unsaved changes, in the theme's inverted colors, with Discard and Save (or ⌘S, Ctrl+S), then Saved for a moment.
// Its place stays at the end of the page, whose bottom padding it takes back (LayoutDashboard's), so the form's end
// never hides under it. Hidden, it drops no lower than its place: past the page's end, it would make the page scroll
// further and push the sticky sidebar up. The get-started pill steps aside while it shows (app/globals.css). savedAt:
// the last save's time, null after a discard.
export default function BarSave({ isDirty, isSaving, savedAt, onDiscard, label = "Save" }) {
	const slotRef = useRef(null);
	const barRef = useRef(null);
	const saveRef = useRef(null);
	const [fadedAt, setFadedAt] = useState(null);
	const [cue, setCue] = useState("ahead");
	const isSaved = !isDirty && !isSaving && savedAt !== null;
	const isShown = isDirty || isSaving || (isSaved && fadedAt !== savedAt);

	// The first time it shows, the eye is on the field being edited: the bar settles with a little bounce and its dot
	// pings once. After that it only slides up.
	if (isShown && cue === "ahead") setCue("playing");
	if (!isShown && cue === "playing") setCue("done");
	const isCued = cue === "playing";

	useClearOfChat(slotRef, barRef, isShown);
	useLeaveWarning(isDirty);

	useEffect(() => {
		if (savedAt === null) return;
		const timeout = setTimeout(() => setFadedAt(savedAt), SAVED_MS);
		return () => clearTimeout(timeout);
	}, [savedAt]);

	const onKeyDown = useEffectEvent((event) => {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
		event.preventDefault();
		if (isDirty && !isSaving) saveRef.current.form.requestSubmit(saveRef.current);
	});

	useEffect(() => {
		function handleKeyDown(event) {
			onKeyDown(event);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<div
			ref={slotRef}
			data-save-bar
			data-shown={isShown ? "" : undefined}
			className="pointer-events-none sticky bottom-0 z-30 -mb-6 pr-(--save-bar-inset) pb-(--save-bar-bottom) md:-mb-10"
		>
			<div
				ref={barRef}
				inert={!isShown}
				className={cn(
					"pointer-events-auto mx-auto flex h-14 max-w-120 origin-bottom items-center gap-2 rounded-2xl bg-foreground p-2 pl-4 text-background shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_12px_32px_-8px_rgb(0_0_0/0.35),0_4px_8px_-4px_rgb(0_0_0/0.2)] transition-[translate,scale,opacity] @container motion-reduce:transition-opacity",
					isShown
						? isCued
							? "duration-600 ease-settle"
							: "duration-250 ease-[cubic-bezier(0.23,1,0.32,1)]"
						: "translate-y-(--save-bar-bottom) scale-96 opacity-0 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:scale-100"
				)}
			>
				<p aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-medium">
					<span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
						{isSaved ? (
							<Check key={savedAt} className="size-4 text-emerald-500 animate-icon-in" />
						) : (
							<span className="relative size-2 rounded-full bg-amber-400 ring-4 ring-amber-400/20 dark:bg-amber-500 dark:ring-amber-500/25">
								{isCued && (
									<span className="absolute inset-0 rounded-full bg-inherit animate-[ping_1s_cubic-bezier(0,0,0.2,1)_250ms_both] motion-reduce:hidden" />
								)}
							</span>
						)}
					</span>
					{/* What fits: the sentence from 22.5rem inside the bar, the word from 15rem. */}
					{isSaved ? (
						<span className="truncate">Saved</span>
					) : (
						<>
							<span className="truncate @max-[22.5rem]:hidden">You have unsaved changes</span>
							<span className="truncate @min-[22.5rem]:hidden @max-[15rem]:sr-only">Unsaved</span>
						</>
					)}
				</p>
				<div inert={isSaved} className={cn("flex shrink-0 items-center gap-1 transition-opacity duration-150", isSaved && "opacity-0")}>
					<Button
						type="button"
						variant="ghost"
						size="lg"
						disabled={isSaving}
						onClick={onDiscard}
						className={cn("px-3 text-background/70 hover:bg-background/10 hover:text-background dark:hover:bg-background/10", ON_BAR)}
					>
						Discard
					</Button>
					<Button
						ref={saveRef}
						type="submit"
						size="lg"
						disabled={isSaving}
						aria-keyshortcuts="Meta+S Control+S"
						className={cn("relative bg-background text-foreground hover:bg-background/85", ON_BAR)}
					>
						<span className={cn(isSaving && "opacity-0")}>{label}</span>
						{isSaving && <Loader2 className="absolute animate-spin" />}
					</Button>
				</div>
			</div>
		</div>
	);
}

// The support chat's button sits in the bottom right corner (app/globals.css). Where the bar would come within
// --chat-clearance of the screen's right edge, like the get-started pill, it moves left within the column, then
// narrows: the slot's padding is what it gives up.
function useClearOfChat(slotRef, barRef, isShown) {
	useLayoutEffect(() => {
		if (!isShown) return;
		const slot = slotRef.current;
		function update() {
			const clearance = Number.parseFloat(getComputedStyle(slot).getPropertyValue("--chat-clearance")) || 0;
			const { width, right } = slot.getBoundingClientRect();
			const margin = Math.max(0, (width - Number.parseFloat(getComputedStyle(barRef.current).maxWidth)) / 2);
			const overlap = Math.max(0, right - margin + clearance - document.documentElement.clientWidth);
			slot.style.setProperty("--save-bar-inset", `${overlap + Math.min(overlap, margin)}px`);
		}
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, [slotRef, barRef, isShown]);
}

// Closing or reloading the tab gets the browser's own question; a link to another dashboard page asks here.
function useLeaveWarning(isDirty) {
	const onBeforeUnload = useEffectEvent((event) => {
		if (isDirty) event.preventDefault();
	});

	const onClick = useEffectEvent((event) => {
		if (!isDirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
		const url = new URL(link.href);
		if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
		if (window.confirm(LEAVE_QUESTION)) return;
		event.preventDefault();
		event.stopPropagation();
	});

	useEffect(() => {
		function handleBeforeUnload(event) {
			onBeforeUnload(event);
		}
		function handleClick(event) {
			onClick(event);
		}
		window.addEventListener("beforeunload", handleBeforeUnload);
		window.addEventListener("click", handleClick, true);
		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			window.removeEventListener("click", handleClick, true);
		};
	}, []);
}

const SAVED_MS = 1500;
const LEAVE_QUESTION = "Leave without saving your changes?";
// The theme's focus ring is drawn for its background; on the inverted bar it takes the bar's own text color.
const ON_BAR = "focus-visible:border-background/50 focus-visible:ring-background/30";
