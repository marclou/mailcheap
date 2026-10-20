import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MERGE_TAG_PATTERN } from "@/lib/merge-tags";

// {{first_name}} reads as a placeholder in the editor: a pill drawn over the text, which stays plain text to edit, so
// its fallback is changed by typing. A tag split by formatting isn't one, in the editor or in the email.
export const MergeTags = Extension.create({
	name: "mergeTags",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("mergeTags"),
				state: {
					init: (_, { doc }) => findMergeTags(doc),
					apply: (tr, decorations) => (tr.docChanged ? findMergeTags(tr.doc) : decorations),
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

function findMergeTags(doc) {
	const decorations = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return;
		for (const match of node.text.matchAll(new RegExp(MERGE_TAG_PATTERN.source, "gi"))) {
			decorations.push(Decoration.inline(pos + match.index, pos + match.index + match[0].length, { class: "merge-tag" }));
		}
	});
	return DecorationSet.create(doc, decorations);
}
