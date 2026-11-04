import { useCallback, useRef } from "react";
import { mergeDrafts } from "@/lib/draft-merge";
import { replaceBlocks, splitBlocks } from "@/lib/editor-sync";
import { markdownToHtml } from "@/lib/markdown";

// A draft on a newsletter with a team, which someone else may be saving too. Each save says the revision it started
// from (update_campaign): when someone else's came first, theirs and this editor's merge block by block
// (lib/draft-merge.js), the editor shows the merge, and it saves next. pull(revision, markSaved) brings in a newer
// revision when the form has nothing to save. Without a revision, saves are the form's own.
// save and load: the dashboard's saveCampaign and loadDraft. read(): the values as the form has them this instant;
// show(values): the form's values become them, its editor's too.
export function useDraftSync({ revision, format, initialValues, editorRef, save, load, read, show }) {
	const isShared = Number.isInteger(revision);
	const syncedRef = useRef({ revision, values: initialValues });
	const isPullingRef = useRef(false);

	const getEditor = useCallback(() => (format === "rich" ? (editorRef.current?.getEditor() ?? null) : null), [editorRef, format]);

	const split = useCallback(
		(html) => {
			const editor = getEditor();
			return editor ? splitBlocks(editor, html) : [html];
		},
		[getEditor]
	);

	const fetchSaved = useCallback(async () => {
		const draft = await load();
		if (draft?.error) return draft;
		const body = draft.format === "markdown" ? markdownToHtml(draft.content) : draft.content;
		return { revision: draft.revision, values: { subject: draft.subject, previewText: draft.previewText, body } };
	}, [load]);

	// Only the editor's blocks that differ change.
	const showValues = useCallback(
		(next) => {
			const editor = getEditor();
			if (editor) replaceBlocks(editor, split(next.body));
			const shown = editor ? { ...next, body: editor.getHTML() } : next;
			show(shown);
			return shown;
		},
		[getEditor, show, split]
	);

	const saveShared = useCallback(
		async (snapshot) => {
			if (!isShared) return save(snapshot);
			const result = await save({ ...snapshot, revision: syncedRef.current.revision });
			if (!result?.conflict) {
				if (result?.ok) syncedRef.current = { revision: result.revision, values: snapshot };
				return result;
			}
			const theirs = await fetchSaved();
			if (theirs.error) return theirs;
			const merged = mergeDrafts({ base: syncedRef.current.values, mine: read(), theirs: theirs.values, split });
			syncedRef.current = theirs;
			showValues(merged);
			return { saved: theirs.values };
		},
		[isShared, save, fetchSaved, read, split, showValues]
	);

	const pull = useCallback(
		async (latest, markSaved) => {
			if (!isShared || latest <= syncedRef.current.revision || isPullingRef.current) return;
			isPullingRef.current = true;
			try {
				const before = read();
				const theirs = await fetchSaved();
				if (theirs.error || theirs.revision <= syncedRef.current.revision) return;
				// Typed meanwhile: the next save merges theirs in.
				const now = read();
				if (Object.keys(before).some((key) => before[key] !== now[key])) return;
				syncedRef.current = theirs;
				markSaved(showValues(theirs.values));
			} finally {
				isPullingRef.current = false;
			}
		},
		[isShared, read, fetchSaved, showValues]
	);

	return { save: saveShared, pull };
}
