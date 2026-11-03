import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findDropIndex, getBlockStart, moveBlock, moveBlockTo } from "@/lib/editor-move-block";

const HANDLE = { width: 20, height: 24, gap: 6 };
// Lucide's grip-vertical.
const GRIP_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
// How far a press on the grip moves before it's a drag: less is a click, which selects the block.
const DRAG_THRESHOLD = 4;
// The copy of the block under the pointer shows its top part only, fading out, past this height.
const MAX_GHOST_HEIGHT = 240;
const GHOST_PADDING = { x: 12, y: 8 };
// Near the top or the bottom of what scrolls, a drag scrolls it, faster the closer it gets to the edge. The top's zone is
// deeper: the page's sticky header covers part of it.
const SCROLL_ZONES = { top: 0.16, bottom: 0.1, min: 64, max: 160 };
const MAX_SCROLL_SPEED = 22;
// The blocks that make room, the box and the dropped block glide to their place, on the sidebar's curve (--ease-drawer).
const GLIDE_MS = 200;
const dragKey = new PluginKey("blockDrag");

// A grip in the left gutter of the block under the pointer: drag it to move the block, click it to select the block.
// While it's dragged, the block leaves its place and a box its size shows where it would land, which the blocks around
// glide away to make room for. It lands between the issue's top-level blocks only, never inside a section, which moves
// as one block.
// Near the top or the bottom of the screen the page scrolls, and the wheel and the trackpad scroll too. The drop is one
// step, which undoes like any edit, and Escape puts the block back. The keyboard moves the block holding the cursor
// instead (Mod-Shift-ArrowUp and ArrowDown). The editor's element needs a positioned parent and a left padding wide
// enough for the grip (components/EditorRich.jsx).
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
		return [
			new Plugin({
				key: dragKey,
				state: {
					init: () => null,
					// A drag: { index, target, height, marginTop, marginBottom }, the dragged block's index, the one it would land
					// before, and its size. Any other change to the issue ends it.
					apply(tr, drag) {
						const meta = tr.getMeta(dragKey);
						if (meta !== undefined) return meta;
						return tr.docChanged ? null : drag;
					},
				},
				props: { decorations: getDragDecorations },
				view: createBlockHandle,
			}),
		];
	},
});

// The dragged block out of the way, and a box its size where it would land.
function getDragDecorations(state) {
	const drag = dragKey.getState(state);
	if (!drag) return null;
	const { doc } = state;
	const from = getBlockStart(doc, drag.index);
	return DecorationSet.create(doc, [
		Decoration.node(from, from + doc.child(drag.index).nodeSize, { style: "display: none" }),
		Decoration.widget(getBlockStart(doc, drag.target), () => createSlot(drag), { side: -1, key: "block-drop-slot", ignoreSelection: true }),
	]);
}

// The grip lives beside the editor's element, in its parent, which it joins on first use: the editor's element only
// moves into the page after the plugin starts. The parent also holds the pictures' toolbar (components/MenuImage.jsx),
// so the grip only hides once the pointer leaves the parent. The block's copy follows the pointer in the parent too.
function createBlockHandle(view) {
	const handle = createHandleElement();
	let block = null;
	// The grip held down, not dragged yet: { x, y, pos }.
	let press = null;
	let drag = null;
	let isAfterDrag = false;

	function hide() {
		if (drag || press) return;
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
		if (!view.editable || drag || press) return;
		const viewRect = view.dom.getBoundingClientRect();
		const paddingLeft = Number.parseFloat(getComputedStyle(view.dom).paddingLeft) || 0;
		// The text column's edge on the pointer's line, so the gutter finds the block beside it too.
		const found = view.posAtCoords({ left: viewRect.left + paddingLeft + 1, top: event.clientY });
		const pos = found && findTopLevelPos(view.state.doc, found);
		if (pos !== null && pos !== undefined && pos !== block?.pos) show(pos);
	}

	// Held without the browser's own drag, whose drop line can't show the block's size and which no wheel scrolls on a Mac.
	// The page follows the pointer until it's released, wherever it goes.
	function onPointerDown(event) {
		isAfterDrag = false;
		if (event.button !== 0 || !block || !view.editable) return;
		event.preventDefault();
		press = { x: event.clientX, y: event.clientY, pos: block.pos };
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerCancel);
	}

	function onPointerMove(event) {
		if (drag) {
			drag.pointerY = event.clientY;
			return;
		}
		if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_THRESHOLD) startDrag(event);
	}

	function onPointerUp() {
		release();
		if (drag) endDrag({ isDrop: true });
	}

	function onPointerCancel() {
		release();
		if (drag) endDrag({ isDrop: false });
	}

	function release() {
		press = null;
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", onPointerUp);
		window.removeEventListener("pointercancel", onPointerCancel);
	}

	function onKeyDown(event) {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		endDrag({ isDrop: false });
	}

	function startDrag(event) {
		const { pos, y } = press;
		press = null;
		const element = view.nodeDOM(pos);
		const container = view.dom.parentElement;
		if (!(element instanceof HTMLElement) || !container) return;
		const rect = element.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const style = getComputedStyle(element);
		const index = view.state.doc.resolve(pos).index(0);
		drag = {
			pointerY: event.clientY,
			offsetY: y - rect.top + GHOST_PADDING.y,
			left: rect.left - containerRect.left - GHOST_PADDING.x,
			ghost: createGhost(element, rect),
			scroller: findScroller(view.dom),
			frame: 0,
		};
		container.append(drag.ghost);
		// The copy stands for the block: the grip would stay beside the block that takes its place.
		delete handle.dataset.shown;
		// The browser would scroll back by the box's height each time it moves above what's in view, against the drag.
		drag.scroller.style.overflowAnchor = "none";
		document.documentElement.style.cursor = "grabbing";
		document.body.style.userSelect = "none";
		window.addEventListener("keydown", onKeyDown, true);
		const margins = { marginTop: Number.parseFloat(style.marginTop) || 0, marginBottom: Number.parseFloat(style.marginBottom) || 0 };
		view.dispatch(view.state.tr.setMeta(dragKey, { index, target: index, height: rect.height, ...margins }));
		step();
	}

	function step() {
		if (!drag) return;
		scrollNearEdges(drag);
		followPointer();
		if (drag) drag.frame = requestAnimationFrame(step);
	}

	// The copy at the pointer, and the box where the block would land, measured as the blocks are laid out now: after the
	// page scrolled, by the drag or the wheel, the pointer is over others.
	function followPointer() {
		const container = view.dom.parentElement;
		const state = dragKey.getState(view.state);
		if (!container || !state) return endDrag({ isDrop: false });
		const top = drag.pointerY - drag.offsetY - container.getBoundingClientRect().top;
		drag.ghost.style.transform = `translate(${Math.round(drag.left)}px, ${Math.round(top)}px)`;
		const target = findDropIndex(getBlockMiddles(view), state.index, drag.pointerY);
		if (target !== state.target) glide(view, () => view.dispatch(view.state.tr.setMeta(dragKey, { ...state, target })));
	}

	// The block glides from its copy to where it lands, or back to its place.
	function endDrag({ isDrop }) {
		if (!drag) return;
		const copyTop = drag.ghost.firstChild.getBoundingClientRect().top;
		stopDragging();
		const state = dragKey.getState(view.state);
		if (state) {
			const moved = isDrop ? moveBlockTo(view.state, state.index, state.target) : null;
			glide(view, () => view.dispatch((moved ?? view.state.tr).setMeta(dragKey, null)), {
				top: copyTop,
				find: () => view.nodeDOM(moved ? view.state.selection.from : getBlockStart(view.state.doc, state.index)),
			});
			if (moved) view.focus();
		}
		hide();
	}

	function stopDragging() {
		cancelAnimationFrame(drag.frame);
		drag.ghost.remove();
		drag.scroller.style.overflowAnchor = "";
		drag = null;
		isAfterDrag = true;
		document.documentElement.style.cursor = "";
		document.body.style.userSelect = "";
		window.removeEventListener("keydown", onKeyDown, true);
	}

	// After a drag, the click its release makes doesn't select the block again.
	function onClick() {
		if (isAfterDrag) {
			isAfterDrag = false;
			return;
		}
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
	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("click", onClick);

	return {
		update(_view, previous) {
			if (drag && !dragKey.getState(view.state)) endDrag({ isDrop: false });
			if (!previous.doc.eq(view.state.doc)) hide();
		},
		destroy() {
			release();
			if (drag) stopDragging();
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
	handle.title = "Drag to move";
	handle.setAttribute("aria-hidden", "true");
	handle.className =
		"pointer-events-none absolute top-0 left-0 z-10 grid h-6 w-5 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/70 opacity-0 transition-[opacity,background-color,color] duration-150 select-none hover:bg-muted hover:text-foreground active:cursor-grabbing data-[shown]:pointer-events-auto data-[shown]:opacity-100 [@media(pointer:coarse)]:hidden";
	handle.innerHTML = GRIP_ICON;
	return handle;
}

// Where the dragged block would land: as tall as it is, with its margins, so the blocks around move as they will.
function createSlot({ height, marginTop, marginBottom }) {
	const slot = document.createElement("div");
	slot.setAttribute("aria-hidden", "true");
	slot.dataset.dropSlot = "";
	slot.className = "pointer-events-none rounded-lg border-2 border-dashed border-foreground/20 bg-muted/70";
	Object.assign(slot.style, { height: `${height}px`, marginTop: `${marginTop}px`, marginBottom: `${marginBottom}px` });
	return slot;
}

// The block as it looks in the issue, lifted: the issue's styles apply to the copy, which sits where the block was.
function createGhost(element, rect) {
	const ghost = document.createElement("div");
	ghost.setAttribute("aria-hidden", "true");
	ghost.className = "prose-issue pointer-events-none absolute top-0 left-0 z-40 overflow-hidden rounded-lg bg-card shadow-float ring-1 ring-foreground/10";
	Object.assign(ghost.style, {
		width: `${rect.width + GHOST_PADDING.x * 2}px`,
		maxHeight: `${MAX_GHOST_HEIGHT}px`,
		padding: `${GHOST_PADDING.y}px ${GHOST_PADDING.x}px`,
		...(rect.height + GHOST_PADDING.y * 2 > MAX_GHOST_HEIGHT && { maskImage: "linear-gradient(to bottom, black 70%, transparent)" }),
	});
	const copy = element.cloneNode(true);
	copy.style.margin = "0";
	ghost.append(copy);
	return ghost;
}

// Each top-level block's middle on screen where it's laid out, not where a glide shows it on its way (offsetTop leaves
// transforms out), in order. The dragged one, out of the way, doesn't count.
function getBlockMiddles(view) {
	const middles = [];
	view.state.doc.forEach((_node, offset) => {
		const element = view.nodeDOM(offset);
		const parent = element instanceof HTMLElement ? element.offsetParent : null;
		middles.push(
			parent ? parent.getBoundingClientRect().top + parent.clientTop + element.offsetTop + element.offsetHeight / 2 : Number.NEGATIVE_INFINITY
		);
	});
	return middles;
}

// The blocks and the box move from where they show on screen to where the change lays them out (FLIP), from wherever a
// glide they're in has them. Animations rather than styles: the editor takes a change to its elements' attributes for
// an edit. landing: the dropped block, which shows on screen at top, as its copy, before it lands.
function glide(view, change, landing = null) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
	const tops = new Map(getGliders(view).map((element) => [element, element.getBoundingClientRect().top]));
	const slotTop = view.dom.querySelector(":scope > [data-drop-slot]")?.getBoundingClientRect().top;
	change();
	const landed = landing?.find();
	const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-drawer").trim() || "ease-out";
	for (const element of getGliders(view)) {
		for (const animation of element.getAnimations()) animation.cancel();
		const from = element === landed ? landing.top : (tops.get(element) ?? ("dropSlot" in element.dataset ? slotTop : undefined));
		const offset = from === undefined ? 0 : from - element.getBoundingClientRect().top;
		if (Math.abs(offset) >= 1) element.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing });
	}
}

// The top-level blocks on screen and the box: the dragged block, out of the way, stays put.
function getGliders(view) {
	return [...view.dom.children].filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
}

// What scrolls the editor: the closest scrolling parent, or the page.
function findScroller(element) {
	for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
	}
	return document.scrollingElement ?? document.documentElement;
}

function scrollNearEdges({ scroller, pointerY }) {
	const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
	const bounds = isPage ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
	const height = bounds.bottom - bounds.top;
	const zone = (share) => Math.min(SCROLL_ZONES.max, Math.max(SCROLL_ZONES.min, height * share));
	const above = bounds.top + zone(SCROLL_ZONES.top) - pointerY;
	const below = pointerY - (bounds.bottom - zone(SCROLL_ZONES.bottom));
	const depth = above > 0 ? -Math.min(1, above / zone(SCROLL_ZONES.top)) : below > 0 ? Math.min(1, below / zone(SCROLL_ZONES.bottom)) : 0;
	if (depth !== 0) scroller.scrollBy(0, Math.sign(depth) * Math.ceil(depth * depth * MAX_SCROLL_SPEED));
}

// The top-level block at a position: a paragraph, heading, image, list, quote, box, divider or section.
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
