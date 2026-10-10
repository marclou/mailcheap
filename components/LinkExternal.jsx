import { ArrowUpRight } from "lucide-react";

// An inline link out of the app, in running text.
export default function LinkExternal({ href, children }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener"
			className="inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
		>
			{children}
			<ArrowUpRight className="size-3" />
		</a>
	);
}
