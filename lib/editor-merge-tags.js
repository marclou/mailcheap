import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findMergeTags } from "@/lib/merge-tags";

// A transaction's meta once the account's fields have changed (setEditorFields).
export const FIELDS_CHANGED = "contactFieldsChanged";
// The editor's extensions that read the account's fields, by name.
const FIELD_EXTENSIONS = ["mergeTags", "problems", "slashCommand", "mergeTagSuggestion"];

// {{first_name}} and the tags of the account's fields (contactFields) read as placeholders in the editor: a pill drawn
// over the text, which stays plain text to edit, so its fallback is changed by typing. A tag split by formatting isn't
// one, in the editor or in the email. Each pill carries its key and its fallback for its tooltip
// (components/TooltipMergeTag.jsx).
export const MergeTags = Extension.create({
	name: "mergeTags",

	addOptions() {
		return { contactFields: [] };
	},

	addStorage() {
		return { contactFields: this.options.contactFields };
	},

	addProseMirrorPlugins() {
		const { storage } = this;
		return [
			new Plugin({
				key: new PluginKey("mergeTags"),
				state: {
					init: (_, { doc }) => decorateMergeTags(doc, storage.contactFields),
					apply: (tr, decorations) =>
						tr.docChanged || tr.getMeta(FIELDS_CHANGED) ? decorateMergeTags(tr.doc, storage.contactFields) : decorations,
				},
				props: {
					decorations(state) {
						return this.getState(state);
					},
				},
			}),
		];
	},
});

// The account's fields as they are now, one added or deleted since the editor opened among them: its tags, their
// problems and the slash and {{ menus follow, without a step in the undo history.
export function setEditorFields(editor, contactFields) {
	for (const name of FIELD_EXTENSIONS) {
		if (editor.storage[name]) editor.storage[name].contactFields = contactFields;
	}
	editor.view.dispatch(editor.state.tr.setMeta(FIELDS_CHANGED, true).setMeta("addToHistory", false));
}

// A tag being typed, for the fields its menu suggests (components/MenuSlash.jsx): "{{" and the start of a key right
// before the caret, in its paragraph. The rest of a tag already there after the caret, like the "name}}" of
// "{{first_|name}}", goes in its range, which a pick replaces. A | or }} typed after the key ends it.
export function findMergeTagMatch({ $position }) {
	const { parent, parentOffset, pos } = $position;
	if (!parent.isTextblock) return null;
	const before = parent.textBetween(0, parentOffset, undefined, "\ufffc");
	const typed = /\{\{\s*([a-z0-9_]{0,40})$/i.exec(before);
	if (!typed) return null;
	const after = parent.textBetween(parentOffset, parent.content.size, undefined, "\ufffc");
	const rest = /^[a-z0-9_]*\s*(?:\|[^{}]{0,100}?)?\s*\}\}/i.exec(after)?.[0] ?? "";
	return { range: { from: pos - typed[0].length, to: pos + rest.length }, query: typed[1], text: typed[0] + rest };
}

// The fields a tag being typed could be, by key or name, ignoring case, spaces and underscores: those that start with
// what's typed first, the others in their order.
export function matchFields(items, query) {
	const search = normalize(query);
	const matches = items.filter(({ key, title }) => normalize(key).includes(search) || normalize(title).includes(search));
	return matches.sort((a, b) => startsWith(b, search) - startsWith(a, search));
}

function startsWith({ key, title }, search) {
	return Number(normalize(key).startsWith(search) || normalize(title).startsWith(search));
}

function normalize(text) {
	return String(text ?? "")
		.toLowerCase()
		.replace(/[\s_]+/g, "");
}

function decorateMergeTags(doc, contactFields) {
	const decorations = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return;
		for (const { index, length, key, fallback } of findMergeTags(node.text, contactFields)) {
			const attrs = { class: "merge-tag", "data-key": key, "data-fallback": fallback };
			decorations.push(Decoration.inline(pos + index, pos + index + length, attrs));
		}
	});
	return DecorationSet.create(doc, decorations);
}
