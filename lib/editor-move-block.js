import { NodeSelection, TextSelection } from "@tiptap/pm/state";

// The top-level block holding the selection swaps with the one above (-1) or below (1), and the selection moves with it.
// Nothing happens at either end of the document, or for a selection that spans several blocks.
export function moveBlock(state, direction) {
	const { doc, selection } = state;
	const index = selection.$from.index(0);
	const target = index + direction;
	if (target < 0 || target >= doc.childCount) return null;
	const start = getBlockStart(doc, index);
	const block = doc.child(index);
	const end = start + block.nodeSize;
	if (selection.to > end) return null;

	const neighbor = doc.child(target);
	const insertAt = direction < 0 ? start - neighbor.nodeSize : start + neighbor.nodeSize;
	const tr = state.tr.delete(start, end).insert(insertAt, block);
	const shift = insertAt - start;
	const moved =
		selection instanceof NodeSelection
			? NodeSelection.create(tr.doc, selection.from + shift)
			: TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift);
	return tr.setSelection(moved).scrollIntoView();
}

// Where a block dragged by its grip lands (lib/editor-block-handle.js): before the first other top-level block whose
// middle is below the pointer, else at the end. middles: each top-level block's middle on screen, in order, as they're
// laid out with the gap the dragged one leaves; index: the dragged one's, which doesn't count.
export function findDropIndex(middles, index, y) {
	const found = middles.findIndex((middle, at) => at !== index && y < middle);
	return found === -1 ? middles.length : found;
}

// The top-level block at index moves before the one at target, or to the end for the document's child count, in one
// step, and stays selected. Null where it already is.
export function moveBlockTo(state, index, target) {
	const { doc } = state;
	if (index < 0 || index >= doc.childCount || target < 0 || target > doc.childCount || target === index || target === index + 1) return null;
	const block = doc.child(index);
	const from = getBlockStart(doc, index);
	const insertAt = getBlockStart(doc, target) - (target > index ? block.nodeSize : 0);
	const tr = state.tr.delete(from, from + block.nodeSize).insert(insertAt, block);
	return tr.setSelection(NodeSelection.create(tr.doc, insertAt));
}

// The position before the document's child at index, or its end past the last one.
export function getBlockStart(doc, index) {
	let pos = 0;
	for (let child = 0; child < index; child += 1) pos += doc.child(child).nodeSize;
	return pos;
}
