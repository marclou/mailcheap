// Search over the help center and the docs (lib/search-index.js builds the entries, components/DialogSearch.jsx shows
// the results). Each word of the query has to match a word of the entry, in its title, its parent or its text, exactly,
// as a prefix, inside it, or with a typo or two; a match in the title counts most.
export const SEARCH_GROUPS = [
	{ id: "help", label: "Help" },
	{ id: "api", label: "API and MCP" },
];

const FIELD_WEIGHTS = { title: 3, parent: 1.5, body: 1 };
// A whole article or docs page goes before one of its sections when they match about as well.
const PAGE_BONUS = 0.5;
const MATCH_SCORES = { exact: 1, prefix: 0.85, inside: 0.6, typo: 0.5 };
const SNIPPET_LENGTH = 110;

export function normalize(text) {
	return String(text ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

function toWords(text) {
	return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

// Each entry's words, worked out once when the index loads.
export function prepareIndex(entries) {
	return entries.map((entry) => ({
		entry,
		title: toWords(entry.title),
		parent: toWords(entry.parent),
		body: toWords(`${entry.text ?? ""} ${entry.keywords ?? ""}`),
	}));
}

// Typos allowed for a word of this length: none under 4 letters, one up to 7, two from 8.
function getTypos(length) {
	if (length < 4) return 0;
	return length < 8 ? 1 : 2;
}

// Edit distance with swapped letters counting as one, stopping once it's past max.
function getDistance(a, b, max) {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	let beforePrevious = null;
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
			if (beforePrevious && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, beforePrevious[j - 2] + 1);
			}
			current.push(value);
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) return max + 1;
		beforePrevious = previous;
		previous = current;
	}
	return previous[b.length];
}

// How a query word matches a word of an entry, or null.
export function matchWord(token, word) {
	if (word === token) return "exact";
	if (word.startsWith(token)) return "prefix";
	if (token.length >= 3 && word.includes(token)) return "inside";
	const typos = getTypos(token.length);
	if (!typos) return null;
	if (getDistance(token, word, typos) <= typos) return "typo";
	if (word.length > token.length && getDistance(token, word.slice(0, token.length), 1) <= 1) return "typo";
	return null;
}

function scoreIn(token, words) {
	let best = 0;
	for (const word of words) {
		const match = matchWord(token, word);
		if (match) best = Math.max(best, MATCH_SCORES[match]);
		if (best === MATCH_SCORES.exact) break;
	}
	return best;
}

// The entries every word of the query matches, best first, at most limit for each group, with the groups in the order of
// their best result.
export function search(prepared, query, { limit = 6 } = {}) {
	const tokens = toWords(query);
	if (tokens.length === 0) return [];
	const phrase = normalize(query).trim();
	const scored = [];
	for (const item of prepared) {
		let score = 0;
		for (const token of tokens) {
			const best = Math.max(
				scoreIn(token, item.title) * FIELD_WEIGHTS.title,
				scoreIn(token, item.parent) * FIELD_WEIGHTS.parent,
				scoreIn(token, item.body) * FIELD_WEIGHTS.body
			);
			if (!best) {
				score = 0;
				break;
			}
			score += best;
		}
		if (!score) continue;
		if (normalize(item.entry.title).includes(phrase)) score += FIELD_WEIGHTS.title;
		if (!item.entry.href.includes("#")) score += PAGE_BONUS;
		scored.push({ entry: item.entry, score });
	}
	scored.sort((a, b) => b.score - a.score);
	return SEARCH_GROUPS.map(({ id, label }) => ({ id, label, results: scored.filter(({ entry }) => entry.group === id).slice(0, limit) }))
		.filter(({ results }) => results.length > 0)
		.sort((a, b) => b.results[0].score - a.results[0].score);
}

// Where the query's words show in a text, as [start, end] ranges: the matching part of a word, or the whole word for a typo.
export function getHighlights(text, query) {
	const tokens = toWords(query);
	if (!text || tokens.length === 0) return [];
	const ranges = [];
	for (const { 0: original, index } of String(text).matchAll(/[\p{L}\p{N}]+/gu)) {
		const word = normalize(original);
		for (const token of tokens) {
			const match = matchWord(token, word);
			if (!match) continue;
			if (match === "typo" || word.length !== original.length) ranges.push([index, index + original.length]);
			else {
				const start = index + word.indexOf(token);
				ranges.push([start, start + token.length]);
			}
			break;
		}
	}
	return mergeRanges(ranges);
}

function mergeRanges(ranges) {
	const merged = [];
	for (const range of ranges.sort((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else merged.push([...range]);
	}
	return merged;
}

// What a result shows under its title: its text around the first word the query matches, its keywords when only they
// match, or the start of its text.
export function getSnippet(entry, query) {
	const text = entry.text ?? "";
	const inText = getHighlights(text, query)[0];
	if (inText) return getAround(text, inText[0]);
	const keywords = entry.keywords ?? "";
	const inKeywords = getHighlights(keywords, query)[0];
	return inKeywords ? getAround(keywords, inKeywords[0]) : trimEnd(text);
}

function getAround(text, position) {
	if (position < SNIPPET_LENGTH * 0.6) return trimEnd(text);
	const start = text.lastIndexOf(" ", position - 30) + 1;
	return `…${trimEnd(text.slice(start))}`;
}

function trimEnd(text) {
	if (text.length <= SNIPPET_LENGTH) return text;
	const end = text.lastIndexOf(" ", SNIPPET_LENGTH);
	return `${text.slice(0, end > 0 ? end : SNIPPET_LENGTH)}…`;
}
