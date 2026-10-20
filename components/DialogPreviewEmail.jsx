"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
	Archive,
	ArrowLeft,
	ChevronDown,
	Ellipsis,
	Forward,
	Mail,
	Monitor,
	Pencil,
	Reply,
	Smartphone,
	Star,
	Trash2,
	Video,
	Wifi,
	X,
} from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import LogoGmail from "@/components/LogoGmail";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// The email over the whole dashboard on a dimmed backdrop: in a mail app's window as wide as a desktop gives it, or in
// Gmail on a phone. Escape, the close button and a click on the dimmed space close it; Radix keeps the focus inside
// meanwhile.
export default function DialogPreviewEmail({ isOpen, onOpenChange, onCloseAutoFocus, ...email }) {
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay className="bg-black/70" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					onCloseAutoFocus={onCloseAutoFocus}
					className="fixed inset-0 z-50 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0"
				>
					<DialogTitle className="sr-only">Preview</DialogTitle>
					<Stage {...email} onClose={() => onOpenChange(false)} />
				</DialogPrimitive.Content>
			</DialogPortal>
		</Dialog>
	);
}

// Narrower than the device (a phone showing the desktop), the device scales down whole instead of reflowing.
function Stage({ html, sender, subject, previewText, onClose }) {
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
			<div data-dim className="relative flex h-16 shrink-0 items-center justify-center px-16">
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
				<button
					type="button"
					onClick={onClose}
					aria-label="Close preview"
					className="absolute top-1/2 right-3 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/40 active:scale-[0.96] sm:right-5"
				>
					<X className="size-4" />
				</button>
			</div>
			<div data-dim className="min-h-0 flex-1 px-3 pb-3 sm:px-8 sm:pb-8">
				<div ref={spaceRef} data-dim className="relative h-full">
					{space && (
						<div
							key={device}
							style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}
							className="absolute top-0 left-1/2 origin-top animate-fade-in"
						>
							{isDesktop ? (
								<FrameDesktop sender={sender} subject={subject} html={html} />
							) : (
								<FramePhone sender={sender} subject={subject} previewText={previewText} html={html} />
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// A mail app's reading pane: the window's bar, then the message's header scrolling with the email, which takes the
// pane's whole width and centers itself like inboxes show it. The phone shows the preview text, as an inbox's list does.
function FrameDesktop({ sender, subject, html }) {
	return (
		<div className="flex h-full flex-col overflow-hidden rounded-xl bg-white text-zinc-900 shadow-2xl ring-1 ring-black/10">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4">
				{["bg-[#ff5f57]", "bg-[#febc2e]", "bg-[#28c840]"].map((color) => (
					<span key={color} aria-hidden="true" className={cn("size-3 rounded-full", color)} />
				))}
				<p className="min-w-0 flex-1 truncate px-16 text-center text-xs font-medium text-zinc-500">{subject || "No subject"}</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="border-b border-zinc-200 px-8 pt-6 pb-5">
					<h2 className="truncate text-xl font-semibold tracking-tight">{subject || "No subject"}</h2>
					<div className="mt-4 flex items-center gap-3 text-sm">
						<AvatarNewsletter newsletter={sender} size={40} className="rounded-full bg-zinc-100 text-zinc-500" />
						<div className="min-w-0 flex-1">
							<p className="truncate">
								<span className="font-semibold">{sender.fromName || sender.name}</span>{" "}
								<span className="text-zinc-500">&lt;{sender.fromEmail}&gt;</span>
							</p>
							<p className="truncate text-zinc-500">to me</p>
						</div>
						<span className="shrink-0 text-xs text-zinc-500">Now</span>
					</div>
				</div>
				<FrameEmail html={html} />
			</div>
		</div>
	);
}

// A phone in Gmail: the inbox first, with the issue on top as it lands, then the email once it's tapped, the way an
// app pushes a screen. The screen out of view is inert, and the focus follows the one in view.
function FramePhone({ sender, subject, previewText, html }) {
	const [isEmailOpen, setIsEmailOpen] = useState(false);
	const rowRef = useRef(null);
	const backRef = useRef(null);
	const snippet = useMemo(() => previewText?.trim() || getBodyText(html), [previewText, html]);
	const email = { sender, name: sender.fromName || sender.name, subject: subject || "No subject" };

	function openEmail() {
		flushSync(() => setIsEmailOpen(true));
		backRef.current?.focus({ preventScroll: true });
	}

	function closeEmail() {
		flushSync(() => setIsEmailOpen(false));
		rowRef.current?.focus({ preventScroll: true });
	}

	return (
		<div className="h-full rounded-[3rem] bg-zinc-950 p-3 shadow-2xl ring-1 ring-white/15">
			<div className="relative flex h-full flex-col overflow-hidden rounded-[2.25rem] bg-white text-zinc-900">
				<BarStatus />
				<div className="relative min-h-0 flex-1 overflow-hidden">
					<ScreenInbox {...email} snippet={snippet} rowRef={rowRef} onOpen={openEmail} isHidden={isEmailOpen} />
					<ScreenEmail {...email} html={html} backRef={backRef} onBack={closeEmail} isHidden={!isEmailOpen} />
				</div>
			</div>
		</div>
	);
}

function BarStatus() {
	return (
		<div className="relative flex h-11 shrink-0 items-center justify-between pr-6 pl-8 text-[15px] font-semibold tabular-nums">
			<span>9:41</span>
			<span aria-hidden="true" className="absolute top-2.5 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-zinc-950" />
			<span aria-hidden="true" className="flex items-center gap-1.5">
				<svg viewBox="0 0 18 12" fill="currentColor" className="h-3 w-[18px]">
					<rect x="0" y="8" width="3" height="4" rx="1" />
					<rect x="5" y="5.5" width="3" height="6.5" rx="1" />
					<rect x="10" y="3" width="3" height="9" rx="1" />
					<rect x="15" y="0" width="3" height="12" rx="1" />
				</svg>
				<Wifi className="size-4" strokeWidth={2.75} />
				<span className="flex items-center gap-px">
					<span className="flex h-[13px] w-[25px] rounded-[4px] p-[1.5px] shadow-[inset_0_0_0_1px_rgb(24_24_27/0.35)]">
						<span className="h-full w-4/5 rounded-[2px] bg-[#34c759]" />
					</span>
					<span className="h-1 w-[1.5px] rounded-r-sm bg-zinc-900/40" />
				</span>
			</span>
		</div>
	);
}

function ScreenInbox({ sender, name, subject, snippet, rowRef, onOpen, isHidden }) {
	return (
		<div
			inert={isHidden}
			className={cn(
				"absolute inset-0 flex flex-col bg-white transition-[translate,opacity] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
				isHidden && "-translate-x-1/4 opacity-60"
			)}
		>
			<div className="shrink-0 px-3 pt-1 pb-1">
				<div className="flex h-12 items-center gap-3.5 rounded-full bg-[#eaf1fb] pr-2 pl-4 text-[15px] text-zinc-600">
					<LogoGmail className="h-3.5 w-[19px] shrink-0" />
					<span className="flex-1">Search in mail</span>
					<span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-[#7b1fa2] text-sm font-medium text-white">
						M
					</span>
				</div>
			</div>
			<p className="shrink-0 px-4 pt-3 pb-1 text-xs font-medium text-zinc-500">Primary</p>
			<ul className="min-h-0 flex-1 overflow-y-auto pb-28 [scrollbar-width:none]">
				<li>
					<button
						ref={rowRef}
						type="button"
						onClick={onOpen}
						className="flex w-full items-start gap-3 bg-[#e8f0fe] px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-[#dde8fc] focus-visible:bg-[#d3e3fd] active:bg-[#d3e3fd]"
					>
						<AvatarNewsletter newsletter={sender} size={40} className="rounded-full bg-white text-zinc-500" />
						<RowInbox from={name} subject={subject} snippet={snippet} time="9:41 AM" isUnread />
					</button>
				</li>
				{INBOX.map((email) => (
					<li key={email.from} className="flex items-start gap-3 px-4 py-3">
						<span
							aria-hidden="true"
							style={{ backgroundColor: email.color }}
							className="grid size-10 shrink-0 place-items-center rounded-full text-base font-medium text-white"
						>
							{email.from[0]}
						</span>
						<RowInbox {...email} />
					</li>
				))}
			</ul>
			<div aria-hidden="true" className="absolute right-4 bottom-[4.75rem] flex h-14 items-center gap-3 rounded-2xl bg-[#c2e7ff] px-5 text-sm font-medium shadow-md">
				<Pencil className="size-5" />
				Compose
			</div>
			<div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-16 items-start justify-around border-t border-zinc-200 bg-[#f6f8fc] pt-2.5">
				<span className="relative grid h-8 w-16 place-items-center rounded-full bg-[#d3e3fd]">
					<Mail className="size-5" />
					<span className="absolute -top-1 right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#c5221f] px-1 text-[10px] font-semibold text-white">
						1
					</span>
				</span>
				<span className="grid h-8 w-16 place-items-center text-zinc-600">
					<Video className="size-5" />
				</span>
			</div>
		</div>
	);
}

function RowInbox({ from, subject, snippet, time, isUnread = false }) {
	return (
		<span className="min-w-0 flex-1">
			<span className="flex items-baseline gap-2">
				<span className={cn("min-w-0 flex-1 truncate text-[15px]", isUnread ? "font-bold" : "text-zinc-700")}>{from}</span>
				<span className={cn("shrink-0 text-xs", isUnread ? "font-bold" : "text-zinc-500")}>{time}</span>
			</span>
			<span className={cn("block truncate text-sm", isUnread ? "font-bold" : "text-zinc-700")}>{subject}</span>
			<span className="flex items-center gap-3">
				<span className="min-w-0 flex-1 truncate text-sm text-zinc-500">{snippet}</span>
				<Star aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />
			</span>
		</span>
	);
}

function ScreenEmail({ sender, name, subject, html, backRef, onBack, isHidden }) {
	return (
		<div
			inert={isHidden}
			className={cn(
				"absolute inset-0 flex flex-col bg-white shadow-[-12px_0_24px_-12px_rgb(0_0_0/0.25)] transition-[translate] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
				isHidden && "translate-x-full"
			)}
		>
			<div className="flex h-12 shrink-0 items-center px-1.5 text-zinc-700">
				<button
					ref={backRef}
					type="button"
					onClick={onBack}
					aria-label="Back to the inbox"
					className="grid size-10 place-items-center rounded-full outline-none transition-colors duration-150 hover:bg-zinc-100 focus-visible:bg-zinc-100"
				>
					<ArrowLeft className="size-5" />
				</button>
				<span className="flex-1" />
				{EMAIL_ACTIONS.map(({ name, icon: Icon }) => (
					<span key={name} aria-hidden="true" className="grid size-10 place-items-center">
						<Icon className="size-5" />
					</span>
				))}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none]">
				<div className="px-4 pt-1 pb-3">
					<div className="flex items-start gap-3">
						<p className="min-w-0 flex-1 text-[22px] leading-snug">
							{subject}
							<span className="ml-2 inline-block rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-[11px] leading-none text-zinc-600">
								Inbox
							</span>
						</p>
						<Star aria-hidden="true" className="mt-1.5 size-5 shrink-0 text-zinc-500" />
					</div>
					<div className="mt-5 flex items-center gap-3">
						<AvatarNewsletter newsletter={sender} size={40} className="rounded-full bg-zinc-100 text-zinc-500" />
						<div className="min-w-0 flex-1">
							<p className="flex items-baseline gap-1.5">
								<span className="truncate text-[15px] font-semibold">{name}</span>
								<span className="shrink-0 text-[13px] text-zinc-500">9:41 AM</span>
							</p>
							<p className="flex items-center gap-0.5 text-[13px] text-zinc-500">
								to me
								<ChevronDown aria-hidden="true" className="size-3.5" />
							</p>
						</div>
						<Reply aria-hidden="true" className="size-5 shrink-0 text-zinc-600" />
						<Ellipsis aria-hidden="true" className="size-5 shrink-0 text-zinc-600" />
					</div>
				</div>
				<FrameEmail html={html} />
				<div aria-hidden="true" className="flex gap-3 px-4 pt-6 pb-10">
					{REPLIES.map(({ label, icon: Icon }) => (
						<span
							key={label}
							className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-zinc-300 text-sm font-medium text-zinc-700"
						>
							<Icon className="size-4" />
							{label}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

// As tall as the email, so the screen around it scrolls the message's header away with the email, as mail apps do.
function FrameEmail({ html }) {
	// Without allow-scripts nothing in the email runs; same origin only lets the frame be sized and Escape out.
	return (
		<iframe
			title="Email preview"
			sandbox="allow-same-origin"
			srcDoc={html}
			onLoad={(event) => {
				forwardEscape(event.currentTarget);
				fitToEmail(event.currentTarget);
			}}
			className="block h-160 w-full bg-white"
		/>
	);
}

// Measured collapsed first, for the email's own height whatever the frame's. Fonts and pictures that come later can
// only add to it, so the screen never loses its scroll.
function fitToEmail(frame) {
	const email = frame.contentDocument;
	if (!email) return;
	const fit = () => (frame.style.height = `${email.documentElement.scrollHeight}px`);
	frame.style.height = "0px";
	fit();
	email.fonts?.ready.then(fit);
	email.addEventListener("load", fit, true);
}

// A click in the email puts the focus in its frame, whose key presses never reach the dashboard: Escape there is passed
// on to the dialog, which closes on it. Each new email is a new document, so each load listens again.
function forwardEscape(frame) {
	frame.contentDocument?.addEventListener("keydown", (event) => {
		if (event.key === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	});
}

// What inboxes show after the subject without preview text: the email's first words, a space between blocks.
function getBodyText(html) {
	const document = new DOMParser().parseFromString(html, "text/html");
	for (const element of document.querySelectorAll("[data-preheader], style, script")) element.remove();
	for (const element of document.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, td, br, blockquote")) element.after(" ");
	return (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function isDim(target) {
	return target instanceof Element && target.hasAttribute("data-dim");
}

const SMALL_SCREEN = "(max-width: 639px)";
const DESKTOP = { minWidth: 1024, maxWidth: 1280 };
const PHONE = { width: 390, height: 844 };
const DEVICES = [
	{ id: "desktop", label: "Desktop", icon: Monitor },
	{ id: "mobile", label: "Mobile", icon: Smartphone },
];
const EMAIL_ACTIONS = [
	{ name: "archive", icon: Archive },
	{ name: "delete", icon: Trash2 },
	{ name: "unread", icon: Mail },
	{ name: "more", icon: Ellipsis },
];
const REPLIES = [
	{ label: "Reply", icon: Reply },
	{ label: "Forward", icon: Forward },
];
// The phone's inbox around the issue.
const INBOX = [
	{ from: "Julia Martins", subject: "Dinner on Saturday?", snippet: "We booked the place by the river, does 8 work for you?", time: "9:12 AM", color: "#e8710a" },
	{ from: "Calendar", subject: "Reminder: dentist at 11:00", snippet: "Tomorrow, 11:00 to 11:30. Don't forget your insurance card", time: "8:30 AM", color: "#1a73e8" },
	{ from: "Tom Becker", subject: "Photos from the trip", snippet: "Finally sorted them, the link is inside. The sunset ones came out great", time: "Yesterday", color: "#188038" },
	{ from: "Order updates", subject: "Your order has shipped", snippet: "It's on its way and should arrive by Thursday. Track your package", time: "Yesterday", color: "#9334e6" },
	{ from: "Lea Dubois", subject: "Re: Plans for the weekend", snippet: "Sounds good! I'll bring the board games and something sweet", time: "Wed", color: "#d93025" },
	{ from: "Your bank", subject: "Your statement is ready", snippet: "Your monthly statement is now available in the app", time: "Tue", color: "#00897b" },
	{ from: "Sam Okafor", subject: "Quick question", snippet: "Do you still have the notes from Monday's meeting? I lost mine", time: "Mon", color: "#f9ab00" },
];
