"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, KeyRound, LayoutGrid, Send, Settings, Shield, Users } from "lucide-react";
import { OWNER_ROLE, hasRole } from "@/lib/team-rules";
import { cn } from "@/lib/utils";

// The open newsletter's pages, then the account's, which every newsletter shares. notifications: the bell
// (components/ButtonNotifications.jsx), in a section of its own after them, in the sidebar only: the phone has it in its
// top bar. role: the user's on the open newsletter, which leaves out the pages it doesn't open (lib/team-rules.js).
export default function NavLinks({ isAdmin, role = OWNER_ROLE, onNavigate, notifications = null }) {
	const pathname = usePathname();
	const groups = [NEWSLETTER_ITEMS, [...ACCOUNT_ITEMS, ...(isAdmin ? [ADMIN_ITEM] : [])]]
		.map((items) => items.filter((item) => hasRole(role, item.role ?? "member")))
		.filter((items) => items.length > 0);

	return (
		<nav className="flex flex-col gap-3">
			{groups.map((items, index) => (
				<ul key={index} className={GROUP_CLASS}>
					{items.map(({ href, label, icon: Icon }) => {
						const isActive = href === "/" ? pathname === href : pathname.startsWith(href);
						return (
							<li key={href}>
								<Link
									href={href}
									onClick={onNavigate}
									aria-current={isActive ? "page" : undefined}
									className={cn(
										"flex h-9 items-center gap-2.5 overflow-hidden rounded-lg pr-3 pl-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
										isActive
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
									)}
								>
									<Icon className="size-4 shrink-0 transition-[translate] duration-250 ease-drawer motion-reduce:transition-none sidebar-folded:translate-x-1" />
									<span className="sidebar-label">{label}</span>
								</Link>
							</li>
						);
					})}
				</ul>
			))}
			{notifications && (
				<ul className={GROUP_CLASS}>
					<li>{notifications}</li>
				</ul>
			)}
		</nav>
	);
}

const GROUP_CLASS = "flex flex-col gap-0.5 not-first:border-t not-first:border-border/60 not-first:pt-3";

const NEWSLETTER_ITEMS = [
	{ href: "/", label: "Overview", icon: LayoutGrid },
	{ href: "/campaigns", label: "Campaigns", icon: Send },
	{ href: "/contacts", label: "Contacts", icon: Users },
	{ href: "/newsletters", label: "Settings", icon: Settings, role: "admin" },
];

const ACCOUNT_ITEMS = [
	{ href: "/domains", label: "Domains", icon: Globe, role: OWNER_ROLE },
	{ href: "/api-keys", label: "API keys", icon: KeyRound, role: OWNER_ROLE },
];

const ADMIN_ITEM = { href: "/admin", label: "Admin", icon: Shield };
