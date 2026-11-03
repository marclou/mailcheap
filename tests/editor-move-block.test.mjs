import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { findDropIndex, moveBlock, moveBlockTo } from "../lib/editor-move-block.js";

// The editor's blocks, reduced to what moving them needs.
const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
		image: { group: "block", atom: true, attrs: { src: { default: "" } }, toDOM: (node) => ["img", node.attrs] },
		section: { group: "block", content: "(paragraph | image)+", toDOM: () => ["section", 0] },
		text: {},
	},
});

function paragraph(text) {
	return schema.node("paragraph", null, [schema.text(text)]);
}

function stateWith(selection) {
	const doc = schema.node("doc", null, [paragraph("one"), paragraph("two"), schema.node("image", { src: "a.png" }), paragraph("three")]);
	return EditorState.create({ doc, selection: selection(doc) });
}

function blocks(state) {
	const names = [];
	state.doc.forEach((node) => names.push(node.type.name === "image" ? "image" : node.textContent));
	return names;
}

test("the block holding the cursor swaps with its neighbor, and the cursor goes with it", () => {
	// "two", at "tw|o": positions 6 to 10.
	const state = stateWith((doc) => TextSelection.create(doc, 8));
	const up = state.apply(moveBlock(state, -1));
	assert.deepEqual(blocks(up), ["two", "one", "image", "three"]);
	assert.equal(up.doc.textBetween(up.selection.from - 2, up.selection.from), "tw");

	const down = state.apply(moveBlock(state, 1));
	assert.deepEqual(blocks(down), ["one", "image", "two", "three"]);
	assert.equal(down.doc.textBetween(down.selection.from - 2, down.selection.from), "tw");
});

test("a selected picture moves as a whole and stays selected", () => {
	const state = stateWith((doc) => NodeSelection.create(doc, 10));
	const moved = state.apply(moveBlock(state, -1));
	assert.deepEqual(blocks(moved), ["one", "image", "two", "three"]);
	assert.ok(moved.selection instanceof NodeSelection);
	assert.equal(moved.selection.node.type.name, "image");
});

test("nothing moves past either end of the document, or when the selection spans several blocks", () => {
	assert.equal(moveBlock(stateWith((doc) => TextSelection.create(doc, 1)), -1), null);
	assert.equal(moveBlock(stateWith((doc) => TextSelection.create(doc, doc.content.size - 1)), 1), null);
	assert.equal(moveBlock(stateWith((doc) => TextSelection.create(doc, 2, 8)), 1), null);
});

test("a block dragged by its grip lands before the first other block whose middle is under the pointer", () => {
	// Four blocks' middles on screen, the second one dragged.
	const middles = [10, 40, 70, 100];
	assert.equal(findDropIndex(middles, 1, 5), 0);
	assert.equal(findDropIndex(middles, 1, 20), 2, "the dragged block doesn't count");
	assert.equal(findDropIndex(middles, 1, 69), 2);
	assert.equal(findDropIndex(middles, 1, 71), 3);
	assert.equal(findDropIndex(middles, 1, 500), 4, "past the last one, at the end");
	assert.equal(findDropIndex([Number.NEGATIVE_INFINITY, 40], 1, 0), 2, "a block with nothing on screen is never below the pointer");
});

test("a dragged block moves to its gap in one step and stays selected, and nothing moves where it was", () => {
	const state = stateWith((doc) => TextSelection.create(doc, 1));
	const down = state.apply(moveBlockTo(state, 0, 3));
	assert.deepEqual(blocks(down), ["two", "image", "one", "three"]);
	assert.ok(down.selection instanceof NodeSelection);
	assert.equal(down.selection.node.textContent, "one");
	assert.deepEqual(blocks(state.apply(moveBlockTo(state, 0, 4))), ["two", "image", "three", "one"], "to the end");
	assert.deepEqual(blocks(state.apply(moveBlockTo(state, 3, 0))), ["three", "one", "two", "image"], "to the top");
	assert.deepEqual(blocks(state.apply(moveBlockTo(state, 2, 0))), ["image", "one", "two", "three"], "a picture too");
	for (const target of [1, 2]) assert.equal(moveBlockTo(state, 1, target), null, "its own place, on either side");
	assert.equal(moveBlockTo(state, 1, 9), null);
	assert.equal(moveBlockTo(state, 9, 0), null);
});

test("a section moves as one block, and a block dragged next to one lands beside it, never inside", () => {
	const section = schema.node("section", null, [paragraph("in one"), paragraph("in two")]);
	const doc = schema.node("doc", null, [paragraph("one"), section, paragraph("two")]);
	const state = EditorState.create({ doc });
	const names = (next) => {
		const list = [];
		next.doc.forEach((node) => list.push(node.type.name === "section" ? `[${node.textContent}]` : node.textContent));
		return list;
	};

	assert.deepEqual(names(state.apply(moveBlockTo(state, 0, 2))), ["[in onein two]", "one", "two"]);
	assert.deepEqual(names(state.apply(moveBlockTo(state, 2, 1))), ["one", "two", "[in onein two]"]);
	const moved = state.apply(moveBlockTo(state, 1, 0));
	assert.deepEqual(names(moved), ["[in onein two]", "one", "two"]);
	assert.equal(moved.selection.node.type.name, "section", "with its blocks, still selected");
});
