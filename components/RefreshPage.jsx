"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A page whose numbers are still coming in, like a report as its send goes out (lib/report-stats.js), takes them again
// from the server every `seconds`, without a reload and keeping what's open on it. The page stops it by no longer
// rendering it.
export default function RefreshPage({ seconds }) {
	const router = useRouter();

	useEffect(() => refreshEvery(seconds * 1000, () => router.refresh()), [router, seconds]);

	return null;
}

// A refresh comes due every ms and goes as soon as the tab is visible and online: one that came due while it wasn't
// goes the moment it is. Never offline, since a refresh that can't reach the server loads the whole page again (Next.js
// falls back to a browser navigation). Returns what stops it.
export function refreshEvery(ms, refresh) {
	let isDue = false;
	let timer = setTimeout(becomeDue, ms);
	function becomeDue() {
		isDue = true;
		refreshIfDue();
	}
	function refreshIfDue() {
		if (!isDue || document.visibilityState !== "visible" || !navigator.onLine) return;
		isDue = false;
		timer = setTimeout(becomeDue, ms);
		refresh();
	}
	document.addEventListener("visibilitychange", refreshIfDue);
	window.addEventListener("online", refreshIfDue);
	return () => {
		clearTimeout(timer);
		document.removeEventListener("visibilitychange", refreshIfDue);
		window.removeEventListener("online", refreshIfDue);
	};
}
