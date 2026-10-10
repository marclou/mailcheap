import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Previous and next for a list that comes a page at a time; href(number) links to a page.
export default function NavPages({ page, totalPages, href }) {
	if (!totalPages || totalPages <= 1) return null;
	return (
		<nav aria-label="Pages" className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
			<span className="tabular-nums">
				Page {page} of {totalPages}
			</span>
			<ButtonPage href={page > 1 ? href(page - 1) : null} label="Previous page" icon={ChevronLeft} />
			<ButtonPage href={page < totalPages ? href(page + 1) : null} label="Next page" icon={ChevronRight} />
		</nav>
	);
}

function ButtonPage({ href, label, icon: Icon }) {
	if (!href) {
		return (
			<Button variant="outline" size="icon-sm" disabled aria-label={label}>
				<Icon />
			</Button>
		);
	}
	return (
		<Button asChild variant="outline" size="icon-sm" aria-label={label}>
			<Link href={href} scroll={false}>
				<Icon />
			</Link>
		</Button>
	);
}
