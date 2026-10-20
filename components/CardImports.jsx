"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Loader2, X } from "lucide-react";
import { getImports } from "@/app/(app)/contacts/actions";
import { formatNumber } from "@/lib/format";
import { DROP_REASONS } from "@/lib/import-checks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;
// A finished import stays on the page this long, unless dismissed.
const RECENT_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "mailcheap:dismissed-imports";
const DISMISSED_EVENT = "mailcheap:dismissed-imports";

// The newsletter's imports going on in the background, and the ones that just finished: counts as the rows go in, a
// toast when one finishes. imports: lib/import-jobs.js toImportView, newest first; the page sends new ones on refresh.
export default function CardImports({ newsletterId, imports: initialImports }) {
	const router = useRouter();
	const [state, setState] = useState({ from: initialImports, imports: initialImports });
	if (state.from !== initialImports) setState({ from: initialImports, imports: initialImports });
	const { imports } = state;
	const dismissedValue = useSyncExternalStore(subscribeDismissed, readDismissedValue, () => "[]");
	const dismissed = useMemo(() => parseDismissed(dismissedValue), [dismissedValue]);
	const statuses = useRef(new Map(initialImports.map((item) => [item.importId, item.status])));
	const isRunning = imports.some((item) => item.status === "processing");

	useEffect(() => {
		if (!isRunning) return;
		let isCancelled = false;
		const timer = setInterval(async () => {
			const result = await getImports(newsletterId);
			if (!isCancelled && Array.isArray(result?.imports)) setState((current) => ({ ...current, imports: result.imports }));
		}, POLL_MS);
		return () => {
			isCancelled = true;
			clearInterval(timer);
		};
	}, [isRunning, newsletterId]);

	// An import this page saw running that just finished: a toast, and the list shows its contacts.
	useEffect(() => {
		let hasFinished = false;
		for (const item of imports) {
			if (statuses.current.get(item.importId) === "processing" && item.status !== "processing") {
				notifyFinished(item);
				hasFinished = true;
			}
		}
		statuses.current = new Map(imports.map((item) => [item.importId, item.status]));
		if (hasFinished) router.refresh();
	}, [imports, router]);

	function dismiss(importId) {
		try {
			localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed, importId].slice(-20)));
		} catch {}
		window.dispatchEvent(new Event(DISMISSED_EVENT));
	}

	const shown = imports.filter((item) => item.status === "processing" || (isRecent(item) && !dismissed.includes(item.importId)));
	if (shown.length === 0) return null;
	return (
		<div className="flex flex-col gap-2">
			{shown.map((item) => (
				<RowImport key={item.importId} item={item} onDismiss={() => dismiss(item.importId)} />
			))}
		</div>
	);
}

function RowImport({ item, onDismiss }) {
	const [isOpen, setIsOpen] = useState(false);
	const dropped = Object.entries(item.dropped).filter(([, count]) => count > 0);
	const droppedTotal = dropped.reduce((sum, [, count]) => sum + count, 0);
	const isRunning = item.status === "processing";
	const name = item.fileName || "contacts";
	return (
		<div className="rounded-xl px-4 py-3 shadow-border animate-enter">
			<div className="flex items-center gap-3">
				<IconStatus status={item.status} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">
						{isRunning ? `Importing ${name}` : item.status === "failed" ? `Import of ${name} stopped` : `Imported ${name}`}
					</p>
					<p className="truncate text-xs text-muted-foreground tabular-nums">{describeProgress(item, droppedTotal)}</p>
				</div>
				{!isRunning && droppedTotal > 0 && (
					<button
						type="button"
						onClick={() => setIsOpen((open) => !open)}
						aria-expanded={isOpen}
						className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						Left out
						<ChevronDown className={cn("size-3.5 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden="true" />
					</button>
				)}
				{!isRunning && (
					<button
						type="button"
						onClick={onDismiss}
						aria-label="Dismiss"
						className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						<X className="size-4" />
					</button>
				)}
			</div>
			{isRunning && (
				<div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground transition-[width] duration-500"
						style={{ width: `${Math.max(getShare(item), 0.02) * 100}%` }}
					/>
				</div>
			)}
			{isOpen && (
				<ul className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
					{dropped.map(([reason, count]) => (
						<li key={reason} className="flex justify-between gap-4">
							<span>{DROP_REASONS[reason] ?? reason}</span>
							<span className="text-foreground tabular-nums">{formatNumber(count)}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function IconStatus({ status }) {
	if (status === "processing") return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
	if (status === "failed") return <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden="true" />;
	return (
		<span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
			<Check className="size-3" strokeWidth={3} />
		</span>
	);
}

// "Receiving the file: 8,000 of 20,000 rows", "12,000 of 20,000 rows · 11,800 added", "18,000 added · 300 already
// there · 200 left out".
function describeProgress(item, droppedTotal) {
	const counts = [
		`${formatNumber(item.created)} added`,
		item.existing > 0 && `${formatNumber(item.existing)} already there`,
		droppedTotal > 0 && `${formatNumber(droppedTotal)} left out`,
	].filter(Boolean);
	if (item.status === "failed") return [item.error, ...(item.processed > 0 ? counts : [])].filter(Boolean).join(" · ");
	if (item.status !== "processing") return counts.join(" · ");
	const total = item.total ?? item.received;
	const progress =
		item.total && item.received < item.total
			? `Receiving the file: ${formatNumber(item.received)} of ${formatNumber(item.total)} rows`
			: `${formatNumber(item.processed)} of ${formatNumber(total)} rows`;
	return [progress, item.processed > 0 && counts[0]].filter(Boolean).join(" · ");
}

function getShare(item) {
	const total = item.total ?? item.received;
	return total ? Math.min(1, item.processed / total) : 0;
}

export function notifyFinished(item) {
	const name = item.fileName || "contacts";
	if (item.status === "failed") return void toast.error(`Import of ${name} stopped`, { description: item.error });
	const droppedTotal = Object.values(item.dropped).reduce((sum, count) => sum + count, 0);
	toast.success(`Imported ${formatNumber(item.created)} new ${item.created === 1 ? "contact" : "contacts"}`, {
		description: [
			item.existing > 0 && `${formatNumber(item.existing)} already there`,
			droppedTotal > 0 && `${formatNumber(droppedTotal)} left out`,
		]
			.filter(Boolean)
			.join(" · ") || undefined,
	});
}

function isRecent(item) {
	return Boolean(item.finishedAt) && Date.now() - new Date(item.finishedAt).getTime() < RECENT_MS;
}

// Dismissed imports stay dismissed in this browser, in every tab.
function subscribeDismissed(onChange) {
	window.addEventListener("storage", onChange);
	window.addEventListener(DISMISSED_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onChange);
		window.removeEventListener(DISMISSED_EVENT, onChange);
	};
}

function readDismissedValue() {
	try {
		return localStorage.getItem(DISMISSED_KEY) ?? "[]";
	} catch {
		return "[]";
	}
}

function parseDismissed(value) {
	try {
		const ids = JSON.parse(value);
		return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}
