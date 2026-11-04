import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { findBlockAt, getCaretBlock } from "@/lib/editor-sync";

// Nobody else on the draft, others there but still, and someone moving or typing.
const ALONE_MS = 4000;
const STILL_MS = 1500;
const ACTIVE_MS = 300;
const ACTIVE_FOR_MS = 5000;
const NO_ONE = [];

// Kept out of the form's state, so the form doesn't render again each time someone moves: what shows them reads it
// (usePresenceOthers).
function createPresenceStore() {
	let others = NO_ONE;
	const listeners = new Set();
	return {
		get: () => others,
		set: (next) => {
			others = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function usePresenceOthers(presence) {
	return useSyncExternalStore(presence.subscribe, presence.get, () => NO_ONE);
}

// Who else is on a team's draft and where (app/api/campaigns/[id]/presence), while this browser says where its person
// is: their pointer over rootRef, the write step, and the block or the field (fieldRefs) they type in. Often while
// someone moves or types, every few seconds otherwise, and not while the tab is hidden. onRevision(revision): the
// draft's, with each answer; higher than the editor's, someone else saved.
export function usePresence({ campaignId, isEnabled, rootRef, editorRef, fieldRefs, onRevision }) {
	const [presence] = useState(createPresenceStore);
	const onRevisionRef = useRef(onRevision);

	useEffect(() => {
		onRevisionRef.current = onRevision;
	}, [onRevision]);

	useEffect(() => {
		const root = rootRef.current;
		if (!isEnabled || !root) return;
		const url = `/api/campaigns/${campaignId}/presence`;
		let pointer = null;
		let timer;
		let isSending = false;
		let isQueued = false;
		let isStopped = false;
		let isClosed = false;
		let hasOthers = false;
		let lastOthers = "[]";
		let lastSentAt = 0;
		let activeUntil = 0;

		function readCursor() {
			if (!pointer) return null;
			const editor = editorRef.current?.getEditor?.();
			const block = editor && findBlockAt(editor, pointer.y);
			if (block) {
				const { left, top, width, height } = block.rect;
				return { block: block.index, fx: (pointer.x - left) / width, fy: (pointer.y - top) / height };
			}
			const { left, top, width } = root.getBoundingClientRect();
			return { fx: (pointer.x - left) / width, y: pointer.y - top };
		}

		function readCaret() {
			const field = Object.entries(fieldRefs).find(([, ref]) => ref.current && ref.current === document.activeElement);
			if (field) return field[0];
			const editor = editorRef.current?.getEditor?.();
			return editor ? getCaretBlock(editor) : null;
		}

		function schedule(delay) {
			clearTimeout(timer);
			timer = setTimeout(send, delay);
		}

		async function send() {
			clearTimeout(timer);
			if (isStopped || isClosed || document.hidden) return;
			if (isSending) {
				isQueued = true;
				return;
			}
			isSending = true;
			lastSentAt = Date.now();
			try {
				const response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cursor: readCursor(), caret: readCaret() }),
				});
				// The draft isn't a team's anymore, or no longer theirs.
				if ([401, 403, 404].includes(response.status)) isStopped = true;
				if (response.ok && !isStopped && !isClosed) {
					const { others: next, revision } = await response.json();
					const key = JSON.stringify(next);
					if (key !== lastOthers) {
						activeUntil = Date.now() + ACTIVE_FOR_MS;
						presence.set(next);
					}
					lastOthers = key;
					hasOthers = next.length > 0;
					onRevisionRef.current?.(revision);
				}
			} catch {
				// Offline for a moment: the next one tries again.
			} finally {
				isSending = false;
			}
			if (isClosed) return;
			if (isStopped) return presence.set(NO_ONE);
			if (isQueued) {
				isQueued = false;
				return schedule(ACTIVE_MS);
			}
			schedule(!hasOthers ? ALONE_MS : Date.now() < activeUntil ? ACTIVE_MS : STILL_MS);
		}

		// Soon, while someone else is there to see it.
		function change() {
			if (!hasOthers) return;
			activeUntil = Date.now() + ACTIVE_FOR_MS;
			if (isSending) isQueued = true;
			else schedule(Math.max(0, lastSentAt + ACTIVE_MS - Date.now()));
		}

		function handlePointerMove(event) {
			pointer = { x: event.clientX, y: event.clientY };
			change();
		}
		function handlePointerLeave() {
			pointer = null;
			change();
		}
		function handleVisibilityChange() {
			if (!document.hidden) send();
		}
		function leave() {
			fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
		}

		root.addEventListener("pointermove", handlePointerMove);
		root.addEventListener("pointerleave", handlePointerLeave);
		document.addEventListener("selectionchange", change);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("pagehide", leave);
		send();
		return () => {
			isClosed = true;
			clearTimeout(timer);
			root.removeEventListener("pointermove", handlePointerMove);
			root.removeEventListener("pointerleave", handlePointerLeave);
			document.removeEventListener("selectionchange", change);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("pagehide", leave);
			leave();
			presence.set(NO_ONE);
		};
	}, [presence, campaignId, isEnabled, rootRef, editorRef, fieldRefs]);

	return presence;
}
