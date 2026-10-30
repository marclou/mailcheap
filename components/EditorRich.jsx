"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import FileHandler from "@tiptap/extension-file-handler";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { HtmlBlock, editHtmlBlock } from "@/components/BlockHtml";
import { Section, SectionsContext } from "@/components/BlockSection";
import DialogContactFields from "@/components/DialogContactFields";
import DialogImagePicker from "@/components/DialogImagePicker";
import GutterProblems from "@/components/GutterProblems";
import MenuButton from "@/components/MenuButton";
import MenuFormat from "@/components/MenuFormat";
import MenuImage from "@/components/MenuImage";
import { MergeTagSuggestion, SlashCommand } from "@/components/MenuSlash";
import ProviderContactOptions from "@/components/ProviderContactOptions";
import TooltipMergeTag from "@/components/TooltipMergeTag";
import { isButtonLink } from "@/lib/buttons";
import { BlockHandle } from "@/lib/editor-block-handle";
import { ButtonBlock, findButton } from "@/lib/editor-button";
import { Callout } from "@/lib/editor-callout";
import { findWords } from "@/lib/editor-find";
import { ImageAligned } from "@/lib/editor-image";
import { MergeTags, setEditorFields } from "@/lib/editor-merge-tags";
import { Problems, findDocProblems, findProblem, revealProblem, setProblemSegments } from "@/lib/editor-problems";
import { UndoDelete } from "@/lib/editor-undo-delete";
import { fieldTag } from "@/lib/merge-tags";
import { toast } from "@/lib/toast";
import { IMAGE_TYPES, IMAGE_TYPE_ERROR, getDisplaySize, prepareImage, uploadImage } from "@/lib/upload-image";
import { useFileDropGuard } from "@/lib/use-file-drop";

const MIN_HEIGHT = "min-h-[560px]";
const NO_FIELDS = [];
const NO_TAGS = [];

// contactFields: the account's fields, whose tags the editor draws as placeholders and its slash menu inserts. Add a
// field, in the slash menu, opens them to add one, which goes where the slash was: onContactFieldsChange(fields) gives
// them back as they are after one is added or deleted there.
// newsletter: whose email design HTML blocks preview in, and whose button colors and corners buttons show.
// ref: reveal({ id, message, words }), which goes to a review step's warning or check (lib/campaign-steps.js), else to
// the first place the issue has the words, and says whether it found it. gutterRef: the positioned element around the
// editor's card, whose problems' dots sit beside it in the page's margin (components/GutterProblems.jsx). sections: what
// the issue's sections pick from (components/BlockSection.jsx), its segments a section without one is marked by.
export default function EditorRich({
	ref,
	gutterRef,
	content,
	onChange,
	contactFields = NO_FIELDS,
	onContactFieldsChange = () => {},
	newsletter = null,
	sections = null,
}) {
	const [isEditingLink, setIsEditingLink] = useState(false);
	const [isEditingButtonLink, setIsEditingButtonLink] = useState(false);
	const [isPickingImage, setIsPickingImage] = useState(false);
	const [isAddingField, setIsAddingField] = useState(false);
	// The block whose dot says what it's about, once brought into view.
	const [pinned, setPinned] = useState(null);
	const unpin = useCallback(() => setPinned(null), []);
	const segments = sections?.segments;
	const segmentIds = useMemo(() => (segments ?? []).map(({ id }) => id), [segments]);
	const editor = useEditor({
		immediatelyRender: false,
		content,
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
				codeBlock: false,
				link: { openOnClick: false, defaultProtocol: "https" },
				dropcursor: { color: "var(--ring)", width: 2 },
			}),
			ImageAligned.configure({
				resize: {
					enabled: true,
					directions: ["left", "right"],
					minWidth: 80,
					minHeight: 40,
					alwaysPreserveAspectRatio: true,
				},
			}),
			Callout,
			ButtonBlock.configure({ newsletter, onEditLink: () => setIsEditingButtonLink(true) }),
			HtmlBlock.configure({ newsletter }),
			Section,
			BlockHandle,
			UndoDelete,
			MergeTags.configure({ contactFields }),
			Problems.configure({ contactFields }),
			Placeholder.configure({
				placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press / for commands"),
			}),
			FileHandler.configure({
				allowedMimeTypes: IMAGE_TYPES,
				consumePasteEvent: true,
				onDrop: (current, files, position) => insertImages(current, files, position),
				onPaste: (current, files) => insertImages(current, files),
			}),
			SlashCommand.configure({ onPickImage: () => setIsPickingImage(true), onAddField: () => setIsAddingField(true), contactFields }),
			MergeTagSuggestion.configure({ contactFields }),
		],
		editorProps: {
			// With a mouse, the left padding holds the blocks' drag handle (lib/editor-block-handle.js).
			attributes: { class: `prose-issue ${MIN_HEIGHT} px-5 py-5 outline-none [@media(pointer:fine)]:pl-12`, "aria-label": "Content" },
			// In a button, ⌘K opens the button's own link (lib/editor-button.js).
			handleKeyDown: (view, event) => {
				const isLinkShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
				if (!isLinkShortcut || view.state.selection.empty || findButton(view.state)) return false;
				setIsEditingLink(true);
				return true;
			},
			// The file handler takes pictures and passes on any other file, which would vanish without a word.
			handleDrop: (_view, event) => {
				const files = [...(event.dataTransfer?.files ?? [])];
				if (files.length === 0 || files.some((file) => IMAGE_TYPES.includes(file.type))) return false;
				event.preventDefault();
				toast.error(IMAGE_TYPE_ERROR);
				return true;
			},
		},
		onUpdate: ({ editor: current }) => onChange(current.getHTML()),
	});
	useFileDropGuard();

	// A button whose link is missing or looks broken opens its link field, an HTML block its HTML, which says what's wrong
	// under it, and words get their dot's message beside them.
	function reveal(found) {
		if (!revealProblem(editor, found)) return false;
		const node = editor.state.doc.nodeAt(found.pos);
		if (node.type.name === "htmlBlock") editHtmlBlock(editor.view, found.pos);
		else if (node.type.name === "button") setIsEditingButtonLink(found.problem.id === "links" || !isButtonLink(node.attrs.href));
		else setPinned(found.pos);
		return true;
	}

	useImperativeHandle(ref, () => ({
		reveal: ({ id, message, words }) => {
			if (!editor || editor.isDestroyed) return false;
			const found = findProblem(findDocProblems(editor.state.doc, contactFields, segmentIds), { id, message });
			return found ? reveal(found) : Boolean(words && selectWords(editor, words));
		},
	}));

	useEffect(() => {
		if (editor && !editor.isDestroyed) setProblemSegments(editor, segmentIds);
	}, [editor, segmentIds]);

	useEffect(() => {
		if (editor && !editor.isDestroyed) setEditorFields(editor, contactFields);
	}, [editor, contactFields]);

	if (!editor) return <div className={MIN_HEIGHT} />;

	return (
		<SectionsContext value={sections}>
			<EditorContent editor={editor} className="relative" />
			<GutterProblems
				editor={editor}
				gutterRef={gutterRef}
				pinned={pinned}
				onUnpin={unpin}
				onReveal={({ pos, problems }) => reveal({ pos, problem: problems[0] })}
			/>
			<MenuFormat editor={editor} isEditingLink={isEditingLink} onEditLink={setIsEditingLink} />
			<MenuButton editor={editor} isEditingLink={isEditingButtonLink} onEditLink={setIsEditingButtonLink} />
			<MenuImage editor={editor} />
			<TooltipMergeTag editor={editor} contactFields={contactFields} />
			<DialogImagePicker
				open={isPickingImage}
				onOpenChange={setIsPickingImage}
				onSelect={(image) => insertImage(editor, image)}
			/>
			<ProviderContactOptions fields={contactFields} tags={NO_TAGS}>
				<DialogContactFields
					isOpen={isAddingField}
					onOpenChange={setIsAddingField}
					onAdded={(field) => {
						setIsAddingField(false);
						onContactFieldsChange([...contactFields, field]);
						editor.chain().focus().insertContent(fieldTag(field.key)).run();
					}}
					onDeleted={(key) => onContactFieldsChange(contactFields.filter((field) => field.key !== key))}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						editor.commands.focus();
					}}
				/>
			</ProviderContactOptions>
		</SectionsContext>
	);
}

// Centered on the screen, where the editor's own scrolling would leave the words at its edge, under the page's header.
function selectWords(editor, words) {
	const found = findWords(editor.state.doc, words);
	if (!found || editor.isDestroyed) return false;
	editor.chain().focus(null, { scrollIntoView: false }).setTextSelection(found).run();
	const { node } = editor.view.domAtPos(found.from);
	(node.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.scrollIntoView({ block: "center" });
	return true;
}

// Where the slash command was typed: the editor keeps its selection while the picker has focus.
function insertImage(editor, { url, width, height }) {
	if (editor.isDestroyed) return;
	const size = width && height ? getDisplaySize({ width, height }) : {};
	editor.chain().focus().insertContent({ type: "image", attrs: { src: url, alt: "", ...size } }).run();
}

// Each picture shows right away from the local file and switches to its CDN URL once uploaded. The
// switch stays out of the undo history, so undo never brings back the local preview.
async function insertImages(editor, files, position) {
	for (const file of files) {
		let image;
		try {
			image = await prepareImage(file);
		} catch (error) {
			toast.error(error.message);
			continue;
		}
		if (editor.isDestroyed) return;

		const previewUrl = URL.createObjectURL(image.file);
		const node = { type: "image", attrs: { src: previewUrl, alt: "", ...getDisplaySize(image) } };
		const chain = editor.chain().focus();
		(position === undefined ? chain.insertContent(node) : chain.insertContentAt(position, node)).run();
		position = undefined;

		uploadImage(image.file)
			.then((url) => updateImages(editor, previewUrl, (tr, pos, attrs) => tr.setNodeMarkup(pos, undefined, { ...attrs, src: url })))
			.catch((error) => {
				updateImages(editor, previewUrl, (tr, pos, _attrs, size) => tr.delete(pos, pos + size));
				toast.error(error.message);
			});
	}
}

function updateImages(editor, src, change) {
	if (editor.isDestroyed) return;
	const matches = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "image" && node.attrs.src === src) matches.push({ node, pos });
	});
	if (!matches.length) return;
	const { tr } = editor.state;
	for (const { node, pos } of matches.reverse()) change(tr, pos, node.attrs, node.nodeSize);
	editor.view.dispatch(tr.setMeta("addToHistory", false));
}
