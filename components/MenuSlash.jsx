"use client";

import { useId, useImperativeHandle, useState } from "react";
import { flip, shift } from "@floating-ui/dom";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import {
	CodeXml,
	Heading1,
	Heading2,
	Heading3,
	ImagePlus,
	List,
	ListOrdered,
	Minus,
	MousePointerClick,
	Pilcrow,
	Plus,
	RectangleHorizontal,
	SquareDashed,
	TextQuote,
	UserRound,
} from "lucide-react";
import { isInSection } from "@/components/BlockSection";
import IconField from "@/components/IconField";
import { findMergeTagMatch, matchFields } from "@/lib/editor-merge-tags";
import { FIELDS_TITLE, SLASH_ADD_FIELD, fitMenu, getSlashMenu, listSlashOptions, moveInSlashMenu } from "@/lib/editor-slash-menu";
import { FIRST_NAME_KEY, fieldTag, firstNameTag } from "@/lib/merge-tags";
import { cn } from "@/lib/utils";

// Between the caret and the menu.
const GAP = 4;
// The scrolling list's own padding, kept in view around the option the keys select.
const LIST_PADDING = 4;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MENU =
	"flex origin-top-left flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg animate-in duration-150 fade-in-0 zoom-in-95 in-data-[side=top]:origin-bottom-left";
const ROW = "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm";
const SELECTED = "bg-accent text-accent-foreground";
const ICON = "grid size-7 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground";
const LABEL = "px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground";

// Each kind as what it makes (lib/editor-slash-menu.js): the blocks as tiles, a section as its dashed outline, and the
// fields as the gray pills they are in the text, with a way to add one. A search lists what it finds instead. The
// editor keeps the focus and passes the keys on: the arrows move, Enter or Tab picks, and Escape closes the menu
// (@tiptap/suggestion).
export default function MenuSlash({ items, query, command, ref }) {
	const personalId = useId();
	const fieldsId = useId();
	const menu = getSlashMenu(items, { query });
	const options = listSlashOptions(menu);
	const [state, setState] = useState({ query, index: 0 });
	const index = Math.min(state.query === query ? state.index : 0, options.length - 1);
	const selected = options[index];

	useImperativeHandle(ref, () => ({
		onKeyDown({ event }) {
			if (!options.length) return false;
			if (event.key === "Enter" || event.key === "Tab") {
				command(selected);
				return true;
			}
			const next = moveInSlashMenu(menu, index, event.key);
			if (next === null) return false;
			setState({ query, index: next });
			return true;
		},
	}));

	if (!options.length) return null;

	function optionProps(option) {
		return { isSelected: option === selected, onPoint: () => setState({ query, index: options.indexOf(option) }), onPick: () => command(option) };
	}

	return (
		<div className={cn(MENU, "max-h-[min(27rem,var(--slash-menu-height,27rem))] w-[min(19.5rem,calc(100vw-1rem))]")}>
			<div data-slash-scroll className="min-h-0 overflow-y-auto overscroll-contain">
				<div role="listbox" aria-label="Insert">
					{menu.groups ? (
						<div className="p-1">
							{menu.groups.map((group) => (
								<GroupSlash key={group.label} label={group.label}>
									{group.items.map((item) => (
										<OptionSlash key={item.id ?? item.title} item={item} hint={item.key} {...optionProps(item)} />
									))}
								</GroupSlash>
							))}
						</div>
					) : (
						<>
							<div role="group" aria-label="Blocks" className="grid grid-cols-4 gap-0.5 p-1.5">
								{menu.blocks.map((item) => (
									<TileSlash key={item.title} item={item} {...optionProps(item)} />
								))}
							</div>
							<div role="group" aria-labelledby={personalId} className="border-t bg-muted/40 px-1.5 pt-0.5 pb-2">
								<p id={personalId} className={LABEL}>
									Personalize
								</p>
								{menu.section && <RowSection item={menu.section} {...optionProps(menu.section)} />}
								<div role="group" aria-labelledby={fieldsId} className="flex flex-wrap items-center gap-1.5 px-2 pt-2.5">
									<span id={fieldsId} className="mr-0.5 text-xs text-muted-foreground">
										Fields
									</span>
									{menu.fields.map((item) => (
										<ChipField key={item.id} item={item} {...optionProps(item)} />
									))}
									<ChipAddField {...optionProps(SLASH_ADD_FIELD)} />
								</div>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function GroupSlash({ label, children }) {
	const id = useId();
	return (
		<div role="group" aria-labelledby={id}>
			<p id={id} className={LABEL}>
				{label}
			</p>
			{children}
		</div>
	);
}

// hint: what the option is, in the words the editor takes, like a field's key.
function OptionSlash({ item, hint, isSelected, onPoint, onPick }) {
	const Icon = item.isAddField ? Plus : item.icon;
	return (
		<button
			type="button"
			role="option"
			aria-selected={isSelected}
			ref={isSelected ? scrollToOption : undefined}
			onPointerMove={onPoint}
			onMouseDown={keepEditorFocus}
			onClick={onPick}
			className={cn(ROW, isSelected && SELECTED)}
		>
			<span className={cn(ICON, item.isSection && "border-dashed border-foreground/30")}>
				<Icon className="size-4" type={item.type} />
			</span>
			<span className="min-w-0 flex-1 truncate">{item.title}</span>
			{hint && <span className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground">{hint}</span>}
		</button>
	);
}

function TileSlash({ item, isSelected, onPoint, onPick }) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={isSelected}
			aria-label={item.title}
			ref={isSelected ? scrollToOption : undefined}
			onPointerMove={onPoint}
			onMouseDown={keepEditorFocus}
			onClick={onPick}
			className={cn(
				"flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 pt-2 pb-1.5 text-[11px] leading-tight text-foreground/80",
				isSelected && SELECTED
			)}
		>
			<span className="grid size-8 place-items-center rounded-md border bg-background text-muted-foreground">
				<item.icon aria-hidden="true" className="size-4" />
			</span>
			<span className="max-w-full truncate">{item.tile ?? item.title}</span>
		</button>
	);
}

function RowSection({ item, isSelected, onPoint, onPick }) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={isSelected}
			ref={isSelected ? scrollToOption : undefined}
			onPointerMove={onPoint}
			onMouseDown={keepEditorFocus}
			onClick={onPick}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-lg border border-dashed border-foreground/25 bg-background px-2 py-1.5 text-left transition-colors duration-150",
				isSelected && cn("border-foreground/45", SELECTED)
			)}
		>
			<span className={ICON}>
				<item.icon aria-hidden="true" className="size-4" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm">{item.title}</span>
				<span className="block truncate text-xs text-muted-foreground">Only some readers see it</span>
			</span>
		</button>
	);
}

function ChipField({ item, isSelected, onPoint, onPick }) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={isSelected}
			title={`{{${item.key}}}`}
			ref={isSelected ? scrollToOption : undefined}
			onPointerMove={onPoint}
			onMouseDown={keepEditorFocus}
			onClick={onPick}
			className={cn(
				"rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[13px] transition-colors duration-150",
				isSelected && "bg-foreground/[0.14] ring-2 ring-ring/40"
			)}
		>
			{item.title}
		</button>
	);
}

// An empty slot, dashed like the place a new field takes.
function ChipAddField({ isSelected, onPoint, onPick }) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={isSelected}
			ref={isSelected ? scrollToOption : undefined}
			onPointerMove={onPoint}
			onMouseDown={keepEditorFocus}
			onClick={onPick}
			className={cn(
				"flex items-center gap-1 rounded-md border border-dashed border-foreground/25 px-1.5 py-px text-[13px] text-muted-foreground transition-colors duration-150",
				isSelected && cn("border-foreground/45", SELECTED)
			)}
		>
			<Plus aria-hidden="true" className="size-3.5" />
			{SLASH_ADD_FIELD.title}
		</button>
	);
}

// Typing "/" at the start of a line or after a space opens the menu, but not in a button's text; the text after it
// searches. contactFields: the account's fields, offered after the first name, as setEditorFields keeps them
// (lib/editor-merge-tags.js). In a section, a section isn't offered. onAddField: Add a field was picked.
export const SlashCommand = Extension.create({
	name: "slashCommand",
	addOptions() {
		return { onPickImage: () => {}, onAddField: () => {}, contactFields: [] };
	},
	addStorage() {
		return { contactFields: this.options.contactFields };
	},
	addProseMirrorPlugins() {
		const { storage } = this;
		return [
			Suggestion({
				editor: this.editor,
				char: "/",
				// Rendered before it's first placed, so it's placed at its own height.
				initialItems: getSlashItems(this.options.contactFields),
				items: ({ editor }) => {
					const items = getSlashItems(storage.contactFields);
					return isInSection(editor.state) ? items.filter((item) => !item.isSection) : items;
				},
				allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "button",
				command: ({ editor, range, props: item }) => {
					runPick(editor, range, item);
					if (item.isImage) this.options.onPickImage(editor);
					if (item.isAddField) this.options.onAddField(editor);
				},
				...MENU_OPTIONS,
				render: () => renderMenu(MenuSlash),
			}),
		];
	},
});

// The fields a tag being typed could be, under its "{{" as the key is typed (lib/editor-merge-tags.js): a suggestion
// only, which typing on ignores, and which a |, }} or no field matching closes. The editor keeps the focus and passes
// the keys on: the arrows move, Enter or Tab picks, and Escape closes it until the next tag (@tiptap/suggestion).
export function MenuMergeTag({ items, query, command, ref }) {
	const [state, setState] = useState({ query, index: 0 });
	const index = Math.min(state.query === query ? state.index : 0, items.length - 1);

	useImperativeHandle(ref, () => ({
		onKeyDown({ event }) {
			if (!items.length) return false;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				const step = event.key === "ArrowDown" ? 1 : -1;
				setState({ query, index: (index + step + items.length) % items.length });
				return true;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				command(items[index]);
				return true;
			}
			return false;
		},
	}));

	if (!items.length) return null;

	return (
		<div className={cn(MENU, "max-h-[min(20rem,var(--slash-menu-height,20rem))] w-64")}>
			<p className="shrink-0 px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">{FIELDS_TITLE}</p>
			<div data-slash-scroll className="min-h-0 overflow-y-auto overscroll-contain p-1 pt-0">
				<div role="listbox" aria-label={FIELDS_TITLE}>
					{items.map((item, position) => (
						<OptionSlash
							key={item.id}
							item={item}
							hint={item.key}
							isSelected={position === index}
							onPoint={() => position !== index && setState({ query, index: position })}
							onPick={() => command(item)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

// Typing "{{" opens MenuMergeTag, anywhere text goes, buttons included. contactFields: the account's fields, offered
// after the first name, as setEditorFields keeps them (lib/editor-merge-tags.js).
export const MergeTagSuggestion = Extension.create({
	name: "mergeTagSuggestion",
	addOptions() {
		return { contactFields: [] };
	},
	addStorage() {
		return { contactFields: this.options.contactFields };
	},
	addProseMirrorPlugins() {
		const { storage } = this;
		return [
			Suggestion({
				editor: this.editor,
				pluginKey: new PluginKey("mergeTagSuggestion"),
				char: "{{",
				findSuggestionMatch: findMergeTagMatch,
				initialItems: getFieldItems(this.options.contactFields),
				items: ({ query }) => matchFields(getFieldItems(storage.contactFields), query),
				command: ({ editor, range, props: item }) => runPick(editor, range, item),
				...MENU_OPTIONS,
				render: () => renderMenu(MenuMergeTag),
			}),
		];
	},
});

export function getSlashItems(contactFields = []) {
	return [...SLASH_ITEMS, ...getFieldItems(contactFields)];
}

// The first name, then the account's fields, each with the key its tag prints.
export function getFieldItems(contactFields = []) {
	return [FIRST_NAME, ...contactFields.map(toFieldItem)];
}

// What was typed gives way to the item picked. The editor takes its focus back first: the chain's own focus waits a
// frame, and meanwhile the browser would leave the caret where the typed text was.
function runPick(editor, range, item) {
	editor.view.focus();
	item.run(editor.chain().focus().deleteRange(range)).run();
}

// Below the caret, or above it where only there it fits (lib/editor-slash-menu.js).
const MENU_OPTIONS = {
	offset: { mainAxis: GAP },
	flip: false,
	floatingUi: { middleware: [flip(getFlipOptions), shift({ padding: 8 })] },
};

// Component, hidden until it's placed with its options. The page scrolls only as they change, and only when the menu
// wouldn't show whole (lib/editor-slash-menu.js): never as the page itself scrolls. Each opening starts afresh.
function renderMenu(Component) {
	let component;
	let unmount;
	let clientRect;
	let shownHeight = 0;

	function place({ x, y, placement, strategy }) {
		const { element } = component;
		Object.assign(element.style, { position: strategy, left: `${x}px`, top: `${y}px` });
		element.dataset.side = placement.split("-")[0];
		const caret = clientRect?.();
		const height = element.offsetHeight;
		if (!caret || !height) return;
		const { maxHeight, scroll } = fitMenu({ caret, height, area: getMenuArea(), gap: GAP });
		element.style.setProperty("--slash-menu-height", `${maxHeight}px`);
		// It shrinks first, which places it again.
		if (height > maxHeight + 1) return;
		element.style.visibility = "";
		if (height === shownHeight) return;
		shownHeight = height;
		if (scroll > 0) window.scrollBy({ top: scroll, behavior: window.matchMedia(REDUCED_MOTION).matches ? "instant" : "smooth" });
	}

	return {
		onStart(props) {
			clientRect = props.clientRect;
			shownHeight = 0;
			component = new ReactRenderer(Component, { props, editor: props.editor });
			Object.assign(component.element.style, { position: "absolute", top: "0", left: "0", zIndex: "50", visibility: "hidden" });
			unmount = props.mount(component.element, { onPosition: place });
		},
		onUpdate(props) {
			clientRect = props.clientRect;
			component.updateProps(props);
		},
		onKeyDown(props) {
			return component.ref?.onKeyDown(props) ?? false;
		},
		onExit() {
			unmount?.();
			component.destroy();
		},
	};
}

// Above the caret only where there's room there and none below, between the page's own bars.
function getFlipOptions() {
	const screen = getScreen();
	const area = getMenuArea();
	return {
		padding: { top: area.top - screen.top, bottom: screen.bottom - area.bottom },
		crossAxis: false,
		fallbackStrategy: "initialPlacement",
	};
}

// What the page's sticky bars leave of the screen, as html's scroll-padding says (app/globals.css): on a phone with its
// keyboard open, the part above the keyboard, where the bar behind it no longer counts.
function getMenuArea() {
	const style = getComputedStyle(document.documentElement);
	const screen = getScreen();
	return {
		top: Math.max(screen.top, parseFloat(style.scrollPaddingTop) || 0),
		bottom: Math.min(screen.bottom, document.documentElement.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0)),
	};
}

function getScreen() {
	const viewport = window.visualViewport;
	const top = viewport?.offsetTop ?? 0;
	return { top, bottom: top + (viewport?.height ?? window.innerHeight) };
}

// The list scrolls to the option the keys select; Element.scrollIntoView would scroll the page too.
function scrollToOption(option) {
	const list = option?.closest("[data-slash-scroll]");
	if (!list) return;
	const { top, bottom } = option.getBoundingClientRect();
	const box = list.getBoundingClientRect();
	if (top < box.top) list.scrollTop -= box.top - top + LIST_PADDING;
	else if (bottom > box.bottom) list.scrollTop += bottom - box.bottom + LIST_PADDING;
}

function keepEditorFocus(event) {
	event.preventDefault();
}

function toFieldItem({ key, label, type }) {
	return {
		id: `field:${key}`,
		key,
		title: label,
		keywords: `${key} contact field personalize merge tag`,
		icon: IconField,
		type,
		isField: true,
		run: (chain) => chain.insertContent(fieldTag(key)),
	};
}

// The blocks in the order of their tiles, four a row: text, then lists and dividers, then what's set apart. tile: the
// tile's shorter name.
const SLASH_ITEMS = [
	{ title: "Text", keywords: "paragraph", icon: Pilcrow, run: (chain) => chain.setParagraph() },
	{ title: "Heading 1", keywords: "title h1 big", icon: Heading1, run: (chain) => chain.setHeading({ level: 1 }) },
	{ title: "Heading 2", keywords: "subtitle h2", icon: Heading2, run: (chain) => chain.setHeading({ level: 2 }) },
	{ title: "Heading 3", keywords: "h3 small", icon: Heading3, run: (chain) => chain.setHeading({ level: 3 }) },
	{ title: "Bulleted list", tile: "Bullets", keywords: "ul unordered", icon: List, run: (chain) => chain.toggleBulletList() },
	{ title: "Numbered list", tile: "Numbers", keywords: "ol ordered", icon: ListOrdered, run: (chain) => chain.toggleOrderedList() },
	{ title: "Quote", keywords: "blockquote", icon: TextQuote, run: (chain) => chain.setBlockquote() },
	{ title: "Divider", keywords: "hr separator line", icon: Minus, run: (chain) => chain.setHorizontalRule() },
	{ title: "Image", keywords: "picture photo upload library", icon: ImagePlus, run: (chain) => chain, isImage: true },
	{
		title: "Button",
		keywords: "cta call to action link",
		icon: MousePointerClick,
		run: (chain) => chain.setNode("button"),
	},
	{
		title: "Box",
		keywords: "callout container update promo",
		icon: RectangleHorizontal,
		run: (chain) => chain.wrapIn("callout"),
	},
	{
		title: "HTML",
		keywords: "code embed snippet custom raw markup",
		icon: CodeXml,
		run: (chain) => chain.insertContent({ type: "htmlBlock", attrs: { isNew: true } }),
	},
	// Part of the issue for some readers, or for its emails or its website only (components/BlockSection.jsx).
	{
		title: "Section",
		keywords: "some readers who sees audience tag segment personalize dynamic content email only web only",
		icon: SquareDashed,
		isSection: true,
		run: (chain) => chain.wrapIn("section", { isNew: true }),
	},
];
const FIRST_NAME = {
	id: `field:${FIRST_NAME_KEY}`,
	key: FIRST_NAME_KEY,
	title: "First name",
	keywords: "name contact field personalize merge tag hello",
	icon: UserRound,
	isField: true,
	run: (chain) => chain.insertContent(firstNameTag()),
};
