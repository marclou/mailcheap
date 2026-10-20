import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { moveBlock } from "@/lib/editor-move-block";

const HANDLE = { width: 20, height: 24, gap: 6 };
// Lucide's grip-vertical.
const GRIP_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

// A grip in the left gutter of the block under the pointer: drag it to move the block, click it to select the block.
// The drop goes through ProseMirror's own drag and drop, with its drop cursor, so it undoes like any edit. The
// keyboard moves the block holding the cursor instead (Mod-Shift-ArrowUp and ArrowDown). The editor's element needs
// a positioned parent and a left padding wide enough for the grip (components/EditorRich.jsx).
export const BlockHandle = Extension.create({
	name: "blockHandle",

	addKeyboardShortcuts() {
		const move = (direction) => {
			const tr = moveBlock(this.editor.state, direction);
			if (tr) this.editor.view.dispatch(tr);
			return true;
		};
		return { "Mod-Shift-ArrowUp": () => move(-1), "Mod-Shift-ArrowDown": () => move(1) };
	},

	addProseMirrorPlugins() {
		return [new Plugin({ key: new PluginKey("blockHandle"), view: createBlockHandle })];
	},
});

// The grip lives beside the editor's element, in its parent, which it joins on first use: the editor's element only
// moves into the page after the plugin starts. The parent also holds the pictures' toolbar (components/MenuImage.jsx),
// so the grip only hides once the pointer leaves the parent.
function createBlockHandle(view) {
	const handle = createHandleElement();
	let block = null;
	let dragging = null;

	function hide() {
		if (dragging) return;
		block = null;
		delete handle.dataset.shown;
	}

	function show(pos) {
		const node = view.state.doc.nodeAt(pos);
		const element = view.nodeDOM(pos);
		const container = view.dom.parentElement;
		if (!node || !(element instanceof HTMLElement) || !container) return hide();
		if (handle.parentElement !== container) join(container);
		block = { pos };
		const containerRect = container.getBoundingClientRect();
		const viewRect = view.dom.getBoundingClientRect();
		const paddingLeft = Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 0;
		const left = viewRect.left - containerRect.left + paddingLeft - HANDLE.width - HANDLE.gap;
		const top = getHandleTop(view, node, pos, element) - containerRect.top;
		handle.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
		handle.dataset.shown = "";
	}

	function onMouseMove(event) {
		if (!view.editable || dragging) return;
		const viewRect = view.dom.getBoundingClientRect();
		const paddingLeft = Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 0;
		// The text column's edge on the pointer's line, so the gutter finds the block beside it too.
		const found = view.posAtCoords({ left: viewRect.left + paddingLeft + 1, top: event.clientY });
		const pos = found && findTopLevelPos(view.state.doc, found);
		if (pos !== null && pos !== undefined && pos !== block?.pos) show(pos);
	}

	function onDragStart(event) {
		if (!block || !event.dataTransfer) return;
		const selection = NodeSelection.create(view.state.doc, block.pos);
		view.dispatch(view.state.tr.setSelection(selection));
		const slice = selection.content();
		const { dom, text } = view.serializeForClipboard(slice);
		event.dataTransfer.clearData();
		event.dataTransfer.setData("text/html", dom.innerHTML);
		event.dataTransfer.setData("text/plain", text);
		event.dataTransfer.effectAllowed = "copyMove";
		const element = view.nodeDOM(block.pos);
		if (element instanceof HTMLElement) event.dataTransfer.setDragImage(element, 0, 0);
		dragging = { slice, move: true, node: selection };
		view.dragging = dragging;
	}

	function onDragEnd() {
		const ended = dragging;
		dragging = null;
		// ProseMirror clears it on a drop in the editor; a drop anywhere else leaves it set.
		setTimeout(() => {
			if (view.dragging === ended) view.dragging = null;
		}, 50);
		hide();
	}

	function onClick() {
		if (!block) return;
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
		view.focus();
	}

	function join(container) {
		handle.parentElement?.removeEventListener("mouseleave", hide);
		container.append(handle);
		container.addEventListener("mouseleave", hide);
	}

	view.dom.addEventListener("mousemove", onMouseMove);
	view.dom.addEventListener("keydown", hide);
	handle.addEventListener("dragstart", onDragStart);
	handle.addEventListener("dragend", onDragEnd);
	handle.addEventListener("click", onClick);

	return {
		update(_view, previous) {
			if (!previous.doc.eq(view.state.doc)) hide();
		},
		destroy() {
			view.dom.removeEventListener("mousemove", onMouseMove);
			view.dom.removeEventListener("keydown", hide);
			handle.parentElement?.removeEventListener("mouseleave", hide);
			handle.remove();
		},
	};
}

// Mouse only: hidden on touch screens, where the keyboard shortcuts and the browser's own selection move blocks.
function createHandleElement() {
	const handle = document.createElement("div");
	handle.draggable = true;
	handle.title = "Drag to move";
	handle.setAttribute("aria-hidden", "true");
	handle.className =
		"pointer-events-none absolute top-0 left-0 z-10 grid h-6 w-5 cursor-grab place-items-center rounded-md text-muted-foreground/70 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground active:cursor-grabbing data-[shown]:pointer-events-auto data-[shown]:opacity-100 [@media(pointer:coarse)]:hidden";
	handle.innerHTML = GRIP_ICON;
	return handle;
}

// The top-level block at a position: a paragraph, heading, image, list, quote, box or divider.
function findTopLevelPos(doc, { pos, inside }) {
	if (inside >= 0) {
		const $inside = doc.resolve(inside);
		return $inside.depth === 0 ? inside : $inside.before(1);
	}
	const $pos = doc.resolve(pos);
	return $pos.depth >= 1 ? $pos.before(1) : null;
}

// Level with the block's first line of text, or near the top of a picture or divider.
function getHandleTop(view, node, pos, element) {
	const rect = element.getBoundingClientRect();
	if (node.isAtom) return node.isBlock && rect.height < HANDLE.height * 2 ? rect.top + (rect.height - HANDLE.height) / 2 : rect.top + 4;
	let textPos = null;
	node.descendants((child, offset) => {
		if (textPos === null && child.isTextblock) textPos = pos + 1 + offset + 1;
		return textPos === null;
	});
	const line = view.coordsAtPos(node.isTextblock ? pos + 1 : (textPos ?? pos + 1));
	return (line.top + line.bottom) / 2 - HANDLE.height / 2;
}
