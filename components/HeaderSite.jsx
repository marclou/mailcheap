import Link from "next/link";
import { Menu } from "lucide-react";
import ButtonSearch from "@/components/ButtonSearch";
import LogoWordmark from "@/components/LogoWordmark";
import { Button } from "@/components/ui/button";
import { isCloud } from "@/lib/config";
import { siteExtensions } from "@/lib/site-extensions";

// Public pages are static, so the header can't tell who's signed in: signing in leads signed-in users on to the dashboard.
// On phones the links sit in a popover, which needs no client code. They're plain links there: the header outlives a
// client-side navigation, and the popover would stay open over the next page.
export default function HeaderSite() {
	const { headerLinks, headerAction } = isCloud() ? siteExtensions : { headerLinks: [], headerAction: null };
	const links = [...headerLinks, ...LINKS];

	return (
		<header className="sticky top-0 z-30 border-b border-border/60 bg-site/80 backdrop-blur-md">
			<div className="mx-auto flex h-14 max-w-(--site-width) items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
				<LogoWordmark href="/" canFly className="-ml-1 rounded-lg px-1 py-1" />
				<nav aria-label="Main" className="flex items-center gap-1">
					<ButtonSearch />
					<span className="hidden items-center gap-1 sm:flex">
						{links.map(({ href, label }) => (
							<Button key={href} asChild variant="ghost" size="sm" className="text-muted-foreground">
								<Link href={href}>{label}</Link>
							</Button>
						))}
					</span>
					{headerAction && (
						<Button asChild size="sm" className="ml-1.5">
							<Link href={headerAction.href}>{headerAction.label}</Link>
						</Button>
					)}
					<Button variant="ghost" size="icon-sm" popoverTarget="site-menu" aria-label="Menu" className="sm:hidden">
						<Menu />
					</Button>
					<div
						id="site-menu"
						popover="auto"
						className="inset-x-3 top-16 bottom-auto m-0 w-auto rounded-2xl bg-popover p-2 text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_16px_40px_-12px_rgb(0_0_0/0.3)] sm:hidden dark:shadow-border"
					>
						<ul className="flex flex-col">
							{links.map(({ href, label }) => (
								<li key={href}>
									<a href={href} className="flex h-11 items-center rounded-lg px-3 text-[15px] font-medium transition-colors hover:bg-muted">
										{label}
									</a>
								</li>
							))}
						</ul>
					</div>
				</nav>
			</div>
		</header>
	);
}

const LINKS = [
	{ href: "/help", label: "Help" },
	{ href: "/docs", label: "API" },
	{ href: "/signin", label: "Sign in" },
];
