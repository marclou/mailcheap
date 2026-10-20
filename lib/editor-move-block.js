import { NodeSelection, TextSelection } from "@tiptap/pm/state";

// The top-level block holding the selection swaps with the one above (-1) or below (1), and the selection moves with it.
// Nothing happens at either end of the document, or for a selection that spans several blocks.
export function moveBlock(state, direction) {
	const { doc, selection } = state;
	const index = selection.$from.index(0);
	const target = index + direction;
	if (target < 0 || target >= doc.childCount) return null;
	let start = 0;
	for (let child = 0; child < index; child += 1) start += doc.child(child).nodeSize;
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
