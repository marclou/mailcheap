import Link from "next/link";
import ButtonThemeToggle from "@/components/ButtonThemeToggle";
import LogoWordmark from "@/components/LogoWordmark";
import { FooterCredit, FooterNote } from "@/components/SiteExtensions";
import { isCloud } from "@/lib/config";
import { currentYear } from "@/lib/format";
import { SOURCE_URL } from "@/lib/site";
import { siteExtensions } from "@/lib/site-extensions";
import { cn } from "@/lib/utils";

// A self-hosted server keeps the link to the source: the AGPL asks it to offer its users the code it runs. On
// MailCheap Cloud the marketing site's columns, credit and company take its place.
export default function FooterSite() {
	const cloudFooter = isCloud() ? siteExtensions.footer : null;
	const { tagline, columns, company } = cloudFooter ?? SELF_HOSTED_FOOTER;
	return (
		<footer className="border-t border-border/60">
			<div className="mx-auto max-w-(--site-width) px-4 pt-12 pb-8 sm:px-6 lg:px-8">
				<div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_auto]">
					<div className="flex flex-col items-start gap-4">
						<LogoWordmark href="/" className="-ml-1 rounded-lg px-1 py-1" />
						<p className="max-w-xs text-sm text-pretty text-muted-foreground">{tagline}</p>
						{cloudFooter && FooterNote && <FooterNote />}
						{cloudFooter && FooterCredit && <FooterCredit />}
					</div>
					<nav aria-label="Footer" className={cn("grid gap-x-12 gap-y-8", columns.length > 1 && "grid-cols-2 sm:grid-cols-3")}>
						{columns.map(({ title, links }) => (
							<div key={title} className="flex flex-col gap-3">
								<p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{title}</p>
								<ul className="flex flex-col gap-2 text-sm">
									{links.map(({ href, label, isExternal }) => (
										<li key={href}>
											{isExternal ? (
												<a href={href} {...(href.startsWith("http") && { target: "_blank", rel: "noopener" })} className="text-foreground/80 transition-colors hover:text-foreground">
													{label}
												</a>
											) : (
												<Link href={href} className="text-foreground/80 transition-colors hover:text-foreground">
													{label}
												</Link>
											)}
										</li>
									))}
								</ul>
							</div>
						))}
					</nav>
				</div>
				<div className={cn("mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/60 pt-6", company ? "justify-between" : "justify-end")}>
					{company && (
						<p className="text-xs text-pretty text-muted-foreground tabular-nums">
							© {currentYear()} {company.name}, {company.address}
						</p>
					)}
					<ButtonThemeToggle />
				</div>
			</div>
		</footer>
	);
}

const SELF_HOSTED_FOOTER = {
	tagline: "Newsletters sent from your own server.",
	columns: [
		{
			title: "MailCheap",
			links: [
				{ href: "/help", label: "Help" },
				{ href: "/docs", label: "API and MCP" },
				{ href: SOURCE_URL, label: "Source code", isExternal: true },
			],
		},
	],
	company: null,
};
