"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearNotifications, getNotifications, markNotificationsRead } from "@/app/(app)/(notifications)/actions";
import { hasNewNotifications } from "@/lib/notification-rules";
import { toast } from "@/lib/toast";

const POLL_MS = 60_000;
// Coming back to the tab looks again, at most this often.
const RETURN_LOOK_MS = 15_000;

const NotificationsContext = createContext(null);

export function useNotifications() {
	return use(NotificationsContext);
}

// The notifications the bells show (components/ButtonNotifications.jsx): the sidebar's and the phone's top bar's share
// them. One look a minute keeps them fresh while the page is visible, and coming back to the tab looks at once. An open
// tray marks what it shows read: what it opened on, what comes in while it's open and the older ones it loads, which
// stay highlighted until it closes (fresh). Clear all takes what it shows and everything older off the list. initial:
// the layout's page of list_notifications, taken again whenever the layout renders again, like the refresh after an
// import finishes. supportChatPath: a link the support chat opens in place (siteExtensions), not a page.
export default function ProviderNotifications({ initial, supportChatPath = null, children }) {
	const [state, setState] = useState(() => ({ from: initial, ...toState(initial) }));
	const [fresh, setFresh] = useState(() => new Set());
	const [isOpen, setIsOpen] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const isOpenRef = useRef(false);
	// Bumped by each marking and clearing: a look that started before it still has those as unread or listed, and
	// doesn't count.
	const marks = useRef(0);
	// Bumped by each clearing: older ones loaded from before it are cleared too.
	const clears = useRef(0);
	if (state.from !== initial) setState({ ...state, from: initial, ...mergePage(state, initial) });

	const markShown = useCallback((shown) => {
		const ids = shown.filter(({ read }) => !read).map(({ id }) => id);
		if (ids.length === 0) return;
		const marked = new Set(ids);
		marks.current++;
		setFresh((current) => new Set([...current, ...ids]));
		setState((current) => ({
			...current,
			unread: Math.max(0, current.unread - current.notifications.filter(({ id, read }) => marked.has(id) && !read).length),
			notifications: current.notifications.map((notification) => (marked.has(notification.id) ? { ...notification, read: true } : notification)),
		}));
		markNotificationsRead(ids)
			.then((result) => {
				if (Number.isInteger(result?.unread)) setState((current) => ({ ...current, unread: result.unread }));
			})
			.catch(() => {});
	}, []);

	const look = useCallback(async () => {
		const started = marks.current;
		const page = await getNotifications().catch(() => null);
		if (!page?.notifications || started !== marks.current) return;
		setState((current) => ({ ...current, ...mergePage(current, page) }));
		if (isOpenRef.current) markShown(page.notifications);
	}, [markShown]);

	useEffect(() => {
		let lastLook = Date.now();
		function lookIfVisible() {
			if (document.visibilityState !== "visible") return;
			lastLook = Date.now();
			look();
		}
		function lookOnReturn() {
			if (Date.now() - lastLook > RETURN_LOOK_MS) lookIfVisible();
		}
		const timer = setInterval(lookIfVisible, POLL_MS);
		document.addEventListener("visibilitychange", lookOnReturn);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", lookOnReturn);
		};
	}, [look]);

	const { notifications, unread, nextCursor, ringKey } = state;
	const value = useMemo(
		() => ({
			notifications,
			// The badge goes as soon as the tray opens.
			unread: isOpen ? 0 : unread,
			hasMore: Boolean(nextCursor),
			isLoadingMore,
			fresh,
			ringKey,
			supportChatPath,
			open() {
				isOpenRef.current = true;
				setIsOpen(true);
				markShown(notifications);
				look();
			},
			close() {
				isOpenRef.current = false;
				setIsOpen(false);
				setFresh(new Set());
			},
			async loadMore() {
				if (!nextCursor || isLoadingMore) return;
				const started = clears.current;
				setIsLoadingMore(true);
				const page = await getNotifications(nextCursor).catch(() => null);
				setIsLoadingMore(false);
				if (!page?.notifications || started !== clears.current) return;
				setState((current) => ({ ...current, notifications: byNewest([...current.notifications, ...page.notifications]), nextCursor: page.nextCursor }));
				if (isOpenRef.current) markShown(page.notifications);
			},
			// What came in since the tray last looked stays: only the newest it shows and older go.
			async clear() {
				const until = notifications[0]?.at;
				if (!until) return;
				marks.current++;
				clears.current++;
				setFresh(new Set());
				setState((current) => {
					const kept = current.notifications.filter(({ at }) => at > until);
					return { ...current, notifications: kept, unread: kept.filter(({ read }) => !read).length, nextCursor: null };
				});
				const result = await clearNotifications(until).catch(() => null);
				if (Number.isInteger(result?.unread)) return void setState((current) => ({ ...current, unread: result.unread }));
				toast.error(result?.error ?? "Could not clear your notifications");
				look();
			},
		}),
		[notifications, unread, nextCursor, ringKey, isOpen, isLoadingMore, fresh, supportChatPath, look, markShown]
	);

	return <NotificationsContext value={value}>{children}</NotificationsContext>;
}

function toState(page) {
	return { notifications: page?.notifications ?? [], unread: page?.unread ?? 0, nextCursor: page?.nextCursor ?? null, ringKey: 0 };
}

// A new first page in place of what's loaded: it's what the server has now as far as it goes, and what Show older loaded
// past it stays.
function mergePage(current, page) {
	if (!Array.isArray(page?.notifications)) return {};
	const last = page.notifications.at(-1);
	const ids = new Set(page.notifications.map(({ id }) => id));
	const older = page.nextCursor && last ? current.notifications.filter((notification) => !ids.has(notification.id) && isOlder(notification, last)) : [];
	return {
		notifications: byNewest([...page.notifications, ...older]),
		unread: page.unread,
		nextCursor: older.length > 0 ? current.nextCursor : page.nextCursor,
		ringKey: hasNewNotifications(current, page) ? current.ringKey + 1 : current.ringKey,
	};
}

// Further down the list than b, which goes newest first.
function isOlder(a, b) {
	return a.at < b.at || (a.at === b.at && a.id < b.id);
}

// Newest first, each notification once: the first one listed wins.
function byNewest(list) {
	const seen = new Set();
	return list
		.filter(({ id }) => !seen.has(id) && seen.add(id))
		.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
