"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { CornerDownLeft, Link, Mail, Trash2 } from "lucide-react";
import ImageFavicon from "@/components/ImageFavicon";
import { ButtonFormat } from "@/components/MenuFormat";
import { ALIGNMENTS } from "@/components/MenuImage";
import { isButtonLink } from "@/lib/buttons";
import { findButton } from "@/lib/editor-button";
import { deleteBlock } from "@/lib/editor-undo-delete";
import { formatLinkUrl, normalizeUrl } from "@/lib/links";

// The toolbar of the button being written in (lib/editor-button.js), above it: where it sits in the column, where it
// goes, and a way to delete it. Its link opens a field, as the format menu's does, and so do Enter in the button's text
// while it has no link and ⌘K.
export default function MenuButton({ editor, isEditingLink, onEditLink }) {
	const menuRef = useRef(null);
	const button = useEditorState({ editor, selector: ({ editor: current }) => readButton(current.state) });
	const options = useMemo(
		() => ({
			placement: "top",
			offset: 8,
			flip: true,
			shift: { padding: 8 },
			// A link field opened while the toolbar was hidden, as the review step's fix does, takes the focus once it shows.
			onShow: () => focusField(menuRef.current?.querySelector("input")),
			onHide: () => onEditLink(false),
		}),
		[onEditLink]
	);
	// Above the button itself, rather than the caret moving along its text.
	const getReference = useCallback(() => {
		const found = findButton(editor.state);
		const element = found && editor.view.nodeDOM(found.pos)?.firstElementChild;
		return element && { getBoundingClientRect: () => element.getBoundingClientRect(), getClientRects: () => [element.getBoundingClientRect()] };
	}, [editor]);

	// As with the format menu, appended to the body: the focus leaving both the editor and the toolbar hides it.
	useEffect(() => {
		function isInside(node) {
			return node instanceof Node && (editor.view.dom.contains(node) || Boolean(menuRef.current?.contains(node)));
		}

		function onFocusOut(event) {
			if (editor.isDestroyed || !isInside(event.target) || isInside(event.relatedTarget)) return;
			editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, "hide"));
		}

		document.addEventListener("focusout", onFocusOut);
		return () => document.removeEventListener("focusout", onFocusOut);
	}, [editor]);

	function change(attrs) {
		editor
			.chain()
			.focus()
			.command(({ tr, state }) => {
				const found = findButton(state);
				if (found) tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...attrs });
				return Boolean(found);
			})
			.run();
	}

	function applyLink(event) {
		event.preventDefault();
		change({ href: normalizeUrl(new FormData(event.currentTarget).get("href")) });
		onEditLink(false);
	}

	function closeLink() {
		onEditLink(false);
		editor.commands.focus();
	}

	function remove() {
		const found = findButton(editor.state);
		if (found) deleteBlock(editor, found.pos);
	}

	return (
		<BubbleMenu
			editor={editor}
			pluginKey={MENU_KEY}
			shouldShow={shouldShowMenu}
			getReferencedVirtualElement={getReference}
			appendTo={getBody}
			options={options}
			className="z-50"
		>
			<div
				ref={menuRef}
				onMouseDown={keepFocus}
				className="flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
			>
				{isEditingLink ? (
					<form onSubmit={applyLink} className="flex items-center gap-0.5">
						<input
							ref={focusField}
							name="href"
							type="text"
							inputMode="url"
							defaultValue={button?.href ?? ""}
							placeholder="Paste a link"
							aria-label="Button link"
							onKeyDown={(event) => event.key === "Escape" && closeLink()}
							autoCapitalize="off"
							autoComplete="off"
							autoCorrect="off"
							spellCheck={false}
							className="h-8 w-60 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
						/>
						<ButtonFormat label="Apply link" type="submit">
							<CornerDownLeft />
						</ButtonFormat>
					</form>
				) : (
					<>
						{ALIGNMENTS.map(({ value, label, icon: Icon }) => (
							<ButtonFormat key={value} label={label} isActive={button?.align === value} onClick={() => change({ align: value })}>
								<Icon />
							</ButtonFormat>
						))}
						<span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
						<ButtonLink href={button?.href} onClick={() => onEditLink(true)} />
						<ButtonFormat label="Delete button" onClick={remove}>
							<Trash2 />
						</ButtonFormat>
					</>
				)}
			</div>
		</BubbleMenu>
	);
}

// Where the button goes, with its site's icon, or a way to add it.
function ButtonLink({ href, onClick }) {
	const isMail = /^mailto:/i.test(href ?? "");
	const host = isButtonLink(href) && !isMail ? getHost(href) : null;
	const text = !isButtonLink(href) ? "Add a link" : isMail ? href.slice("mailto:".length) : formatLinkUrl(href);
	return (
		<button
			type="button"
			onClick={onClick}
			title={isButtonLink(href) ? `Link: ${href}` : "Add a link"}
			className="flex h-8 max-w-40 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground sm:max-w-56"
		>
			{host ? <ImageFavicon domain={host} size={14} /> : isMail ? <Mail className="size-4 shrink-0" /> : <Link className="size-4 shrink-0" />}
			<span className="truncate">{text}</span>
		</button>
	);
}

function readButton(state) {
	const found = findButton(state);
	return found && { href: found.node.attrs.href, align: found.node.attrs.align };
}

function getHost(href) {
	try {
		return new URL(href).hostname;
	} catch {
		return null;
	}
}

function shouldShowMenu({ editor, element, view, state }) {
	if (!editor.isEditable || !findButton(state)) return false;
	return view.hasFocus() || element.contains(document.activeElement);
}

// The editor's card clips its overflow, which would cut the toolbar off at the top of the content.
function getBody() {
	return document.body;
}

// Without scrolling: the toolbar shows where it last was, at first the end of the page, before it's placed above its
// button, which is in view.
function focusField(input) {
	input?.focus({ preventScroll: true });
}

// A press on the toolbar leaves the focus in the button's text, so only the link field takes it.
function keepFocus(event) {
	if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

const MENU_KEY = "buttonMenu";
