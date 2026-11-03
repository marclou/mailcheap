"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Lock, Monitor, RotateCw, Smartphone, X } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeDate from "@/components/BadgeDate";
import { BarStatus } from "@/components/DialogPreviewEmail";
import FrameIssue from "@/components/FrameIssue";
import { ScopeTheme } from "@/components/PreviewTheme";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { forwardEscape, openLinksOutside } from "@/lib/email-preview";
import { getThemeStyleSheet, resolveTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

const SMALL_SCREEN = "(max-width: 639px)";
const DESKTOP = { minWidth: 1024, maxWidth: 1280 };
const PHONE = { width: 390, height: 844 };
const DEVICES = [
	{ id: "desktop", label: "Desktop", icon: Monitor },
	{ id: "mobile", label: "Mobile", icon: Smartphone },
];

// An issue's page as its website shows it once updated, over the whole dashboard like the email's preview: in a
// browser's window as wide as a desktop gives it, or on a phone. page: { url, title, description, body: { kind, html },
// date, author: { name, imageUrl } }, from the editor's values. newsletter: its name, picture and theme.
export default function DialogPreviewWebPage({ isOpen, onOpenChange, ...page }) {
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay className="bg-black/80 supports-backdrop-filter:backdrop-blur-md" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed inset-0 z-50 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0"
				>
					<DialogTitle className="sr-only">Preview</DialogTitle>
					<Stage {...page} onClose={() => onOpenChange(false)} />
				</DialogPrimitive.Content>
			</DialogPortal>
		</Dialog>
	);
}

// Narrower than the device, the device scales down whole instead of reflowing, so the page lays out as it would on it.
function Stage({ onClose, ...page }) {
	const [device, setDevice] = useState(() => (window.matchMedia(SMALL_SCREEN).matches ? "mobile" : "desktop"));
	const [space, setSpace] = useState(null);
	const spaceRef = useRef(null);
	const isPressOnDim = useRef(false);
	const isDesktop = device === "desktop";
	const width = isDesktop ? clamp(space?.width ?? DESKTOP.maxWidth, DESKTOP.minWidth, DESKTOP.maxWidth) : PHONE.width;
	const scale = space ? Math.min(1, space.width / width) : 1;
	const fullHeight = space ? space.height / scale : null;
	const height = isDesktop ? fullHeight : fullHeight && Math.min(PHONE.height, fullHeight);

	useLayoutEffect(() => {
		const observer = new ResizeObserver(([entry]) => setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }));
		observer.observe(spaceRef.current);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			data-dim
			onPointerDown={(event) => (isPressOnDim.current = isDim(event.target))}
			onClick={(event) => isPressOnDim.current && isDim(event.target) && onClose()}
			className="flex h-full flex-col"
		>
			<div data-dim className="grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 sm:gap-4 sm:px-5">
				<span data-dim />
				<div role="radiogroup" aria-label="Device" className="flex items-center gap-1 rounded-full bg-white/10 p-1">
					{DEVICES.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							role="radio"
							aria-checked={device === id}
							onClick={() => setDevice(id)}
							className={cn(
								"flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-[color,background-color,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-white/40 active:scale-[0.97]",
								device === id ? "bg-white text-zinc-900" : "text-white/70 hover:text-white"
							)}
						>
							<Icon className="size-4" aria-hidden="true" />
							{label}
						</button>
					))}
				</div>
				<div data-dim className="flex justify-end">
					<button
						type="button"
						onClick={onClose}
						aria-label="Close preview"
						className="grid size-9 place-items-center rounded-full bg-white/10 text-white outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/40 active:scale-[0.96]"
					>
						<X className="size-4" />
					</button>
				</div>
			</div>
			<div data-dim className="min-h-0 flex-1 px-3 pb-3 sm:px-8 sm:pb-8">
				<div ref={spaceRef} data-dim className="relative h-full">
					{space && (
						<div
							key={device}
							style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}
							className="absolute top-0 left-1/2 origin-top animate-fade-in"
						>
							{isDesktop ? <WindowBrowser {...page} /> : <PhoneBrowser {...page} />}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// A browser's window: its bar with the page's address, then the page.
function WindowBrowser({ url, ...page }) {
	return (
		<div className="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
			<div className="grid h-11 shrink-0 grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4">
				<span className="flex gap-2">
					{["bg-[#ff5f57]", "bg-[#febc2e]", "bg-[#28c840]"].map((color) => (
						<span key={color} aria-hidden="true" className={cn("size-3 rounded-full", color)} />
					))}
				</span>
				<AddressBar url={url} className="mx-auto w-full max-w-md" />
				<RotateCw aria-hidden="true" className="ml-auto size-3.5 text-zinc-400" />
			</div>
			<FramePage {...page} className="min-h-0 flex-1" />
		</div>
	);
}

// A phone in its browser: the page under the status bar, the address at the bottom, both in the page's colors.
function PhoneBrowser({ url, ...page }) {
	return (
		<div className="h-full rounded-[3rem] bg-zinc-950 p-3 shadow-2xl ring-1 ring-white/15">
			<ScopeTheme theme={resolveTheme(page.newsletter.theme)} className="relative flex h-full flex-col overflow-hidden rounded-[2.25rem]">
				<BarStatus />
				<FramePage {...page} className="min-h-0 flex-1" />
				<div className="shrink-0 border-t border-border/60 px-4 pt-2.5 pb-7">
					<AddressBar url={url} isThemed className="h-9 rounded-xl text-[13px]" />
				</div>
			</ScopeTheme>
		</div>
	);
}

// isThemed: in the page's colors, on the phone, rather than the window's.
function AddressBar({ url, isThemed = false, className }) {
	const { host, pathname } = new URL(url);
	return (
		<span
			className={cn(
				"flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs",
				isThemed ? "bg-muted text-muted-foreground" : "bg-white text-zinc-500 shadow-[0_0_0_1px_rgb(0_0_0/0.08)]",
				className
			)}
		>
			<Lock aria-hidden="true" className="size-3 shrink-0" />
			<span className="truncate">
				<span className={isThemed ? "text-foreground" : "text-zinc-900"}>{host}</span>
				{pathname}
			</span>
		</span>
	);
}

// The page in a frame of its own, laid out at the device's width with the dashboard's styles and the newsletter's theme
// on its body, as on its website. Nothing in the frame runs: what the editor holds only shows. Its links open outside.
function FramePage({ newsletter, className, ...page }) {
	const [body, setBody] = useState(null);
	const [head] = useState(() => getFrameHead(newsletter.theme));

	return (
		<>
			<iframe
				title="Web page preview"
				sandbox="allow-same-origin"
				srcDoc={`<!doctype html><html class="${document.documentElement.className}"><head>${head}</head><body class="bg-background text-foreground antialiased"></body></html>`}
				onLoad={(event) => {
					forwardEscape(event.currentTarget);
					openLinksOutside(event.currentTarget);
					setBody(event.currentTarget.contentDocument?.body ?? null);
				}}
				className={cn("block w-full bg-background", className)}
			/>
			{body && createPortal(<PageIssue newsletter={newsletter} {...page} />, body)}
		</>
	);
}

// The archive's issue page (app/archive/[slug]/p/[post]/page.js) in its own classes: its header, the issue's title,
// description, author and date, its content and the newsletter's pitch.
function PageIssue({ newsletter, title, description, author, date, body }) {
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
				<div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
					<span className="flex min-w-0 items-center gap-2.5 font-medium tracking-tight [font-family:var(--theme-font-heading)]">
						<AvatarNewsletter newsletter={newsletter} size={28} />
						<span className="truncate">{newsletter.name}</span>
					</span>
					<ButtonMock>Subscribe</ButtonMock>
				</div>
			</header>
			<main className="flex-1">
				<article className="mx-auto max-w-2xl px-5 pt-12 sm:pt-16">
					<header>
						<h1 className="text-4xl font-theme-heading text-balance sm:text-[2.75rem] sm:leading-[1.1]">{title}</h1>
						{description && <p className="mt-4 text-xl text-pretty text-muted-foreground">{description}</p>}
						<div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
							<span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
								<AvatarNewsletter newsletter={author} size={24} className="rounded-full" />
								<span className="truncate">{author.name}</span>
							</span>
							{date && <BadgeDate date={date} />}
						</div>
					</header>
					{body.kind === "article" ? (
						<div className="prose-issue mt-10" dangerouslySetInnerHTML={{ __html: body.html }} />
					) : (
						<FrameIssue html={body.html} className="-mx-5 mt-10 rounded-none sm:mx-0 sm:rounded-xl" />
					)}
				</article>
				<section className="mx-auto max-w-2xl px-5 pt-16 pb-24">
					<div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-10 text-center shadow-border sm:px-10">
						<AvatarNewsletter newsletter={newsletter} size={48} />
						<p className="text-2xl font-theme-heading text-balance">{newsletter.name}</p>
						{newsletter.description && <p className="max-w-md text-pretty text-muted-foreground">{newsletter.description}</p>}
						<div className="flex w-full max-w-sm items-center gap-1.5 rounded-xl bg-background p-1.5 shadow-border">
							<span className="min-w-0 flex-1 truncate px-2.5 text-left text-sm text-muted-foreground">you@example.com</span>
							<ButtonMock>Subscribe</ButtonMock>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}

function ButtonMock({ children }) {
	return (
		<span className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">{children}</span>
	);
}

// The dashboard's own styles, which hold the archive's classes, then the newsletter's theme over the frame's body.
function getFrameHead(theme) {
	const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((node) => node.outerHTML).join("");
	const themeStyles = getThemeStyleSheet(resolveTheme(theme));
	return `<meta name="viewport" content="width=device-width, initial-scale=1">${styles}${themeStyles ? `<style>${themeStyles}</style>` : ""}`;
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function isDim(target) {
	return target instanceof Element && target.hasAttribute("data-dim");
}
