"use client";

import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { loadSearchIndex } from "@/lib/search-client";

const DialogSearch = lazy(() => import("@/components/DialogSearch"));

// Search for the help center and the docs, in the site's header on their pages: a field on wide screens, an icon below,
// and ⌘K (Ctrl+K off Apple devices) anywhere on those pages. The dialog's code and the index load on first use; pointing
// at the button starts loading them.
export default function ButtonSearch() {
	const pathname = usePathname();
	const isShown = SEARCH_SECTIONS.some((section) => pathname === section || pathname?.startsWith(`${section}/`));
	const [isOpen, setIsOpen] = useState(false);
	const [hasOpened, setHasOpened] = useState(false);
	const shortcut = useSyncExternalStore(subscribeNever, getShortcut, () => null);

	useEffect(() => {
		if (!isShown) return;
		function onKeyDown(event) {
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			setHasOpened(true);
			setIsOpen((open) => !open);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isShown]);

	if (!isShown) return null;

	function open() {
		setHasOpened(true);
		setIsOpen(true);
	}

	return (
		<>
			<button
				type="button"
				onClick={open}
				onPointerEnter={preload}
				onFocus={preload}
				aria-keyshortcuts="Meta+K Control+K"
				className="mr-1.5 hidden h-8 w-56 items-center gap-2 rounded-lg bg-muted/60 pr-1.5 pl-2.5 text-sm text-muted-foreground shadow-border transition-[background-color,color,scale] duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98] lg:flex"
			>
				<Search className="size-4 shrink-0" aria-hidden="true" />
				<span className="flex-1 text-left">Search help and API</span>
				{shortcut && (
					<kbd className="rounded-md bg-background px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground shadow-border">
						{shortcut}
					</kbd>
				)}
			</button>
			<button
				type="button"
				onClick={open}
				onPointerEnter={preload}
				aria-label="Search help and API"
				aria-keyshortcuts="Meta+K Control+K"
				className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.96] lg:hidden"
			>
				<Search className="size-4" aria-hidden="true" />
			</button>
			{hasOpened && (
				<Suspense fallback={null}>
					<DialogSearch open={isOpen} onOpenChange={setIsOpen} />
				</Suspense>
			)}
		</>
	);
}

function preload() {
	import("@/components/DialogSearch");
	loadSearchIndex().catch(() => {});
}

function subscribeNever() {
	return () => {};
}

function getShortcut() {
	const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
	return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

const SEARCH_SECTIONS = ["/help", "/docs"];
