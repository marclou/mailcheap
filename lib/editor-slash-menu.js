// The editor's slash menu (components/MenuSlash.jsx): what it lists, how the arrow keys go through it, and where it
// shows.

// Opens the account's fields over the editor, and the one added goes where the slash was (components/EditorRich.jsx).
export const SLASH_ADD_FIELD = Object.freeze({
	id: "add-field",
	title: "Add a field",
	keywords: "new contact field create custom personalize merge tag",
	isAddField: true,
	run: (chain) => chain,
});
export const FIELDS_TITLE = "Contact fields";
// The blocks' tiles in a row.
export const SLASH_COLUMNS = 4;
const ARROWS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
// Three options' worth: the least a short screen leaves the menu.
const MIN_MENU_HEIGHT = 120;

// Without a search, all of it in view: the blocks, then what's personal to each reader, a section (when there's none
// around the caret) and the fields, the first name first, before a way to add one. A search finds any of them, the
// blocks and what's personal in a group each. items: the blocks, the section (isSection) and the fields (isField).
export function getSlashMenu(items, { query = "" } = {}) {
	const blocks = items.filter((item) => !item.isField && !item.isSection);
	const section = items.find((item) => item.isSection) ?? null;
	const fields = items.filter((item) => item.isField);
	const search = query.toLowerCase().trim();
	if (!search) return { blocks, section, fields };
	const isFound = ({ title, keywords }) => `${title} ${keywords}`.toLowerCase().includes(search);
	const groups = [
		{ label: "Blocks", items: blocks.filter(isFound) },
		{ label: "Personalize", items: [...(section ? [section] : []), ...fields, SLASH_ADD_FIELD].filter(isFound) },
	];
	return { groups: groups.filter((group) => group.items.length > 0) };
}

// What the arrow keys go through, in the order the menu shows it.
export function listSlashOptions(menu) {
	if (menu.groups) return menu.groups.flatMap((group) => group.items);
	return [...menu.blocks, ...(menu.section ? [menu.section] : []), ...menu.fields, SLASH_ADD_FIELD];
}

// Where an arrow key goes from the option at index, or null when the key isn't the menu's. A search's list goes up and
// down, round from one end to the other, and leaves ← and → to the caret. The blocks go across, on to the next row,
// and up and down by rows; the section and the fields are a row each under them, and down from the fields is the top.
export function moveInSlashMenu(menu, index, key) {
	if (!ARROWS.includes(key)) return null;
	const count = listSlashOptions(menu).length;
	const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
	if (menu.groups) return key === "ArrowDown" || key === "ArrowUp" ? (index + step + count) % count : null;
	if (key === "ArrowRight" || key === "ArrowLeft") return (index + step + count) % count;
	const blocks = menu.blocks.length;
	const lastRow = Math.floor((blocks - 1) / SLASH_COLUMNS) * SLASH_COLUMNS;
	const section = menu.section ? blocks : -1;
	const isDown = step === 1;
	if (index < blocks) {
		if (isDown) return index < lastRow ? Math.min(index + SLASH_COLUMNS, blocks - 1) : blocks;
		return index >= SLASH_COLUMNS ? index - SLASH_COLUMNS : count - 1;
	}
	if (index === section) return isDown ? section + 1 : lastRow;
	if (isDown) return 0;
	return section === -1 ? lastRow : section;
}

// The menu shows below the caret, or above it where only there it fits, as Floating UI's flip places it; when neither
// fits, the page scrolls by just enough for it to show whole below, never so far that the caret leaves the area.
// maxHeight: what the area leaves next to the caret's line, so a menu that could never fit (a phone with its keyboard
// open) shrinks and scrolls inside. area: the part of the screen the page's own bars leave; it and caret in the
// viewport's pixels, as getBoundingClientRect gives them. gap: between the caret and the menu.
export function fitMenu({ caret, height, area, gap = 0 }) {
	const maxHeight = Math.max(MIN_MENU_HEIGHT, Math.floor(area.bottom - area.top - (caret.bottom - caret.top) - gap));
	const below = area.bottom - caret.bottom - gap;
	const above = caret.top - area.top - gap;
	if (height <= below || height <= above) return { maxHeight, scroll: 0 };
	return { maxHeight, scroll: Math.max(0, Math.min(Math.ceil(height - below), Math.floor(caret.top - area.top))) };
}
