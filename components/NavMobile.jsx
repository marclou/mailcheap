"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import LogoMailcheap from "@/components/LogoMailcheap";
import NavLinks from "@/components/NavLinks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export default function NavMobile({ footer, showSparkLoop }) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 pr-2 pl-4 backdrop-blur-md md:hidden">
			<Link href="/" className="flex items-center gap-2">
				<LogoMailcheap />
				<span className="text-sm font-semibold tracking-tight">Mailcheap</span>
			</Link>
			<Sheet open={isOpen} onOpenChange={setIsOpen}>
				<SheetTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="Menu">
						<Menu />
					</Button>
				</SheetTrigger>
				<SheetContent side="left" className="w-64 gap-0 p-3 pt-14">
					<SheetTitle className="sr-only">Menu</SheetTitle>
					<NavLinks showSparkLoop={showSparkLoop} onNavigate={() => setIsOpen(false)} />
					<div className="mt-auto">{footer}</div>
				</SheetContent>
			</Sheet>
		</header>
	);
}
