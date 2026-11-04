// Who else is on a team's draft and where (lib/presence.js), shared with the browser.

export const PRESENCE_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4f46e5"];
export const PRESENCE_FIELDS = ["subject", "previewText"];
const MAX_BLOCK = 10_000;
const MAX_OFFSET = 100_000;

export function getPresenceColor(id) {
	let hash = 0;
	for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

// What a browser says about where its person is, kept to numbers in range and known fields. cursor: their pointer, over
// a block of the content ({ block: its index, fx, fy: fractions across and down it }), or elsewhere on the draft
// ({ fx: a fraction across, y: pixels down }). caret: the block or the field they're typing in.
export function readPresenceState(body) {
	return { cursor: readCursor(body?.cursor), caret: readCaret(body?.caret) };
}

function readFraction(value) {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)) : null;
}

function readBlock(value) {
	return Number.isInteger(value) && value >= 0 && value <= MAX_BLOCK ? value : null;
}

function readCursor(cursor) {
	if (!cursor || typeof cursor !== "object") return null;
	const fx = readFraction(cursor.fx);
	if (fx === null) return null;
	const block = readBlock(cursor.block);
	if (block !== null) {
		const fy = readFraction(cursor.fy);
		return fy === null ? null : { block, fx, fy };
	}
	if (!Number.isFinite(cursor.y)) return null;
	return { fx, y: Math.round(Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, cursor.y))) };
}

function readCaret(caret) {
	return PRESENCE_FIELDS.includes(caret) ? caret : readBlock(caret);
}
