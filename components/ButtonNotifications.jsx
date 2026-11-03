"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
	BadgeCheck,
	Ban,
	Bell,
	CalendarX2,
	CircleAlert,
	CircleCheck,
	CirclePause,
	FileUp,
	FileWarning,
	Flag,
	Hourglass,
	Loader2,
	MailWarning,
	MailX,
	OctagonX,
	Send,
	ShieldAlert,
	TriangleAlert,
	UserPlus,
	UserX,
} from "lucide-react";
import ImageFavicon from "@/components/ImageFavicon";
import LinkHelp from "@/components/LinkHelp";
import LogoGmail from "@/components/LogoGmail";
import { useNotifications } from "@/components/ProviderNotifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeShort, formatSendTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// The bell and its tray: a row of the sidebar (variant "sidebar"), or a button of the phone's top bar ("header"). Its
// red badge counts what's unread until the tray opens, which marks what it shows read (components/ProviderNotifications.jsx):
// at the end of the sidebar's row, clear of its label, and on the bell's corner once the sidebar is folded or on a phone.
export default function ButtonNotifications({ variant = "sidebar" }) {
	const { unread, ringKey, open, close } = useNotifications();
	const [isOpen, setIsOpen] = useState(false);
	const titleId = useId();
	const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
	const isSidebar = variant === "sidebar";

	function onOpenChange(next) {
		setIsOpen(next);
		if (next) open();
		else close();
	}

	const bell = (
		<span className="relative grid shrink-0 place-items-center">
			<Bell key={ringKey} className={cn("size-4", ringKey > 0 && "animate-ring")} aria-hidden="true" />
			{unread > 0 && (
				<span
					aria-hidden="true"
					className={cn(
						"absolute -top-1.5 -right-2.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-red-500 px-[3px] text-[9px] leading-none font-semibold text-white tabular-nums ring-2 ring-background animate-icon-in",
						isSidebar && "hidden sidebar-folded:grid"
					)}
				>
					{unread > 9 ? "9+" : unread}
				</span>
			)}
		</span>
	);

	return (
		<Popover open={isOpen} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				{isSidebar ? (
					<button
						type="button"
						aria-label={label}
						className="flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-lg pr-3 pl-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
					>
						<span className="transition-[translate] duration-250 ease-drawer motion-reduce:transition-none sidebar-folded:translate-x-1">{bell}</span>
						<span className="sidebar-label">Notifications</span>
						{unread > 0 && (
							<span
								aria-hidden="true"
								className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[11px] leading-none font-semibold text-white tabular-nums sidebar-label animate-icon-in"
							>
								{unread > 99 ? "99+" : unread}
							</span>
						)}
					</button>
				) : (
					<Button variant="ghost" size="icon" aria-label={label} className="data-[state=open]:bg-muted">
						{bell}
					</Button>
				)}
			</PopoverTrigger>
			<PopoverContent
				side={isSidebar ? "right" : "bottom"}
				align={isSidebar ? "start" : "end"}
				sideOffset={isSidebar ? 12 : 8}
				collisionPadding={8}
				aria-labelledby={titleId}
				className="w-[min(23rem,calc(100vw-1rem))] overflow-hidden p-0"
			>
				<TrayNotifications titleId={titleId} onNavigate={() => onOpenChange(false)} />
			</PopoverContent>
		</Popover>
	);
}

function TrayNotifications({ titleId, onNavigate }) {
	const { notifications, fresh, hasMore, isLoadingMore, loadMore, clear, supportChatPath } = useNotifications();
	return (
		<div className="flex max-h-[min(34rem,var(--radix-popover-content-available-height))] flex-col">
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-4">
				<h2 id={titleId} className="text-sm font-semibold">
					Notifications
				</h2>
				{fresh.size > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fresh.size} new</span>}
				{notifications.length > 0 && (
					<Button variant="ghost" size="xs" onClick={clear} className="ml-auto text-muted-foreground">
						Clear all
					</Button>
				)}
			</div>
			{notifications.length === 0 ? (
				<EmptyNotifications />
			) : (
				<ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto overscroll-contain">
					{notifications.map((notification) => (
						<li key={notification.id}>
							<RowNotification
								notification={notification}
								isFresh={fresh.has(notification.id)}
								supportChatPath={supportChatPath}
								onNavigate={onNavigate}
							/>
						</li>
					))}
					{hasMore && (
						<li>
							<button
								type="button"
								onClick={loadMore}
								disabled={isLoadingMore}
								className="flex h-10 w-full items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 disabled:pointer-events-none"
							>
								{isLoadingMore && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
								Show older
							</button>
						</li>
					)}
				</ul>
			)}
		</div>
	);
}

// A notification and the page it's about: a link that closes the tray, the support chat's link opening the chat in
// place, or no link when it's about nothing to open.
function RowNotification({ notification, isFresh, supportChatPath, onNavigate }) {
	const { kind, tone, title, body, path, domain, at } = notification;
	const className = cn(
		"relative flex gap-3 px-4 py-3 text-left outline-none transition-colors duration-150",
		path && "hover:bg-muted/60 focus-visible:bg-muted/60",
		isFresh && "bg-sky-500/[0.05] dark:bg-sky-400/[0.06]"
	);
	const content = (
		<>
			{isFresh && <span aria-hidden="true" className="absolute top-[1.5625rem] left-1.5 size-1.5 rounded-full bg-sky-500" />}
			<IconNotification kind={kind} tone={tone} domain={domain} />
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-3">
					<span className="min-w-0 flex-1 text-sm font-medium text-pretty text-foreground">
						{isFresh && <span className="sr-only">New: </span>}
						{title}
					</span>
					<time dateTime={at} title={formatSendTime(at)} className="shrink-0 text-xs text-muted-foreground tabular-nums">
						{formatRelativeShort(at)}
					</time>
				</span>
				{body && <span className="mt-0.5 line-clamp-4 text-[13px] leading-5 text-pretty text-muted-foreground">{body}</span>}
			</span>
		</>
	);
	if (!path) return <div className={className}>{content}</div>;
	if (path === supportChatPath) {
		return (
			<a href={path} onClick={onNavigate} className={className}>
				{content}
			</a>
		);
	}
	return (
		<Link href={path} onClick={onNavigate} className={className}>
			{content}
		</Link>
	);
}

function IconNotification({ kind, tone, domain }) {
	const Icon = KIND_ICONS[kind] ?? TONE_ICONS[tone] ?? Bell;
	return (
		<span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE_TILES[tone] ?? TONE_TILES.info)}>
			{domain ? (
				<ImageFavicon domain={domain} size={16} />
			) : kind === "gmail-warning" ? (
				<LogoGmail size={16} />
			) : (
				<Icon className="size-4" />
			)}
		</span>
	);
}

function EmptyNotifications() {
	return (
		<div className="flex flex-col items-center px-6 py-10 text-center">
			<span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
				<Bell className="size-[1.125rem]" aria-hidden="true" />
			</span>
			<p className="mt-3 text-sm font-medium">No notifications</p>
			<p className="mt-1 max-w-64 text-[13px] leading-5 text-pretty text-muted-foreground">
				A paused campaign, a finished import or anything else that needs you shows up here.{" "}
				<LinkHelp article="notifications" />
			</p>
		</div>
	);
}

const TONE_TILES = {
	urgent: "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400",
	warning: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
	success: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
	info: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
};

const TONE_ICONS = {
	urgent: CircleAlert,
	warning: TriangleAlert,
	success: CircleCheck,
	info: Bell,
};

// By kind (lib/notification-rules.js); one missing here takes its tone's.
const KIND_ICONS = {
	"account-blocked": Ban,
	"campaign-paused": CirclePause,
	"content-rejected": OctagonX,
	"scheduled-send": CalendarX2,
	"signup-email-rejected": MailX,
	"welcome-paused": MailWarning,
	"welcome-cap": MailWarning,
	"account-signup-flood": UserX,
	"api-signup-flood": UserX,
	"signup-flood": UserX,
	"embed-flood": ShieldAlert,
	"embed-flood-plain": ShieldAlert,
	"embed-plain-off": ShieldAlert,
	complaints: Flag,
	"campaign-sent": Send,
	"import-started": FileUp,
	"import-done": UserPlus,
	"import-stopped": FileWarning,
	"issue-review": Hourglass,
	"issue-approved": BadgeCheck,
};
