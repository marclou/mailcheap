"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// How far down the window a section's heading counts as reached: past the sticky header, where a link to it lands
// (the headings' scroll-mt-24).
const REACHED_PX = 120;

// A help article's table of contents (ArticleHelp): a link to each section, and the one being read marked: the last
// whose heading reached the top. Links jump as any anchor does. At the end of the page, where the last headings can't
// reach the top, the section a link led to stays marked, else the last one.
export default function NavArticleSections({ sections }) {
	const [currentId, setCurrentId] = useState(sections[0]?.id);
	const linkedId = useRef(null);

	useEffect(() => {
		const headings = sections.map(({ id }) => document.getElementById(id)).filter(Boolean);
		let frame = 0;

		function update() {
			frame = 0;
			const isAtEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
			if (!isAtEnd) linkedId.current = null;
			const reached = headings.filter((heading) => heading.getBoundingClientRect().top <= REACHED_PX);
			const current = isAtEnd
				? (headings.find((heading) => heading.id === linkedId.current) ?? headings.at(-1))
				: (reached.at(-1) ?? headings[0]);
			setCurrentId(current?.id);
		}
		function schedule() {
			frame ||= window.requestAnimationFrame(update);
		}
		function follow() {
			linkedId.current = window.location.hash.slice(1);
			schedule();
		}

		follow();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		window.addEventListener("hashchange", follow);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			window.removeEventListener("hashchange", follow);
		};
	}, [sections]);

	function choose(event, id) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		linkedId.current = id;
		setCurrentId(id);
	}

	return (
		<nav aria-label="On this page" className="text-sm">
			<p className="mb-3 text-xs font-medium text-muted-foreground">On this page</p>
			<ul className="flex flex-col border-l border-border">
				{sections.map(({ id, title }) => {
					const isCurrent = id === currentId;
					return (
						<li key={id}>
							<a
								href={`#${id}`}
								aria-current={isCurrent ? "location" : undefined}
								onClick={(event) => choose(event, id)}
								className={cn(
									"-ml-px block border-l py-1.5 pl-3 leading-5 text-pretty transition-colors duration-150",
									isCurrent
										? "border-foreground font-medium text-foreground"
										: "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground"
								)}
							>
								{title}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
