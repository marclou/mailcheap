"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function NavDocs({ pages, groups }) {
	const pathname = usePathname();

	return (
		<nav aria-label="API and MCP" className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-col md:gap-6 md:overflow-visible md:pb-0">
			<ul className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
				{pages.map(({ href, title }) => {
					const isActive = pathname === href;
					return (
						<li key={href} className="shrink-0">
							<Link
								href={href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex h-8 items-center rounded-lg px-2.5 text-sm transition-colors duration-150",
									isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								)}
							>
								{title}
							</Link>
						</li>
					);
				})}
			</ul>
			<div className="hidden md:block">
				<p className="mb-2 px-2.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Endpoints</p>
				<ul className="flex flex-col gap-0.5">
					{groups.map(({ group, slug, count }) => (
						<li key={slug}>
							<Link
								href={`/docs/api#${slug}`}
								className="flex h-7 items-center justify-between rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
							>
								{group}
								<span className="font-mono text-[11px] tabular-nums opacity-60">{count}</span>
							</Link>
						</li>
					))}
				</ul>
			</div>
			<div className="hidden md:block">
				<p className="mb-2 px-2.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">For agents</p>
				<ul className="flex flex-col gap-0.5">
					{AGENT_FILES.map(({ href, label }) => (
						<li key={href}>
							<a
								href={href}
								className="flex h-7 items-center rounded-lg px-2.5 font-mono text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
							>
								{label}
							</a>
						</li>
					))}
				</ul>
			</div>
		</nav>
	);
}

const AGENT_FILES = [
	{ href: "/llms.txt", label: "llms.txt" },
	{ href: "/llms-full.txt", label: "llms-full.txt" },
	{ href: "/api/v1/openapi.json", label: "openapi.json" },
];
