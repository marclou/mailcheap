"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import LogoMailcheap from "@/components/LogoMailcheap";
import NavLinks from "@/components/NavLinks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// The newsletter menu stays in the top bar, so a phone always shows which newsletter is open, and so does the
// notifications' bell (notifications).
export default function NavMobile({ isAdmin, role, switcher, notifications, footer }) {
	const [isOpen, setIsOpen] = useState(false);

	// The account menu's items render in a portal, but React still bubbles their clicks up to the footer.
	function closeAfterLink(event) {
		if (event.target.closest("a[href]")) setIsOpen(false);
	}

	return (
		<header className="sticky top-(--plan-bar-height) z-30 flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background/80 px-2 backdrop-blur-md md:hidden">
			<div className="flex min-w-0 items-center">
				<Link href="/" aria-label="MailCheap" className="grid size-10 shrink-0 place-items-center rounded-lg">
					<LogoMailcheap />
				</Link>
				<span aria-hidden="true" className="mr-1 text-xl font-light text-foreground/15">
					/
				</span>
				{switcher}
			</div>
			<div className="flex shrink-0 items-center">
				{notifications}
				<Sheet open={isOpen} onOpenChange={setIsOpen}>
					<SheetTrigger asChild>
						<Button variant="ghost" size="icon" aria-label="Menu">
							<Menu />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" className="w-64 gap-0 p-3 pt-14">
						<SheetTitle className="sr-only">Menu</SheetTitle>
						<NavLinks isAdmin={isAdmin} role={role} onNavigate={() => setIsOpen(false)} />
						<div className="mt-auto pt-4" onClick={closeAfterLink}>
							{footer}
						</div>
					</SheetContent>
				</Sheet>
			</div>
		</header>
	);
}
