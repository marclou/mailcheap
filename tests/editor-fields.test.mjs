import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MergeTagSuggestion, SlashCommand } from "../components/MenuSlash.jsx";
import { MergeTags, setEditorFields } from "../lib/editor-merge-tags.js";
import { Problems, problemsKey } from "../lib/editor-problems.js";

// A field added or deleted while an issue is open, from the slash menu's Add a field (components/EditorRich.jsx): the
// editor follows at once (lib/editor-merge-tags.js), its pills, its problems and both its menus, with nothing to undo.
const COMPANY = { key: "company", label: "Company", type: "text" };

function openEditor(contactFields) {
	const editor = new Editor({
		element: null,
		extensions: [
			StarterKit,
			MergeTags.configure({ contactFields }),
			Problems.configure({ contactFields }),
			SlashCommand.configure({ contactFields }),
			MergeTagSuggestion.configure({ contactFields }),
		],
		content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{company|friend}}" }] }] },
	});
	// Mounting it in a page adds its plugins.
	editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
	return editor;
}

function pills(editor) {
	const plugin = editor.state.plugins.find((candidate) => candidate.key.startsWith("mergeTags$"));
	return plugin
		.getState(editor.state)
		.find()
		.map(({ type }) => type.attrs["data-key"]);
}

function problems(editor) {
	return problemsKey.getState(editor.state).blocks.flatMap((block) => block.problems.map(({ message }) => message));
}

test("a field added while the issue is open: its tags turn to pills, their problem goes, and both menus offer it", () => {
	const editor = openEditor([]);
	assert.deepEqual(pills(editor), []);
	assert.match(problems(editor).join("\n"), /\{\{company\|friend\}\} goes out as written/);

	setEditorFields(editor, [COMPANY]);
	assert.deepEqual(pills(editor), ["company"]);
	assert.deepEqual(problems(editor), []);
	assert.deepEqual(editor.storage.slashCommand.contactFields, [COMPANY]);
	assert.deepEqual(editor.storage.mergeTagSuggestion.contactFields, [COMPANY]);
	assert.equal(editor.can().undo(), false, "nothing to undo");

	setEditorFields(editor, []);
	assert.deepEqual(pills(editor), [], "a field deleted, the other way round");
	assert.equal(problems(editor).length, 1);
	editor.destroy();
});
