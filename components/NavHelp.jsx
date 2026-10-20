"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The help center's articles by group (lib/help.js). On phones, one row that scrolls sideways.
export default function NavHelp({ groups }) {
	const pathname = usePathname();

	return (
		<nav aria-label="Help" className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-col md:gap-6 md:overflow-visible md:pb-0">
			<ul className="flex shrink-0 md:flex-col">
				<ItemNav href="/help" label="All articles" isActive={pathname === "/help"} />
			</ul>
			{groups.map(({ group, articles }) => (
				<div key={group} className="contents md:block">
					<p className="mb-1.5 hidden px-2.5 text-xs font-medium text-muted-foreground md:block">{group}</p>
					<ul className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
						{articles.map(({ slug, title }) => (
							<ItemNav key={slug} href={`/help/${slug}`} label={title} isActive={pathname === `/help/${slug}`} />
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}

function ItemNav({ href, label, isActive }) {
	return (
		<li className="shrink-0">
			<Link
				href={href}
				aria-current={isActive ? "page" : undefined}
				className={cn(
					"flex h-8 items-center rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors duration-150",
					isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
				)}
			>
				{label}
			</Link>
		</li>
	);
}
