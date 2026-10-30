import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LinkHelpFields from "../components/LinkHelpFields.jsx";
import MenuSlash, { getSlashItems } from "../components/MenuSlash.jsx";
import { SLASH_ADD_FIELD, fitMenu, getSlashMenu, listSlashOptions, moveInSlashMenu } from "../lib/editor-slash-menu.js";

// The editor's slash menu (components/MenuSlash.jsx, lib/editor-slash-menu.js): the blocks as tiles, then what's
// personal to each reader, a section and the fields with a way to add one, all in view; the arrow keys through them,
// a search that reaches all of it, and where the menu shows. Its links into the help center: tests/help.test.mjs.
const FIELDS = [
	{ key: "plan", label: "Plan", type: "text" },
	{ key: "stripe_customer_id", label: "Stripe customer ID", type: "text" },
	{ key: "campaign_channel", label: "Campaign channel", type: "text" },
	{ key: "birthday", label: "Birthday", type: "date" },
];
// Four tiles a row.
const BLOCKS = ["Text", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Quote", "Divider", "Image", "Button", "Box", "HTML"];
const ADD = SLASH_ADD_FIELD.id;

// What the arrows go through, in order: items by title, Add a field by its id.
function rows(query, { fields = FIELDS, inSection = false } = {}) {
	return listSlashOptions(menuFor(query, { fields, inSection })).map((option) => (option.isAddField ? option.id : option.title));
}

function menuFor(query, { fields = FIELDS, inSection = false } = {}) {
	const items = getSlashItems(fields).filter((item) => !inSection || !item.isSection);
	return getSlashMenu(items, { query });
}

function render(query, fields = FIELDS) {
	return renderToStaticMarkup(createElement(MenuSlash, { items: getSlashItems(fields), query, command: () => {} }));
}

test("all in view: the blocks as tiles, then a section, the first name and the fields, and a way to add one", () => {
	assert.deepEqual(rows(""), [...BLOCKS, "Section", "First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday", ADD]);
	assert.deepEqual(rows("", { fields: [] }), [...BLOCKS, "Section", "First name", ADD], "without fields of the account's own");
	assert.deepEqual(rows("", { inSection: true }), [...BLOCKS, "First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday", ADD], "no section in a section");

	const html = render("");
	assert.match(html, /aria-label="Bulleted list"[^>]*>.*?>Bullets<\/span>/, "a tile has a shorter name, and its whole one for screen readers");
	assert.ok(html.indexOf(">HTML<") < html.indexOf(">Personalize<"));
	assert.match(html, />Section<\/span><span[^>]*>Only some readers see it</);
	assert.match(html, /title="\{\{plan\}\}"[^>]*>Plan<\/button>/, "a field is a pill with its tag");
	assert.ok(html.indexOf(">Birthday<") < html.indexOf("Add a field"));
	assert.doesNotMatch(html, /How to add names and fields|Each reader gets/, "the fields' dialog says how they work");
});

test("the arrow keys go across the tiles and on to the next row, and down by rows to the section and the fields", () => {
	const menu = menuFor("");
	const last = listSlashOptions(menu).length - 1;
	const go = (index, ...keys) => keys.reduce((at, key) => moveInSlashMenu(menu, at, key), index);
	assert.equal(go(0, "ArrowRight"), 1);
	assert.equal(go(3, "ArrowRight"), 4, "from the end of a row to the start of the next");
	assert.equal(go(0, "ArrowLeft"), last, "round to Add a field");
	assert.equal(go(0, "ArrowDown", "ArrowDown"), 8);
	assert.equal(go(8, "ArrowDown"), 12, "from the last row to the section");
	assert.equal(go(10, "ArrowDown"), 12, "from any tile of it");
	assert.equal(go(12, "ArrowDown"), 13, "then the first name");
	assert.equal(go(13, "ArrowDown"), 0, "and back to the top");
	assert.equal(go(12, "ArrowUp"), 8);
	assert.equal(go(15, "ArrowUp"), 12, "from a field to the section");
	assert.equal(go(1, "ArrowUp"), last, "up from the top to the fields");
	assert.equal(go(13, "ArrowRight", "ArrowRight"), 15, "across the fields");
	assert.equal(moveInSlashMenu(menu, 0, "Enter"), null, "only the arrows");

	const inSection = menuFor("", { inSection: true });
	assert.equal(moveInSlashMenu(inSection, 9, "ArrowDown"), 12, "without a section, down to the fields");
	assert.equal(moveInSlashMenu(inSection, 12, "ArrowUp"), 8);

	const found = menuFor("pl");
	assert.equal(moveInSlashMenu(found, 0, "ArrowDown"), 1);
	assert.equal(moveInSlashMenu(found, 1, "ArrowDown"), 0);
	assert.equal(moveInSlashMenu(found, 0, "ArrowRight"), null, "a search's list leaves ← and → to the caret");
});

test("what's typed after the slash finds blocks and what's personal to each reader, a group each", () => {
	assert.deepEqual(rows("pl"), ["Image", "Plan"], "Image's keywords have upload");
	assert.deepEqual(rows("plan"), ["Plan"]);
	assert.deepEqual(rows("PLAN"), ["Plan"]);
	assert.deepEqual(rows("stripe"), ["Stripe customer ID"]);
	assert.deepEqual(rows("campaign_ch"), ["Campaign channel"], "by key");
	assert.deepEqual(rows("first"), ["First name"]);
	assert.deepEqual(rows("field"), ["First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday", ADD]);
	assert.deepEqual(rows("add"), [ADD]);
	assert.deepEqual(rows("some readers"), ["Section"]);
	assert.deepEqual(rows("some readers", { inSection: true }), []);
	assert.deepEqual(rows("quote"), ["Quote"]);
	assert.deepEqual(rows("zzz"), []);

	const { groups } = menuFor("pl");
	assert.deepEqual(
		groups.map(({ label, items }) => [label, items.map(({ title }) => title)]),
		[
			["Blocks", ["Image"]],
			["Personalize", ["Plan"]],
		]
	);

	const html = render("pl");
	assert.match(html, /role="group" aria-labelledby="([^"]+)"><p id="\1"[^>]*>Personalize<\/p>/);
	assert.ok(html.indexOf(">Blocks<") < html.indexOf(">Image<"));
	assert.ok(html.indexOf(">Image<") < html.indexOf(">Personalize<"));
	assert.match(html, />Plan<\/span><span[^>]*>plan<\/span>/, "a field with its key");
	assert.equal(render("zzz"), "", "nothing found, no menu");
});

test("a field inserts its tag, the first name its tag with a fallback, and Add a field only takes the slash's place", () => {
	const items = getSlashItems(FIELDS);
	const insert = (title) => items.find((item) => item.title === title).run({ insertContent: (content) => content });
	assert.equal(insert("Plan"), "{{plan}}");
	assert.equal(insert("Stripe customer ID"), "{{stripe_customer_id}}");
	assert.equal(insert("First name"), "{{first_name|there}}");
	const chain = {};
	assert.equal(SLASH_ADD_FIELD.run(chain), chain);
	assert.equal(SLASH_ADD_FIELD.isAddField, true);
});

test("how to add names and fields opens the contacts article's steps in a new tab", () => {
	const html = renderToStaticMarkup(createElement(LinkHelpFields));
	assert.match(html, /^<a href="\/help\/contacts#fields" target="_blank" rel="noopener"/);
	assert.match(html, />How to add names and fields to contacts</);
});

test("the menu shows whole where it opens, and the page only moves when it fits neither below nor above the caret", () => {
	const caret = (top) => ({ top, bottom: top + 24 });
	const fit = (top, area) => fitMenu({ caret: caret(top), height: 320, area, gap: 4 });
	// A laptop's screen under the campaign's top bar.
	const area = { top: 80, bottom: 784 };
	assert.deepEqual(fit(300, area), { maxHeight: 676, scroll: 0 }, "below");
	assert.equal(fit(436, area).scroll, 0, "just fits below");
	assert.equal(fit(437, area).scroll, 0, "fits above instead");
	assert.equal(fit(736, area).scroll, 0, "at the bottom of the screen, above");

	const short = { top: 80, bottom: 544 };
	assert.equal(fit(110, short).scroll, 0, "below, on a short screen");
	assert.equal(fit(450, short).scroll, 0, "above, on a short screen");
	assert.deepEqual(fit(254, short), { maxHeight: 436, scroll: 58 }, "neither: just enough for its bottom to show");
	assert.equal(fitMenu({ caret: { top: 254, bottom: 276.4 }, height: 320, area: short, gap: 4 }).scroll, 57, "parts of a pixel count");
	assert.equal(fitMenu({ caret: { top: 60, bottom: 84 }, height: 900, area, gap: 4 }).scroll, 0, "never with the caret under the top bar");
});

test("on a short screen, like a phone's with its keyboard open, the menu shrinks to what's left next to the caret", () => {
	const area = { top: 120, bottom: 380 };
	const caret = { top: 300, bottom: 324 };
	const { maxHeight } = fitMenu({ caret, height: 320, area, gap: 4 });
	assert.equal(maxHeight, 232);
	assert.equal(fitMenu({ caret, height: maxHeight, area, gap: 4 }).scroll, 180, "the caret ends at the area's top and the menu's bottom at its bottom");
	assert.equal(fitMenu({ caret, height: 120, area: { top: 300, bottom: 360 }, gap: 4 }).maxHeight, 120, "three options at least");
});
