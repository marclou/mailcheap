"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// hasLabel: the label shows next to the icon, in an outlined button, for code that's the page's point to copy.
export default function ButtonCopy({ value, label = "Copy", hasLabel = false }) {
	const [isCopied, setIsCopied] = useState(false);
	const timeout = useRef(null);

	async function copy() {
		await navigator.clipboard.writeText(value);
		setIsCopied(true);
		clearTimeout(timeout.current);
		timeout.current = setTimeout(() => setIsCopied(false), 1500);
	}

	const Icon = isCopied ? Check : Copy;

	if (hasLabel) {
		return (
			<Button type="button" variant="outline" size="sm" onClick={copy} className="min-w-20">
				<Icon key={String(isCopied)} data-icon="inline-start" className="animate-icon-in" />
				<span aria-live="polite">{isCopied ? "Copied" : label}</span>
			</Button>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={copy}
					aria-label={label}
					className="relative text-muted-foreground after:absolute after:-inset-1.5 hover:text-foreground"
				>
					<Icon key={String(isCopied)} className="animate-icon-in" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{isCopied ? "Copied" : label}</TooltipContent>
		</Tooltip>
	);
}
