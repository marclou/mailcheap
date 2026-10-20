"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

const ALL_TAGS = "__all";

// The search by address and, once contacts have tags, a filter by tag. tags: [{ name, contacts }], most used first.
export default function FilterContacts({ tags = [] }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [query, setQuery] = useState(searchParams.get("q") ?? "");
	const [isPending, startTransition] = useTransition();
	const timeout = useRef(null);
	const tag = searchParams.get("tag") ?? "";

	function navigate(changes) {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(changes)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		params.delete("page");
		startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
	}

	function onQueryChange(event) {
		const value = event.target.value;
		setQuery(value);
		clearTimeout(timeout.current);
		timeout.current = setTimeout(() => navigate({ q: value.trim() }), 300);
	}

	useEffect(() => () => clearTimeout(timeout.current), []);

	return (
		<div className="flex min-w-0 flex-1 gap-2">
			<div className="relative min-w-0 flex-1">
				{isPending ? (
					<Loader2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
				) : (
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				)}
				<Input
					type="search"
					value={query}
					onChange={onQueryChange}
					placeholder="Search by email"
					aria-label="Search by email"
					className="h-9 pl-8"
				/>
			</div>
			{(tags.length > 0 || tag) && (
				<Select value={tag || ALL_TAGS} onValueChange={(value) => navigate({ tag: value === ALL_TAGS ? "" : value })}>
					<SelectTrigger className="h-9 w-36 shrink-0 sm:w-44" aria-label="Tag">
						{/* The name alone: the items also show their counts. */}
						<SelectValue>{tag ? <span className="truncate">{tag}</span> : <span className="text-muted-foreground">All tags</span>}</SelectValue>
					</SelectTrigger>
					<SelectContent align="end">
						<SelectItem value={ALL_TAGS}>All tags</SelectItem>
						<SelectSeparator />
						{tag && !tags.some(({ name }) => name === tag) && <SelectItem value={tag}>{tag}</SelectItem>}
						{tags.map(({ name, contacts }) => (
							<SelectItem key={name} value={name}>
								<span className="flex w-full items-center justify-between gap-3">
									<span className="truncate">{name}</span>
									<span className="text-xs text-muted-foreground tabular-nums">{formatNumber(contacts)}</span>
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}
