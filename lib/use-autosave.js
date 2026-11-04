import { useCallback, useEffect, useRef, useState } from "react";

const SAVE_DELAY = 800;
const MAX_SAVE_DELAY = 5000;

// Saves once typing pauses, and at least every few seconds while it doesn't. flush() saves right
// away and resolves to false if the save failed; saves never overlap. savedAt: when the last save went through.
// save(snapshot) can answer { saved }, the values saved instead, when someone else's came first and the values are
// changing to a merge with theirs, which saves next (lib/use-draft-sync.js). markSaved(values): values someone else
// saved, now the form's own, which need no save.
export function useAutosave(values, save) {
	const [savedValues, setSavedValues] = useState(values);
	const [isSaving, setIsSaving] = useState(false);
	const [savedAt, setSavedAt] = useState(null);
	const [error, setError] = useState(null);
	const latestRef = useRef(values);
	const savedRef = useRef(values);
	const queueRef = useRef(Promise.resolve(true));
	const dirtySinceRef = useRef(null);

	const isDirty = !isSameValues(values, savedValues);

	useEffect(() => {
		latestRef.current = values;
	}, [values]);

	const flush = useCallback(() => {
		queueRef.current = queueRef.current.then(async () => {
			const snapshot = latestRef.current;
			if (isSameValues(snapshot, savedRef.current)) return true;
			dirtySinceRef.current = null;
			setIsSaving(true);
			try {
				const result = await save(snapshot);
				if (result?.error) throw new Error(result.error);
				const saved = result?.saved ?? snapshot;
				savedRef.current = saved;
				setSavedValues(saved);
				setSavedAt(Date.now());
				setError(null);
				return true;
			} catch (caught) {
				setError(caught.message || "Couldn't save");
				return false;
			} finally {
				setIsSaving(false);
			}
		});
		return queueRef.current;
	}, [save]);

	useEffect(() => {
		if (!isDirty) return;
		dirtySinceRef.current ??= Date.now();
		const wait = Math.min(SAVE_DELAY, dirtySinceRef.current + MAX_SAVE_DELAY - Date.now());
		const timer = setTimeout(flush, Math.max(0, wait));
		return () => clearTimeout(timer);
	}, [values, isDirty, flush]);

	// Following a link unmounts the form before the timer fires.
	useEffect(() => () => void flush(), [flush]);

	const markSaved = useCallback((next) => {
		latestRef.current = next;
		savedRef.current = next;
		setSavedValues(next);
	}, []);

	return { isDirty, isSaving, savedAt, error, flush, markSaved };
}

function isSameValues(a, b) {
	return Object.keys(a).every((key) => a[key] === b[key]);
}
