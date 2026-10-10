"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	ClipboardList,
	Gift,
	Globe,
	HeartHandshake,
	KeyRound,
	LayoutGrid,
	Newspaper,
	Send,
	Settings2,
	UserPlus,
	Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function NavLinks({ showSparkLoop = false, onNavigate }) {
	const pathname = usePathname();

	return (
		<nav className="flex flex-col gap-0.5">
			{NAV_ITEMS.map((item) => (
				<NavLink key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} />
			))}
			{showSparkLoop && (
				<>
					<Link
						href="/sparkloop"
						onClick={onNavigate}
						aria-current={pathname === "/sparkloop" ? "page" : undefined}
						aria-label="SparkLoop settings"
						className={cn(
							"mt-5 mb-1 flex h-6 items-center justify-between rounded-md px-2.5 text-xs font-medium transition-colors duration-150",
							pathname === "/sparkloop" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
						)}
					>
						SparkLoop
						<Settings2 className="size-3.5" />
					</Link>
					{SPARKLOOP_ITEMS.map((item) => (
						<NavLink key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} />
					))}
				</>
			)}
		</nav>
	);
}

function NavLink({ href, label, icon: Icon, pathname, onNavigate }) {
	const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
	return (
		<Link
			href={href}
			onClick={onNavigate}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"flex h-9 items-center gap-2.5 rounded-lg pr-3 pl-2.5 text-sm font-medium transition-colors duration-150",
				isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
			)}
		>
			<Icon className="size-4" />
			{label}
		</Link>
	);
}

const SPARKLOOP_ITEMS = [
	{ href: "/sparkloop/signup-flow", label: "Signup flow", icon: UserPlus },
	{ href: "/sparkloop/survey", label: "Welcome survey", icon: ClipboardList },
	{ href: "/sparkloop/offers", label: "Offers", icon: Gift },
	{ href: "/sparkloop/recommendations", label: "Recommendations", icon: HeartHandshake },
];

const NAV_ITEMS = [
	{ href: "/", label: "Overview", icon: LayoutGrid },
	{ href: "/campaigns", label: "Campaigns", icon: Send },
	{ href: "/contacts", label: "Contacts", icon: Users },
	{ href: "/newsletters", label: "Newsletters", icon: Newspaper },
	{ href: "/domains", label: "Domains", icon: Globe },
	{ href: "/api-keys", label: "API keys", icon: KeyRound },
];
