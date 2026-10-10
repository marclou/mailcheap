import Link from "next/link";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { cn } from "@/lib/utils";

// One tab per newsletter; the page at basePath reads the selected one from ?newsletter=.
export default function TabsNewsletter({ newsletters, selectedId, basePath = "/" }) {
	return (
		<nav
			aria-label="Newsletters"
			className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted/70 p-1 [scrollbar-width:none]"
		>
			{newsletters.map((newsletter) => {
				const id = newsletter._id.toString();
				const isSelected = id === selectedId;
				return (
					<Link
						key={id}
						href={`${basePath}?newsletter=${id}`}
						scroll={false}
						aria-current={isSelected ? "page" : undefined}
						className={cn(
							"flex h-8 shrink-0 items-center gap-2 rounded-lg pr-3 pl-1.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
							isSelected
								? "bg-background text-foreground shadow-border dark:bg-muted"
								: "text-muted-foreground hover:text-foreground"
						)}
					>
						<AvatarNewsletter newsletter={newsletter} size={20} />
						{newsletter.name}
					</Link>
				);
			})}
		</nav>
	);
}
