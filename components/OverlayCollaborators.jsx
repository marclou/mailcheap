"use client";

import { useEffect, useState } from "react";
import AvatarCollaborator from "@/components/AvatarCollaborator";
import { getBlockRect } from "@/lib/editor-sync";
import { getPresenceColor } from "@/lib/presence-rules";
import { usePresenceOthers } from "@/lib/use-presence";

// The page's room beside the card for the pictures of who types where, as on a computer: without it, as on a phone, they
// go inside the card's padding.
const MARGIN_NEEDED = 40;
const AVATAR_SIZE = 20;

// Where the others on a team's draft are (presence: lib/use-presence.js), over rootRef, the write step: each one's
// pointer, with their picture and first name, and beside the block or the field they type in, a line in their color and
// their picture. fieldRefs: the subject's and the preview text's inputs. Measured again as the draft and the page change.
export default function OverlayCollaborators({ presence, rootRef, editorRef, fieldRefs }) {
	const others = usePresenceOthers(presence);
	const [layout, setLayout] = useState({ people: [], hasMargin: true });

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const editor = editorRef.current?.getEditor() ?? null;
		let frame = null;
		function measure() {
			frame = null;
			setLayout(readLayout({ others, root, editor, fieldRefs }));
		}
		function schedule() {
			frame ??= requestAnimationFrame(measure);
		}
		measure();
		editor?.on("transaction", schedule);
		window.addEventListener("resize", schedule);
		const observer = new ResizeObserver(schedule);
		observer.observe(root);
		return () => {
			cancelAnimationFrame(frame);
			editor?.off("transaction", schedule);
			window.removeEventListener("resize", schedule);
			observer.disconnect();
		};
	}, [others, rootRef, editorRef, fieldRefs]);

	if (others.length === 0) return null;
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
			{layout.people.map(({ person, color, cursor, caret }) => (
				<div key={person.id}>
					{caret && (
						<div
							className="absolute right-0 transition-[top,height] duration-300 ease-out motion-reduce:transition-none"
							style={{ top: caret.top, height: caret.height }}
						>
							<span className="absolute inset-y-1.5 right-0 w-0.5 rounded-full" style={{ backgroundColor: color }} />
							<span
								className="absolute top-1.5"
								style={layout.hasMargin ? { left: 10 + caret.offset } : { right: 8 + caret.offset }}
							>
								<AvatarCollaborator person={person} size={AVATAR_SIZE} className="ring-2 ring-background" />
							</span>
						</div>
					)}
					{cursor && (
						<div
							className="absolute top-0 left-0 transition-transform duration-300 ease-linear motion-reduce:transition-none"
							style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
						>
							<IconCursor color={color} />
							<span
								className="absolute top-5 left-3.5 flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm"
								style={{ backgroundColor: color }}
							>
								<AvatarCollaborator person={person} size={18} isOnColor />
								{person.name.split(/\s+/)[0]}
							</span>
						</div>
					)}
				</div>
			))}
		</div>
	);
}

function IconCursor({ color }) {
	return (
		<svg width="22" height="24" viewBox="0 0 22 24" fill="none" className="-translate-x-1 -translate-y-1 drop-shadow-sm">
			<path d="M4 3.5v16.2l4.7-4.4h8.1Z" fill={color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
		</svg>
	);
}

function readLayout({ others, root, editor, fieldRefs }) {
	const box = root.getBoundingClientRect();
	// Two typing in the same place: their pictures side by side.
	const placed = {};
	const people = others.map((person) => {
		const caret = readCaret(person.caret, box, editor, fieldRefs);
		const count = caret ? (placed[person.caret] = (placed[person.caret] ?? -1) + 1) : 0;
		return {
			person,
			color: getPresenceColor(person.id),
			cursor: readCursor(person.cursor, box, editor),
			caret: caret && { ...caret, offset: count * (AVATAR_SIZE + 4) },
		};
	});
	return { people, hasMargin: window.innerWidth - box.right >= MARGIN_NEEDED };
}

// A pointer over a block is placed in the same block here, whose lines can wrap differently.
function readCursor(cursor, box, editor) {
	if (!cursor) return null;
	if (cursor.block === undefined) return { x: cursor.fx * box.width, y: cursor.y };
	const rect = editor && getBlockRect(editor, cursor.block);
	return rect && { x: rect.left - box.left + cursor.fx * rect.width, y: rect.top - box.top + cursor.fy * rect.height };
}

function readCaret(caret, box, editor, fieldRefs) {
	if (caret === null || caret === undefined) return null;
	const rect = typeof caret === "string" ? fieldRefs[caret]?.current?.getBoundingClientRect() : editor && getBlockRect(editor, caret);
	return rect && { top: rect.top - box.top, height: rect.height };
}
