import Form from "next/form";
import { Search } from "lucide-react";

// A GET form: the search lives in the URL, next to the page's other parameters.
export default function FormSearchDirectory({ action, query, hidden = {}, placeholder }) {
	return (
		<Form action={action} scroll={false} role="search" className="relative w-full sm:w-72">
			{Object.entries(hidden).map(([name, value]) =>
				value ? <input key={name} type="hidden" name={name} value={value} /> : null
			)}
			<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="search"
				name="q"
				defaultValue={query}
				placeholder={placeholder}
				aria-label={placeholder}
				className="h-9 w-full rounded-lg border border-input bg-transparent pr-3 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
			/>
		</Form>
	);
}
