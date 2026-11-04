"use client";

import { useRef, useState } from "react";
import BarContactSelection from "@/components/BarContactSelection";
import { ContactSelectionContext } from "@/lib/use-contact-selection";

// The contacts list's selection: some contacts of the page it shows, or with isAll every contact its filters show, on
// every page. The page keys it with its filters and its number, so another page or other filters start over, and the
// bar of what it can do comes after the list. filters: the list's, with segmentId on a segment's page; total: how many
// contacts it shows, on every page; counts: how many of each status within its other filters; contacts: the page's,
// { id, status, tags }.
export default function ProviderContactSelection({ newsletterId, filters, total, counts, contacts, children }) {
	const [{ ids, isAll }, setSelection] = useState(() => ({ ids: new Set(), isAll: false }));
	const lastIdRef = useRef(null);
	const pageIds = contacts.map(({ id }) => id);

	// With shift, from the last contact ticked or unticked to this one, as mail apps do. Unticking one of every contact
	// leaves the rest of the page ticked: the actions take IDs or the list's filters, with no way to leave a few out.
	function toggle(id, isChecked, { isRange = false } = {}) {
		const from = isRange ? pageIds.indexOf(lastIdRef.current) : -1;
		const to = pageIds.indexOf(id);
		const changed = from === -1 ? [id] : pageIds.slice(Math.min(from, to), Math.max(from, to) + 1);
		lastIdRef.current = id;
		setSelection((current) => {
			const next = new Set(current.isAll ? pageIds : current.ids);
			for (const changedId of changed) {
				if (isChecked) next.add(changedId);
				else next.delete(changedId);
			}
			return { ids: next, isAll: false };
		});
	}

	function clear() {
		setSelection({ ids: new Set(), isAll: false });
	}

	const value = {
		newsletterId,
		filters,
		total,
		counts,
		contacts,
		ids,
		isAll,
		count: isAll ? total : ids.size,
		isSelected: (id) => isAll || ids.has(id),
		// What the server actions take (app/(app)/contacts/actions.js).
		target: isAll ? { newsletterId, filters } : { newsletterId, ids: [...ids] },
		toggle,
		selectAll: () => setSelection(selectEveryone(pageIds, total)),
		clear,
	};

	return (
		<ContactSelectionContext value={value}>
			{children}
			<BarContactSelection />
		</ContactSelectionContext>
	);
}

// Every contact the list shows, on every page: by ID when they all fit on this one, as if each was ticked.
export function selectEveryone(pageIds, total) {
	return total > pageIds.length ? { ids: new Set(), isAll: true } : { ids: new Set(pageIds), isAll: false };
}
