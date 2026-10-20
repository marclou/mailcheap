import { prepareIndex } from "@/lib/search";

export const SEARCH_INDEX_PATH = "/search-index.json";

let indexPromise = null;

// The search index (app/search-index.json), fetched once per page load. A failed fetch is forgotten, so opening search
// again retries it.
export function loadSearchIndex() {
	indexPromise ??= fetch(SEARCH_INDEX_PATH)
		.then((response) => {
			if (!response.ok) throw new Error(`Search index: ${response.status}`);
			return response.json();
		})
		.then(prepareIndex)
		.catch((error) => {
			indexPromise = null;
			throw error;
		});
	return indexPromise;
}
