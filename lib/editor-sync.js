import { getHTMLFromFragment } from "@tiptap/core";
import { DOMParser, Fragment } from "@tiptap/pm/model";

// A team's draft in the editor (lib/use-draft-sync.js, lib/use-presence.js): its content as top-level blocks, written
// the way this editor writes them, so the same block from another editor or the API compares equal.

function parse(editor, html) {
	const template = document.createElement("template");
	template.innerHTML = html;
	return DOMParser.fromSchema(editor.schema).parse(template.content);
}

function toBlocks(editor, doc) {
	const blocks = [];
	doc.forEach((node) => blocks.push(getHTMLFromFragment(Fragment.from(node), editor.schema)));
	return blocks;
}

export function splitBlocks(editor, html) {
	return toBlocks(editor, parse(editor, html));
}

// The content becomes blocks in one change that only touches those that differ and stays out of undo, so the caret and
// the person's own undo stay where they were.
export function replaceBlocks(editor, blocks) {
	const { doc, tr } = editor.state;
	const current = toBlocks(editor, doc);
	const next = blocks.length > 0 ? blocks : ["<p></p>"];
	let start = 0;
	while (start < current.length && start < next.length && current[start] === next[start]) start++;
	let end = 0;
	while (end < current.length - start && end < next.length - start && current[current.length - 1 - end] === next[next.length - 1 - end]) end++;
	if (start === current.length && start === next.length) return;
	const from = getBlockStart(doc, start);
	const to = getBlockStart(doc, current.length - end);
	const middle = next.slice(start, next.length - end);
	if (middle.length === 0) tr.delete(from, to);
	else tr.replaceWith(from, to, parse(editor, middle.join("")).content);
	editor.view.dispatch(tr.setMeta("addToHistory", false));
}

function getBlockStart(doc, index) {
	let pos = 0;
	for (let child = 0; child < index; child++) pos += doc.child(child).nodeSize;
	return pos;
}

// The block at a height on the screen, with its box.
export function findBlockAt(editor, clientY) {
	const { doc } = editor.state;
	let pos = 0;
	for (let index = 0; index < doc.childCount; index++) {
		const element = editor.view.nodeDOM(pos);
		const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null;
		if (rect && clientY >= rect.top && clientY <= rect.bottom) return { index, rect };
		pos += doc.child(index).nodeSize;
	}
	return null;
}

export function getBlockRect(editor, index) {
	const { doc } = editor.state;
	if (index >= doc.childCount) return null;
	const element = editor.view.nodeDOM(getBlockStart(doc, index));
	return element instanceof HTMLElement ? element.getBoundingClientRect() : null;
}

// The block the person is typing in, when they are.
export function getCaretBlock(editor) {
	return editor.isFocused ? editor.state.selection.$from.index(0) : null;
}
