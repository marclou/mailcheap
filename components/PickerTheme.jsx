"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { saveTheme } from "@/app/(app)/newsletters/actions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The get-started panel's design step: each theme as a tile in its colors and heading font (PanelGetStarted), in a row
// that scrolls sideways. A click applies it, as on the Design page, and the panel moves on to its next step; the
// Design page shows each one on the newsletter's website and in an email first. On that page, its own themes do it:
// two pickers on one screen would disagree about the one in use.
export default function PickerTheme({ newsletterId, themes, designPath }) {
	const pathname = usePathname();
	const router = useRouter();
	const [pickedId, setPickedId] = useState(null);
	const [, startTransition] = useTransition();
	if (pathname === designPath) return null;

	function pick({ id, name }) {
		setPickedId(id);
		startTransition(async () => {
			const result = await saveTheme(newsletterId, { preset: id });
			if (result?.error) {
				setPickedId(null);
				return void toast.error(result.error);
			}
			toast.success(`${name} applied`, { action: { label: "Customize", onClick: () => router.push(`${designPath}?customize`) } });
		});
	}

	return (
		<div className="flex w-full flex-col items-start gap-2.5">
			<RowScroll>
				{themes.map((theme) => (
					<li key={theme.id} className="shrink-0">
						<TileTheme theme={theme} isPicked={theme.id === pickedId} isDisabled={Boolean(pickedId)} onPick={() => pick(theme)} />
					</li>
				))}
			</RowScroll>
			<Link
				href={designPath}
				className="group/link inline-flex items-center gap-1 text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground"
			>
				Preview all themes
				<ArrowRight aria-hidden="true" className="size-3.5 transition-transform duration-150 group-hover/link:translate-x-0.5" />
			</Link>
		</div>
	);
}

// Runs to the step's edges, its first tile under the step's title, and fades out where more tiles wait. A mouse wheel
// scrolls it sideways while it can go further that way, then the panel.
function RowScroll({ children }) {
	const rowRef = useRef(null);
	const [edges, setEdges] = useState({ isAtStart: true, isAtEnd: false });

	useEffect(() => {
		const row = rowRef.current;
		const update = () =>
			setEdges({ isAtStart: row.scrollLeft <= 1, isAtEnd: row.scrollLeft + row.clientWidth >= row.scrollWidth - 1 });
		function scrollSideways(event) {
			if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
			const max = row.scrollWidth - row.clientWidth;
			if ((event.deltaY < 0 && row.scrollLeft <= 0) || (event.deltaY > 0 && row.scrollLeft >= max)) return;
			event.preventDefault();
			row.scrollLeft = Math.min(max, Math.max(0, row.scrollLeft + event.deltaY));
		}
		update();
		row.addEventListener("scroll", update, { passive: true });
		row.addEventListener("wheel", scrollSideways, { passive: false });
		return () => {
			row.removeEventListener("scroll", update);
			row.removeEventListener("wheel", scrollSideways);
		};
	}, []);

	const mask = `linear-gradient(to right, ${edges.isAtStart ? "#000" : "transparent"}, #000 1rem, #000 calc(100% - 1.25rem), ${edges.isAtEnd ? "#000" : "#0003"})`;
	return (
		<ul
			ref={rowRef}
			aria-label="Themes"
			style={{ maskImage: mask, WebkitMaskImage: mask }}
			className="-my-1.5 -mr-3 -ml-12 flex w-[calc(100%+3.75rem)] scroll-pr-6 scroll-pl-12 gap-2 overflow-x-auto overscroll-x-contain py-1.5 pr-3 pl-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{children}
		</ul>
	);
}

function TileTheme({ theme: { name, colors, font }, isPicked, isDisabled, onPick }) {
	return (
		<button
			type="button"
			onClick={onPick}
			disabled={isDisabled}
			aria-label={`Use ${name}`}
			className="group/tile flex w-15 flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none"
		>
			<span
				style={{ backgroundColor: colors.background, color: colors.text }}
				className={cn(
					"relative grid aspect-[4/3] w-full place-items-center rounded-lg inset-ring inset-ring-foreground/10 transition-[translate,scale,box-shadow,opacity] duration-150 ease-out group-hover/tile:-translate-y-0.5 group-hover/tile:shadow-[0_6px_14px_-6px_rgb(0_0_0/0.25)] group-active/tile:scale-[0.96]",
					isDisabled && !isPicked && "opacity-40"
				)}
			>
				{isPicked ? (
					<Loader2 className="size-4 animate-spin" aria-hidden="true" />
				) : (
					<span style={font} className="text-lg leading-none">
						Aa
					</span>
				)}
				<span style={{ backgroundColor: colors.accent }} className="absolute right-1.5 bottom-1.5 size-2 rounded-full" />
			</span>
			<span className="w-full truncate text-center text-[11px] leading-none text-muted-foreground transition-colors duration-150 group-hover/tile:text-foreground">
				{name}
			</span>
		</button>
	);
}
