// Two people on a team's draft (lib/use-draft-sync.js): when someone else saved since this editor's last save, their
// version and this one merge against the one both started from, block by block, so their changes to different
// paragraphs are both kept. A paragraph both changed keeps this editor's, the latest typing; one deleted by one and
// changed by the other stays, changed; blocks both added go in, theirs first.

// The pairs of indexes of a longest common run of two lists, after their common start and end.
function matchIndexes(a, b) {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let end = 0;
	while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
	const pairs = Array.from({ length: start }, (_, index) => [index, index]);
	const middleA = a.slice(start, a.length - end);
	const middleB = b.slice(start, b.length - end);
	const rows = middleA.length;
	const columns = middleB.length;
	const lengths = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
	for (let i = rows - 1; i >= 0; i--) {
		for (let j = columns - 1; j >= 0; j--) {
			lengths[i][j] = middleA[i] === middleB[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
		}
	}
	for (let i = 0, j = 0; i < rows && j < columns; ) {
		if (middleA[i] === middleB[j]) {
			pairs.push([start + i, start + j]);
			i++;
			j++;
		} else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
		else j++;
	}
	for (let index = 0; index < end; index++) pairs.push([a.length - end + index, b.length - end + index]);
	return pairs;
}

// What a version did to the base: each base block kept, replaced or deleted, and the blocks it added before each base
// position (inserts[base.length]: at the end). Changed blocks between two kept ones replace the base's in order.
function readEdits(base, version) {
	const edits = base.map(() => ({ kind: "keep" }));
	const inserts = Array.from({ length: base.length + 1 }, () => []);
	let fromBase = 0;
	let fromVersion = 0;
	for (const [baseIndex, versionIndex] of [...matchIndexes(base, version), [base.length, version.length]]) {
		const added = version.slice(fromVersion, versionIndex);
		for (let offset = 0; offset < baseIndex - fromBase; offset++) {
			edits[fromBase + offset] = offset < added.length ? { kind: "replace", value: added[offset] } : { kind: "delete" };
		}
		inserts[baseIndex].push(...added.slice(baseIndex - fromBase));
		fromBase = baseIndex + 1;
		fromVersion = versionIndex + 1;
	}
	return { edits, inserts };
}

function combine(original, mine, theirs) {
	if (mine.kind === "replace") return mine.value;
	if (theirs.kind === "replace") return theirs.value;
	if (mine.kind === "delete" || theirs.kind === "delete") return null;
	return original;
}

export function mergeSequences(base, mine, theirs) {
	const own = readEdits(base, mine);
	const other = readEdits(base, theirs);
	const merged = [];
	for (let index = 0; index <= base.length; index++) {
		merged.push(...other.inserts[index], ...own.inserts[index].filter((block) => !other.inserts[index].includes(block)));
		if (index === base.length) break;
		const value = combine(base[index], own.edits[index], other.edits[index]);
		if (value !== null) merged.push(value);
	}
	return merged;
}

// A field both changed keeps this editor's.
export function mergeField(base, mine, theirs) {
	return mine === base ? theirs : mine;
}

// { subject, previewText, body } each. split(body): its top-level blocks, as the editor writes them; join puts them back.
export function mergeDrafts({ base, mine, theirs, split, join = (blocks) => blocks.join("") }) {
	return {
		subject: mergeField(base.subject, mine.subject, theirs.subject),
		previewText: mergeField(base.previewText, mine.previewText, theirs.previewText),
		body: base.body === mine.body ? theirs.body : join(mergeSequences(split(base.body), split(mine.body), split(theirs.body))),
	};
}
