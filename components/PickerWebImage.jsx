"use client";

import { useState } from "react";
import { Check, ImageUp } from "lucide-react";
import DialogImagePicker from "@/components/DialogImagePicker";
import ImageShareCard from "@/components/ImageShareCard";
import { cn } from "@/lib/utils";
import { WEB_CARD } from "@/lib/web-page";

// The picture of an issue's page, its cards on the website and its link previews (lib/web-page.js): one of the issue's
// own pictures, one uploaded or used before, or the card MailCheap draws with its title. value: the picked one, WEB_CARD,
// or "" for none, which shows autoImage, the content's first picture, or the card when it's null. pictures: the issue's
// own, in order. card: what the card shows (lib/share-card.js getIssueCard). isLarge: a grid of wide tiles, for the web
// page's editor, instead of a row of small ones.
export default function PickerWebImage({ value, pictures, autoImage, card, onChange, isDisabled = false, isLarge = false }) {
	const [isPicking, setIsPicking] = useState(false);
	const shown = value === WEB_CARD ? null : value || autoImage;
	const choices = value && value !== WEB_CARD && !pictures.includes(value) ? [...pictures, value] : pictures;
	const size = isLarge ? "w-full rounded-lg" : "w-16 rounded-md";

	return (
		<>
			<div
				role="radiogroup"
				aria-label="Image"
				className={isLarge ? "grid grid-cols-3 gap-2" : "flex flex-wrap items-center gap-2 py-2.5"}
			>
				{choices.map((url, index) => (
					<TileImage
						key={url}
						label={index < pictures.length ? `Picture ${index + 1} of the issue` : "Image you picked"}
						isSelected={shown === url}
						isDisabled={isDisabled}
						isLarge={isLarge}
						onSelect={() => onChange(url)}
						className={size}
					>
						{/* eslint-disable-next-line @next/next/no-img-element -- any https:// picture of the issue, at its own size */}
						<img src={url} alt="" loading="lazy" className="size-full object-cover" />
					</TileImage>
				))}
				<TileImage
					label="Card with the title"
					isSelected={shown === null}
					isDisabled={isDisabled}
					isLarge={isLarge}
					onSelect={() => onChange(WEB_CARD)}
					className={size}
				>
					<span className="@container block size-full">
						<ImageShareCard {...card} isFluid />
					</span>
				</TileImage>
				<button
					type="button"
					onClick={() => setIsPicking(true)}
					disabled={isDisabled}
					className={cn(
						"flex aspect-[1200/630] items-center justify-center gap-1 border border-dashed border-foreground/20 text-xs text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
						size,
						isLarge && "flex-col gap-1.5"
					)}
				>
					<ImageUp aria-hidden="true" className={isLarge ? "size-4" : "size-3.5"} />
					Upload
				</button>
			</div>
			<DialogImagePicker open={isPicking} onOpenChange={setIsPicking} currentUrl={shown ?? undefined} onSelect={({ url }) => onChange(url)} />
		</>
	);
}

function TileImage({ label, isSelected, isDisabled, isLarge, onSelect, className, children }) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={isSelected}
			aria-label={label}
			title={label}
			disabled={isDisabled}
			onClick={onSelect}
			className={cn(
				"relative aspect-[1200/630] shrink-0 overflow-hidden bg-muted outline-none transition-[box-shadow,scale,opacity] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
				isSelected ? "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)]" : "shadow-border hover:shadow-border-hover",
				className
			)}
		>
			{children}
			{isSelected && (
				<span
					className={cn(
						"absolute grid place-items-center rounded-full bg-foreground text-background shadow-sm",
						isLarge ? "top-1 right-1 size-4" : "top-0.5 right-0.5 size-3.5"
					)}
				>
					<Check className={isLarge ? "size-3" : "size-2.5"} strokeWidth={3} aria-hidden="true" />
				</span>
			)}
		</button>
	);
}
