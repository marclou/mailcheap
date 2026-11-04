"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { openLinksOutside, updateEmailInPlace, withTransitions } from "@/lib/email-preview";
import { cn } from "@/lib/utils";

// fit="fill" stretches to the parent's height (editor); fit="content" grows to the email (report). desktopWidth, with
// fill: the desktop lays the email out as wide as a computer's mail app and scales it down whole to fit, so where it
// sits in a window wider than it shows. device and onDeviceChange: the device shown, for a parent that picks it too.
export default function PreviewEmail({
	html,
	toolbar,
	sender,
	subject,
	previewText,
	fit = "fill",
	desktopWidth,
	device: shownDevice,
	onDeviceChange,
	className,
}) {
	const [ownDevice, setOwnDevice] = useState("desktop");
	const device = shownDevice ?? ownDevice;
	const [contentHeight, setContentHeight] = useState(null);
	const frameRef = useRef(null);
	const isContentFit = fit === "content";

	useEffect(() => {
		if (!isContentFit) return;
		const frame = frameRef.current;
		// Measured after the width transition, since the email reflows at each width.
		const timeout = setTimeout(() => {
			const height = measureEmail(frame);
			if (height) setContentHeight(height);
		}, 350);
		return () => clearTimeout(timeout);
	}, [device, isContentFit]);

	return (
		<div className={cn("flex flex-col overflow-hidden rounded-xl bg-card shadow-border", className)}>
			<div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 pr-3 pl-2">
				<div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
					{DEVICES.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							aria-label={label}
							aria-pressed={device === id}
							onClick={() => {
								setOwnDevice(id);
								onDeviceChange?.(id);
								if (isContentFit) setContentHeight(null);
							}}
							className={cn(
								"relative grid size-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,box-shadow] duration-150 after:absolute after:-inset-1 hover:text-foreground",
								device === id && "bg-background text-foreground shadow-border"
							)}
						>
							<Icon className="size-3.5" />
						</button>
					))}
				</div>
				{toolbar}
			</div>

			{sender && (
				<div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
					<AvatarNewsletter newsletter={sender} size={40} className="rounded-full" />
					<div className="min-w-0 flex-1 text-sm">
						<p className="truncate">
							<span className="font-semibold">{sender.fromName || sender.name}</span>{" "}
							<span className="text-muted-foreground">&lt;{sender.fromEmail}&gt;</span>
						</p>
						<p className="truncate">
							<span className="font-medium">{subject || "No subject"}</span>
							{previewText && <span className="text-muted-foreground"> — {previewText}</span>}
						</p>
					</div>
				</div>
			)}

			<div className="flex min-h-0 flex-1 justify-center bg-muted/50 p-3 sm:p-5">
				{desktopWidth && !isContentFit ? (
					<FrameScaled
						html={html}
						width={device === "desktop" ? desktopWidth : null}
						className={device === "mobile" ? "w-[375px]" : "w-full"}
					/>
				) : (
					<FrameEmail
						ref={frameRef}
						html={html}
						onLoad={(event) => {
							if (!isContentFit) return;
							const height = measureEmail(event.currentTarget);
							if (height) setContentHeight(height);
						}}
						style={isContentFit ? { height: contentHeight ?? 640 } : undefined}
						className={cn(
							"max-w-full rounded-lg bg-white shadow-border transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
							isContentFit ? "min-h-48" : "h-[640px] lg:h-full",
							device === "mobile" ? "w-[375px]" : "w-full max-w-[760px]"
						)}
					/>
				)}
			</div>
		</div>
	);
}

// Laid out width wide and scaled down whole to fit, never up. Without a width, or where the email would come out too
// small to read, like on a phone's screen, it fills the frame as it is. A new email takes the place of the one shown
// value by value, for what changed to transition (updateEmailInPlace), or loads anew when its elements differ. Until a
// load ends, the frame still has the document it replaces: a change in between goes to the load.
function FrameScaled({ html, width, className }) {
	const boxRef = useRef(null);
	const frameRef = useRef(null);
	const isLoadingRef = useRef(true);
	const [box, setBox] = useState(null);
	const shownHtml = withTransitions(html);
	const [firstHtml] = useState(shownHtml);
	const hasFrame = Boolean(box);
	const ratio = box && width ? box.width / width : 1;
	const scale = ratio < MIN_SCALE ? 1 : Math.min(1, ratio);

	useLayoutEffect(() => {
		const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
		observer.observe(boxRef.current);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const frame = frameRef.current;
		if (!frame || (!isLoadingRef.current && updateEmailInPlace(frame, shownHtml)) || frame.srcdoc === shownHtml) return;
		isLoadingRef.current = true;
		frame.srcdoc = shownHtml;
	}, [shownHtml, hasFrame]);

	return (
		<div
			ref={boxRef}
			className={cn(
				"relative h-[640px] max-w-full overflow-hidden rounded-lg bg-white shadow-border transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] lg:h-full",
				className
			)}
		>
			{box && (
				<FrameEmail
					ref={frameRef}
					html={firstHtml}
					onLoad={() => {
						isLoadingRef.current = false;
					}}
					style={{ width: box.width / scale, height: box.height / scale, transform: `scale(${scale})` }}
					className="absolute top-0 left-0 origin-top-left"
				/>
			)}
		</div>
	);
}

function FrameEmail({ html, onLoad, ...props }) {
	return (
		<iframe
			title="Email preview"
			// Same origin lets the page read the email's height, change it in place and open its links outside it; without
			// allow-scripts nothing in it runs.
			sandbox="allow-same-origin"
			srcDoc={html}
			onLoad={(event) => {
				openLinksOutside(event.currentTarget);
				onLoad?.(event);
			}}
			{...props}
		/>
	);
}

// The email's own height, measured with the frame collapsed: a document is never shorter than its frame, so a short
// email would keep the frame's height, which a theme's colored page shows.
function measureEmail(frame) {
	const root = frame?.contentDocument?.documentElement;
	if (!root) return null;
	const { height, minHeight } = frame.style;
	frame.style.height = "0px";
	frame.style.minHeight = "0px";
	const contentHeight = root.scrollHeight;
	frame.style.height = height;
	frame.style.minHeight = minHeight;
	return contentHeight;
}

const MIN_SCALE = 0.5;
const DEVICES = [
	{ id: "desktop", label: "Desktop", icon: Monitor },
	{ id: "mobile", label: "Mobile", icon: Smartphone },
];
