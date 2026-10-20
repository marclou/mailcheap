"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { AlignCenter, AlignLeft, AlignRight, CornerDownLeft, Trash2 } from "lucide-react";
import { ButtonFormat } from "@/components/MenuFormat";

// A toolbar for the picture under the pointer, or the selected one on touch screens and from the keyboard: where it
// sits in the column (lib/editor-image.js), its alt text and a way to remove it. It sits inside the picture's top edge,
// in the editor's parent next to the blocks' grip (lib/editor-block-handle.js), so the pointer gets to it without
// leaving the picture.
export default function MenuImage({ editor }) {
	const [hovered, setHovered] = useState(null);
	const [isEditingAlt, setIsEditingAlt] = useState(false);
	const [isFocusInside, setIsFocusInside] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const menuRef = useRef(null);
	const target = useEditorState({ editor, selector: ({ editor: current }) => getTarget(current, hovered, isFocusInside) });
	const image = target && !isDragging ? editor.view.nodeDOM(target.pos) : null;
	const container = editor.isEditorContentInitialized ? editor.view.dom.parentElement : null;

	useEffect(() => {
		const { dom } = editor.view;
		function onOver(event) {
			setHovered(event.target instanceof Element ? event.target.closest("[data-resize-container]") : null);
		}
		function onLeave(event) {
			if (!isInside(menuRef.current, event.relatedTarget)) setHovered(null);
		}
		const onDragStart = () => setIsDragging(true);
		const onDragEnd = () => setIsDragging(false);
		dom.addEventListener("pointerover", onOver);
		dom.addEventListener("pointerleave", onLeave);
		window.addEventListener("dragstart", onDragStart);
		window.addEventListener("dragend", onDragEnd);
		window.addEventListener("drop", onDragEnd);
		return () => {
			dom.removeEventListener("pointerover", onOver);
			dom.removeEventListener("pointerleave", onLeave);
			window.removeEventListener("dragstart", onDragStart);
			window.removeEventListener("dragend", onDragEnd);
			window.removeEventListener("drop", onDragEnd);
		};
	}, [editor]);

	useLayoutEffect(() => {
		const menu = menuRef.current;
		if (!menu || !image) return;
		const picture = image.querySelector("img") ?? image;
		const place = () => placeMenu(menu, editor.view, picture);
		place();
		const observer = new ResizeObserver(place);
		observer.observe(editor.view.dom);
		observer.observe(picture);
		editor.on("transaction", place);
		window.addEventListener("resize", place);
		return () => {
			observer.disconnect();
			editor.off("transaction", place);
			window.removeEventListener("resize", place);
		};
	}, [editor, image, isEditingAlt]);

	if (!container || !image) return null;

	function setAlign(align) {
		editor.chain().focus().setNodeSelection(target.pos).updateAttributes("image", { align }).run();
	}

	function editAlt() {
		editor.chain().setNodeSelection(target.pos).run();
		setIsEditingAlt(true);
	}

	function changeAlt(event) {
		const alt = event.currentTarget.value.trim();
		editor.chain().command(({ tr }) => Boolean(tr.setNodeAttribute(target.pos, "alt", alt))).run();
	}

	function finishAlt() {
		setIsEditingAlt(false);
		setIsFocusInside(false);
		editor.chain().focus().setNodeSelection(target.pos).run();
	}

	function remove() {
		editor.chain().focus().setNodeSelection(target.pos).deleteSelection().run();
		setHovered(null);
	}

	return createPortal(
		<div
			ref={menuRef}
			onPointerLeave={(event) => !isInside(editor.view.dom, event.relatedTarget) && setHovered(null)}
			onFocus={() => setIsFocusInside(true)}
			onBlur={(event) => !isInside(event.currentTarget, event.relatedTarget) && setIsFocusInside(false)}
			className="absolute top-0 left-0 z-20 animate-in duration-150 fade-in-0"
		>
			<div className="flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
				{isEditingAlt ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							finishAlt();
						}}
						onMouseDown={(event) => event.target instanceof HTMLInputElement || event.preventDefault()}
						className="flex items-center gap-0.5"
					>
						<span className="pl-2 text-xs font-semibold text-muted-foreground">Alt</span>
						<input
							name="alt"
							type="text"
							autoFocus
							defaultValue={target.alt}
							placeholder="Describe this picture"
							aria-label="Alt text"
							onChange={changeAlt}
							onKeyDown={(event) => event.key === "Escape" && finishAlt()}
							onBlur={() => setIsEditingAlt(false)}
							className="h-8 w-56 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
						/>
						<ButtonFormat label="Done" type="submit">
							<CornerDownLeft />
						</ButtonFormat>
					</form>
				) : (
					// Clicks keep the editor's focus, and its selection, as the format menu's do.
					<div onMouseDown={(event) => event.preventDefault()} className="flex items-center gap-0.5">
						{ALIGNMENTS.map(({ value, label, icon: Icon }) => (
							<ButtonFormat key={value} label={label} isActive={target.align === value} onClick={() => setAlign(value)}>
								<Icon />
							</ButtonFormat>
						))}
						<span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
						<ButtonFormat label={target.alt ? `Alt text: ${target.alt}` : "Add alt text"} isActive={Boolean(target.alt)} onClick={editAlt}>
							<span className="text-xs font-semibold">Alt</span>
						</ButtonFormat>
						<ButtonFormat label="Delete image" onClick={remove}>
							<Trash2 />
						</ButtonFormat>
					</div>
				)}
			</div>
		</div>,
		container
	);
}

// The picture being edited from the toolbar, else the one under the pointer, else the selected one while the editor has
// the focus.
function getTarget(editor, hovered, isFocusInside) {
	if (!editor.isEditable) return null;
	const { selection, doc } = editor.state;
	const selected = selection instanceof NodeSelection && selection.node.type.name === "image" ? selection.from : null;
	const isPinned = isFocusInside && !editor.isFocused && selected !== null;
	const pos = isPinned ? selected : (getImagePos(editor.view, hovered) ?? (editor.isFocused ? selected : null));
	const node = pos === null ? null : doc.nodeAt(pos);
	return node?.type.name === "image" ? { pos, align: node.attrs.align, alt: node.attrs.alt ?? "" } : null;
}

function getImagePos(view, element) {
	if (!element?.isConnected || !view.dom.contains(element)) return null;
	return view.posAtDOM(element, 0);
}

// Centered in the picture's top edge, and within the text column so the grip in the gutter stays free.
function placeMenu(menu, view, image) {
	const parent = menu.offsetParent?.getBoundingClientRect();
	if (!parent) return;
	const picture = image.getBoundingClientRect();
	const editor = view.dom.getBoundingClientRect();
	const style = getComputedStyle(view.dom);
	const columnLeft = editor.left + Number.parseFloat(style.paddingLeft);
	const columnRight = editor.right - Number.parseFloat(style.paddingRight);
	const width = menu.offsetWidth;
	const left = Math.max(columnLeft, Math.min(picture.left + (picture.width - width) / 2, columnRight - width));
	menu.style.transform = `translate(${Math.round(left - parent.left)}px, ${Math.round(picture.top - parent.top + INSET)}px)`;
}

function isInside(element, node) {
	return Boolean(element) && node instanceof Node && element.contains(node);
}

const INSET = 8;
const ALIGNMENTS = [
	{ value: "left", label: "Align left", icon: AlignLeft },
	{ value: "center", label: "Center", icon: AlignCenter },
	{ value: "right", label: "Align right", icon: AlignRight },
];
