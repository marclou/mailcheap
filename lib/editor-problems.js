import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isButtonLink } from "@/lib/buttons";
import { WARNING_LABELS, findTextWarnings, getHtmlBlockWarnings, getLinkWarning, getMergeTagWarnings } from "@/lib/content-warnings";
import { findButton } from "@/lib/editor-button";
import { FIELDS_CHANGED } from "@/lib/editor-merge-tags";
import { SECTION_SEGMENT_DELETED, SECTION_UNREADABLE, readSectionRule } from "@/lib/sections";

export const problemsKey = new PluginKey("problems");
const READ_AGAIN = "problemsReadAgain";
// Long enough that each key typed doesn't read the whole issue again.
const READ_DELAY_MS = 250;
// How long a block brought into view stays lit (app/globals.css).
const FLASH_MS = 1800;
// The page's own bar stays over the top of the window.
const TOP_BAR = 80;

// What may look broken in the issue, block by block, for the dots beside them (components/GutterProblems.jsx): the review
// step's warnings (lib/content-warnings.js) and its buttons' and sections' checks, which hold the send. The plugin keeps
// each block's problems with it as the issue changes, and reads the issue again once typing pauses. contactFields: the
// account's fields, whose tags are filled in, as setEditorFields keeps them (lib/editor-merge-tags.js). The newsletter's
// segments, which sections name, come from the page as it has them (setProblemSegments).
export const Problems = Extension.create({
	name: "problems",

	addOptions() {
		return { contactFields: [] };
	},

	addStorage() {
		return { segmentIds: [], contactFields: this.options.contactFields };
	},

	addProseMirrorPlugins() {
		const { storage } = this;
		const read = (doc) => findDocProblems(doc, storage.contactFields, storage.segmentIds);
		return [
			new Plugin({
				key: problemsKey,
				state: {
					init: (_config, state) => ({ blocks: read(state.doc), flash: null }),
					apply: (tr, value) => {
						const mapped = tr.docChanged ? mapProblems(value, tr.mapping) : value;
						if (tr.getMeta(READ_AGAIN) || tr.getMeta(FIELDS_CHANGED)) return { ...mapped, blocks: read(tr.doc) };
						const meta = tr.getMeta(problemsKey);
						return meta ? { ...mapped, ...meta } : mapped;
					},
				},
				props: {
					decorations: (state) => {
						const { flash } = problemsKey.getState(state);
						const node = flash && state.doc.nodeAt(flash.pos);
						if (!node) return null;
						return DecorationSet.create(state.doc, [Decoration.node(flash.pos, flash.pos + node.nodeSize, { "data-flash": flash.severity })]);
					},
				},
				view: () => {
					let timer = null;
					return {
						update(view, previous) {
							if (previous.doc === view.state.doc) return;
							clearTimeout(timer);
							timer = setTimeout(() => {
								if (!view.isDestroyed) setProblems(view, { blocks: read(view.state.doc) });
							}, READ_DELAY_MS);
						},
						destroy: () => clearTimeout(timer),
					};
				},
			}),
		];
	},
});

// The newsletter's segments now, a segment made or deleted since changing which sections are marked: the issue is read
// again against them.
export function setProblemSegments(editor, segmentIds) {
	editor.storage.problems.segmentIds = segmentIds;
	editor.view.dispatch(editor.state.tr.setMeta(READ_AGAIN, true).setMeta("addToHistory", false));
}

// Each block with something that may look broken, in the issue's order: { pos, problems }, a problem being { id, label,
// message, severity, from, to }. A block is a paragraph or a heading, in a list, a quote or a box too, a button, an
// HTML block or a section, whose own blocks are read too. severity: "error" when it holds the send, "warning" when it's
// to check. from and to: the words it's about, when they're the block's text. segmentIds: the newsletter's segments.
export function findDocProblems(doc, contactFields = [], segmentIds = []) {
	const blocks = [];
	doc.descendants((node, pos) => {
		let problems;
		if (node.type.name === "section") {
			const problem = readSection(node, segmentIds);
			if (problem) blocks.push({ pos, problems: [problem] });
			return true;
		}
		if (node.type.name === "htmlBlock") problems = getHtmlBlockWarnings(node.attrs.html).map((warning) => toProblem(warning));
		else if (node.type.name === "button") problems = readButton(node, pos, contactFields);
		else if (node.isTextblock) problems = readTextblock(node, pos, contactFields);
		else return true;
		if (problems.length > 0) blocks.push({ pos, problems });
		return false;
	});
	return blocks;
}

// A button without its text or its link holds the send (lib/buttons.js); one with both has its link read like any. Its
// merge tags are read as a paragraph's are.
function readButton(node, pos, contactFields) {
	const text = node.textContent.trim();
	const { href } = node.attrs;
	const words = { from: pos + 1, to: pos + 1 + node.content.size };
	const tags = readMergeTags(node.textContent, pos + 1, contactFields);
	if (!text || !isButtonLink(href)) {
		const message = !text && !isButtonLink(href) ? "This button needs its text and a link" : text ? "This button needs a link" : "This button needs its text";
		return [{ id: "buttons", label: "Buttons", message, severity: "error", ...words }, ...tags];
	}
	const warning = getLinkWarning({ href, text, isButton: true });
	return [...tags, ...(warning ? [toProblem(warning, words)] : [])];
}

// A section whose readers it can't name holds the send (lib/sections.js): rules it can't read, or a deleted segment.
function readSection(node, segmentIds) {
	const rule = readSectionRule(node.attrs);
	const isDeleted = rule?.group?.kind === "segment" && !segmentIds.includes(rule.group.value);
	if (rule && !isDeleted) return null;
	return { id: "sections", label: "Sections", message: rule ? SECTION_SEGMENT_DELETED : SECTION_UNREADABLE, severity: "error" };
}

// A block's merge tags that go out as written or leave a gap, each with its words: its text starts at start.
function readMergeTags(text, start, contactFields) {
	return getMergeTagWarnings([text], contactFields).map((warning) => {
		const index = text.indexOf(warning.words);
		return toProblem(warning, { from: start + index, to: start + index + warning.words.length });
	});
}

// A paragraph's or a heading's merge tags, links, placeholder text and formatting shown as text.
function readTextblock(node, pos, contactFields) {
	const start = pos + 1;
	// A character per position, so an index in the text is one in the block, a line break starting a line.
	let text = "";
	// The same without code, which is meant as written.
	let prose = "";
	const links = [];
	node.forEach((child, offset) => {
		const value = child.isText ? child.text : child.type.name === "hardBreak" ? "\n" : "\ufffc".repeat(child.nodeSize);
		text += value;
		prose += child.marks.some((mark) => mark.type.name === "code") ? " ".repeat(value.length) : value;
		const link = child.marks.find((mark) => mark.type.name === "link");
		const last = links.at(-1);
		if (link && last?.mark.eq(link) && last.to === start + offset) {
			last.to += child.nodeSize;
			last.text += value;
		} else if (link) {
			links.push({ mark: link, from: start + offset, to: start + offset + child.nodeSize, text: value });
		}
	});
	const at = (index, words) => ({ from: start + index, to: start + index + words.length });
	return [
		...readMergeTags(text, start, contactFields),
		...links.flatMap(({ mark, from, to, text: words }) => {
			const warning = getLinkWarning({ href: mark.attrs.href ?? null, text: words.replace(/\s+/g, " ").trim() });
			return warning ? [toProblem(warning, { from, to })] : [];
		}),
		...findTextWarnings(prose).map((warning) => toProblem(warning, at(warning.index, warning.words))),
	];
}

function toProblem({ id, message }, words = {}) {
	return { id, label: WARNING_LABELS[id], message, severity: "warning", ...words };
}

// Each block's problems follow it as the issue changes, until it's read again: a deleted block's go with it.
export function mapProblems({ blocks, flash }, mapping) {
	const mapWords = (problem) => (problem.from === undefined ? problem : { ...problem, from: mapping.map(problem.from, 1), to: mapping.map(problem.to, -1) });
	return {
		blocks: blocks.flatMap((block) => {
			const { pos, deleted } = mapping.mapResult(block.pos, 1);
			return deleted ? [] : [{ pos, problems: block.problems.map(mapWords) }];
		}),
		flash: flash && !mapping.mapResult(flash.pos, 1).deleted ? { ...flash, pos: mapping.map(flash.pos, 1) } : null,
	};
}

// The problem a fix in the review step is about (lib/campaign-steps.js): the one with its very message, else the first of
// its kind: { pos, problem }, or null.
export function findProblem(blocks, { id, message }) {
	const find = (matches) => {
		for (const { pos, problems } of blocks) {
			const problem = problems.find(matches);
			if (problem) return { pos, problem };
		}
		return null;
	};
	return (message && find((problem) => problem.message === message)) || (id && find((problem) => problem.id === id)) || null;
}

// The button being written, the caret in it: its dot waits until the writing moves on, its toolbar saying what's
// missing meanwhile.
export function isBeingWritten(state, pos) {
	return findButton(state)?.pos === pos;
}

// Brings a problem into view, lit for a moment so the eye finds it: the words it's about selected, with the caret at the
// end of a button's text, or a block without words, like an HTML block, selected whole for its own view to open. Only
// words get the focus: typing over a selected block would replace it. Centered on the screen unless it's in view.
export function revealProblem({ view }, { pos, problem }) {
	const node = view.state.doc.nodeAt(pos);
	if (!node) return false;
	const flash = { pos, severity: problem.severity, id: Symbol("flash") };
	const hasWords = problem.from !== undefined;
	// Focused before the words are selected, so the toolbars for them show with them.
	if (hasWords) view.focus();
	const { tr } = view.state;
	if (hasWords) tr.setSelection(TextSelection.create(tr.doc, problem.id === "buttons" ? problem.to : problem.from, problem.to));
	else tr.setSelection(NodeSelection.create(tr.doc, pos));
	view.dispatch(tr.setMeta(problemsKey, { flash }).setMeta("addToHistory", false));
	scrollToBlock(view.nodeDOM(pos));
	setTimeout(() => {
		if (!view.isDestroyed && problemsKey.getState(view.state).flash?.id === flash.id) setProblems(view, { flash: null });
	}, FLASH_MS);
	return true;
}

// At once: an HTML block opening for editing focuses its HTML, which would cut a smooth scroll short.
function scrollToBlock(element) {
	if (!(element instanceof HTMLElement)) return;
	const { top, bottom } = element.getBoundingClientRect();
	if (top < TOP_BAR || bottom > window.innerHeight) element.scrollIntoView({ block: "center" });
}

function setProblems(view, value) {
	view.dispatch(view.state.tr.setMeta(problemsKey, value).setMeta("addToHistory", false));
}
