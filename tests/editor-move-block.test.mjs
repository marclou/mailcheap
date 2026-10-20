import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { moveBlock } from "../lib/editor-move-block.js";

// The editor's blocks, reduced to what moving them needs.
const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
		image: { group: "block", atom: true, attrs: { src: { default: "" } }, toDOM: (node) => ["img", node.attrs] },
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
