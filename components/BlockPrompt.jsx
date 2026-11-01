"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown } from "lucide-react";
import ButtonCopy from "@/components/ButtonCopy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A prompt people read before they copy it into their AI agent: its first lines, then all of it on Show more. It never
// scrolls on its own, so scrolling over it moves the page to what's below.
export default function BlockPrompt({ prompt, title = "Prompt" }) {
	const id = useId();
	const figureRef = useRef(null);
	const [isOpen, setIsOpen] = useState(false);

	// Folded back, it's much shorter: the page comes back to it rather than staying below it.
	function toggle() {
		if (!isOpen) return void setIsOpen(true);
		flushSync(() => setIsOpen(false));
		figureRef.current?.scrollIntoView({ block: "nearest" });
	}

	return (
		<figure ref={figureRef} className="min-w-0 overflow-hidden rounded-xl bg-card shadow-border">
			<figcaption className="flex h-9 items-center justify-between gap-3 border-b border-border/60 pr-1.5 pl-3.5">
				<span className="truncate font-mono text-[11px] tracking-wide text-muted-foreground">{title}</span>
				<ButtonCopy value={prompt} label="Copy" hasLabel />
			</figcaption>
			<pre
				id={id}
				className={cn(
					"px-3.5 pt-3 pb-2 font-mono text-[12.5px] leading-[1.7] break-words whitespace-pre-wrap text-foreground/85",
					!isOpen && "max-h-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black_45%,transparent)]"
				)}
			>
				<code className="block max-w-[80ch] text-pretty">{prompt}</code>
			</pre>
			<div className="border-t border-border/60 p-1.5">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-expanded={isOpen}
					aria-controls={id}
					onClick={toggle}
					className="w-full text-muted-foreground"
				>
					{isOpen ? "Show less" : "Show more"}
					<ChevronDown data-icon="inline-end" className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
				</Button>
			</div>
		</figure>
	);
}
