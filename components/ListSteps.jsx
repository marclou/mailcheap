"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import CircleStep from "@/components/CircleStep";
import { cn } from "@/lib/utils";

// The get-started panel's steps (PanelGetStarted), one open at a time: the next one to do at first, and any other a
// click opens, to see what it takes before it's its turn. Once a step is done the list opens the next one. A step's
// content renders once it's first opened, so the design step's fonts only load when its themes show.
export default function ListSteps({ steps, nextId }) {
	const [openId, setOpenId] = useState(nextId);
	const [openedIds, setOpenedIds] = useState(() => new Set([nextId]));
	const [shownNextId, setShownNextId] = useState(nextId);

	if (nextId !== shownNextId) {
		setShownNextId(nextId);
		setOpenId(nextId);
		setOpenedIds((ids) => new Set(ids).add(nextId));
	}

	function toggle(id) {
		setOpenId((current) => (current === id ? null : id));
		setOpenedIds((ids) => (ids.has(id) ? ids : new Set(ids).add(id)));
	}

	return (
		<ol className="flex flex-col gap-0.5">
			{steps.map((step) => (
				<ItemStep
					key={step.id}
					step={step}
					isNext={step.id === nextId}
					isOpen={step.id === openId}
					hasOpened={openedIds.has(step.id)}
					onToggle={() => toggle(step.id)}
				/>
			))}
		</ol>
	);
}

function ItemStep({ step, isNext, isOpen, hasOpened, onToggle }) {
	const contentId = useId();
	return (
		<li
			aria-current={isNext ? "step" : undefined}
			className={cn("group rounded-lg transition-colors duration-200 ease-out", isOpen && "bg-muted/60")}
		>
			<button
				type="button"
				aria-expanded={isOpen}
				aria-controls={contentId}
				onClick={onToggle}
				className={cn(
					"flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
					!isOpen && "hover:bg-muted/60"
				)}
			>
				<CircleStep number={step.number} isDone={step.isDone} isNext={isNext && !step.isDone} />
				<span className={cn("truncate", step.isDone && "text-muted-foreground", isOpen && "font-medium")}>{step.title}</span>
				{step.isDone && <span className="sr-only">(done)</span>}
				{step.decoration}
				{step.isOptional && (
					<span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs text-muted-foreground inset-ring inset-ring-foreground/10">
						Optional
					</span>
				)}
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
						isOpen && "rotate-180"
					)}
				/>
			</button>
			<div
				id={contentId}
				inert={!isOpen}
				className={cn(
					"grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
					isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="-mt-1 flex flex-col items-start gap-3 pr-3 pb-3 pl-12">{hasOpened && step.content}</div>
				</div>
			</div>
		</li>
	);
}
