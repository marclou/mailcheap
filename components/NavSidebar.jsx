"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import LogoWordmark from "@/components/LogoWordmark";
import NavLinks from "@/components/NavLinks";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE, SIDEBAR_EXPANDED } from "@/lib/sidebar";
import { readCookie } from "@/lib/storage";
import { isSidebarCollapsed, readSidebarVisit, subscribeToSidebarVisits } from "@/lib/use-collapsed-sidebar";
import { cn } from "@/lib/utils";

// The sidebar from md up: the logo, the newsletter menu (switcher), the navigation with the notifications' bell in a
// section of its own after the account's pages (notifications) and the account menu (footer). The
// button next to the logo collapses it, and the page takes the room (app/globals.css). Collapsed, it's folded down to
// its icons, and unfolds over the page while a mouse is on it, where the same button keeps it open; folded, the logo
// opens it too, for touch screens and the keyboard. The campaign editor collapses it too while it's open, unless it's
// opened there (lib/use-collapsed-sidebar.js); the next page shows it as it was left. isCollapsed: the cookie the
// layout was rendered from.
export default function NavSidebar({ isCollapsed: isSavedCollapsed, isAdmin, role, switcher, notifications, footer }) {
	const isLeftCollapsed = useSyncExternalStore(subscribe, readIsCollapsed, () => isSavedCollapsed);
	const visit = useSyncExternalStore(subscribeToSidebarVisits, readSidebarVisit, () => 0);
	const [expandedVisit, setExpandedVisit] = useState(0);
	const isCollapsed = isSidebarCollapsed({ isLeftCollapsed, visit, expandedVisit });
	const [isPeeking, setIsPeeking] = useState(false);
	const isFolded = isCollapsed && !isPeeking;
	const isOverPage = isCollapsed && isPeeking;
	const asideRef = useRef(null);
	const toggleRef = useRef(null);
	const expandRef = useRef(null);
	const peekTimeoutRef = useRef(0);

	useEffect(() => () => clearTimeout(peekTimeoutRef.current), []);

	// A mouse passing over it on its way elsewhere doesn't unfold it. Unfolded, it folds back once the mouse has been
	// off it for a moment, and never while a menu it opened is open: modal menus take pointer events from the page.
	useEffect(() => {
		if (!isPeeking) return;
		let leaveTimeout = 0;
		function handlePointerMove(event) {
			const aside = asideRef.current;
			if (aside.contains(event.target) || aside.querySelector('[data-state="open"]')) {
				clearTimeout(leaveTimeout);
				leaveTimeout = 0;
			} else if (!leaveTimeout) {
				leaveTimeout = setTimeout(() => setIsPeeking(false), PEEK_LEAVE_MS);
			}
		}
		document.addEventListener("pointermove", handlePointerMove);
		return () => {
			document.removeEventListener("pointermove", handlePointerMove);
			clearTimeout(leaveTimeout);
		};
	}, [isPeeking]);

	function startPeek(event) {
		if (event.pointerType !== "mouse" || !isFolded) return;
		clearTimeout(peekTimeoutRef.current);
		peekTimeoutRef.current = setTimeout(() => setIsPeeking(true), PEEK_ENTER_MS);
	}

	function cancelPeek() {
		if (!isPeeking) clearTimeout(peekTimeoutRef.current);
	}

	// From the keyboard, focus goes on to the button that takes the other one's place.
	function toggle(event) {
		const hasFocusRing = event.currentTarget.matches(":focus-visible");
		clearTimeout(peekTimeoutRef.current);
		flushSync(() => {
			setIsPeeking(false);
			if (isCollapsed) setExpandedVisit(visit);
			saveIsCollapsed(!isCollapsed);
		});
		if (hasFocusRing) (isCollapsed ? toggleRef : expandRef).current.focus();
	}

	const toggleLabel = isCollapsed ? "Keep sidebar open" : "Collapse sidebar";
	const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

	return (
		<aside
			ref={asideRef}
			data-sidebar-collapsed={isCollapsed ? "" : undefined}
			data-sidebar-folded={isFolded ? "" : undefined}
			data-sidebar-peek={isOverPage ? "" : undefined}
			data-sidebar-expanded={visit !== 0 && !isCollapsed ? "" : undefined}
			data-sidebar=""
			onPointerEnter={startPeek}
			onPointerLeave={cancelPeek}
			className="sticky top-(--plan-bar-height) z-40 hidden h-[calc(100dvh-var(--plan-bar-height))] w-(--sidebar-width) shrink-0 transition-[width] duration-250 ease-drawer motion-reduce:transition-none md:block"
		>
			<div
				className={cn(
					"absolute inset-y-0 left-0 flex w-60 flex-col border-r border-border/60 bg-background pb-4 transition-[width,box-shadow] duration-250 ease-drawer motion-reduce:transition-none sidebar-folded:w-(--sidebar-width)",
					isOverPage && "shadow-[8px_0_32px_-12px_rgb(0_0_0/0.18)]"
				)}
			>
				{/* A window too short for the sidebar scrolls its navigation, and the account menu stays at the bottom. */}
				<div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pt-4">
					<div className="relative mb-4 flex h-9 shrink-0 items-center">
						<div inert={isFolded} className="flex min-w-0 flex-1 items-center">
							<LogoWordmark href="/" className="h-9 px-2.5 [&>span]:sidebar-label" />
							<div className="mr-1.5 ml-auto sidebar-label">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											ref={toggleRef}
											variant="ghost"
											size="icon-sm"
											onClick={toggle}
											aria-label={toggleLabel}
											className="text-muted-foreground"
										>
											<ToggleIcon key={toggleLabel} className="animate-icon-in" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">{toggleLabel}</TooltipContent>
								</Tooltip>
							</div>
						</div>
						{/* Folded, the logo opens the sidebar. Focused, this button's background, opaque, takes the logo's place. */}
						<button
							ref={expandRef}
							type="button"
							onClick={toggle}
							inert={!isFolded}
							aria-label="Expand sidebar"
							className="group/expand absolute inset-y-0 left-0 grid w-11 place-items-center rounded-lg outline-none transition-[background-color,box-shadow] duration-150 focus-visible:bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							<PanelLeftOpen className="size-4 opacity-0 transition-opacity duration-150 group-focus-visible/expand:opacity-100" />
						</button>
					</div>
					<div className="mb-5">{switcher}</div>
					<NavLinks isAdmin={isAdmin} role={role} notifications={notifications} />
				</div>
				<div className="shrink-0 px-3 pt-4">{footer}</div>
			</div>
		</aside>
	);
}

const PEEK_ENTER_MS = 100;
const PEEK_LEAVE_MS = 150;

// The cookie is the sidebar's state. The layout doesn't render again on navigation, and a page brought back from the
// history comes with the layout it was rendered with: the cookie has the last choice.
const listeners = new Set();

function subscribe(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function readIsCollapsed() {
	return readCookie(SIDEBAR_COOKIE) === SIDEBAR_COLLAPSED;
}

function saveIsCollapsed(isCollapsed) {
	document.cookie = `${SIDEBAR_COOKIE}=${isCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED}; path=/; max-age=31536000; samesite=lax`;
	for (const listener of listeners) listener();
}
