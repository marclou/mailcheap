import { getHelpHref } from "@/lib/help";
import { cn } from "@/lib/utils";

// "Learn more" in the dashboard: an article of the help center (lib/help.js), in a new tab so the page stays as it was.
export default function LinkHelp({ article, section, className, children = "Learn more" }) {
	return (
		<a
			href={getHelpHref(article, section)}
			target="_blank"
			rel="noopener"
			className={cn(
				"font-medium whitespace-nowrap text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors duration-150 hover:decoration-foreground",
				className
			)}
		>
			{children}
		</a>
	);
}
