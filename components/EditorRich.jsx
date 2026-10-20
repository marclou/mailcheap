"use client";

import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import FileHandler from "@tiptap/extension-file-handler";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import DialogImagePicker from "@/components/DialogImagePicker";
import MenuFormat from "@/components/MenuFormat";
import MenuImage from "@/components/MenuImage";
import { SlashCommand } from "@/components/MenuSlash";
import { BlockHandle } from "@/lib/editor-block-handle";
import { Callout } from "@/lib/editor-callout";
import { ImageAligned } from "@/lib/editor-image";
import { MergeTags } from "@/lib/editor-merge-tags";
import { toast } from "@/lib/toast";
import { IMAGE_TYPES, getDisplaySize, prepareImage, uploadImage } from "@/lib/upload-image";

const MIN_HEIGHT = "min-h-[560px]";

export default function EditorRich({ content, onChange }) {
	const [isEditingLink, setIsEditingLink] = useState(false);
	const [isPickingImage, setIsPickingImage] = useState(false);
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
			BlockHandle,
			MergeTags,
			Placeholder.configure({
				placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press / for commands"),
			}),
			FileHandler.configure({
				allowedMimeTypes: IMAGE_TYPES,
				consumePasteEvent: true,
				onDrop: (current, files, position) => insertImages(current, files, position),
				onPaste: (current, files) => insertImages(current, files),
			}),
			SlashCommand.configure({ onPickImage: () => setIsPickingImage(true) }),
		],
		editorProps: {
			// With a mouse, the left padding holds the blocks' drag handle (lib/editor-block-handle.js).
			attributes: { class: `prose-issue ${MIN_HEIGHT} px-5 py-5 outline-none [@media(pointer:fine)]:pl-12`, "aria-label": "Content" },
			handleKeyDown: (view, event) => {
				const isLinkShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
				if (!isLinkShortcut || view.state.selection.empty) return false;
				setIsEditingLink(true);
				return true;
			},
		},
		onUpdate: ({ editor: current }) => onChange(current.getHTML()),
	});

	if (!editor) return <div className={MIN_HEIGHT} />;

	return (
		<>
			<EditorContent editor={editor} className="relative" />
			<MenuFormat editor={editor} isEditingLink={isEditingLink} onEditLink={setIsEditingLink} />
			<MenuImage editor={editor} />
			<DialogImagePicker
				open={isPickingImage}
				onOpenChange={setIsPickingImage}
				onSelect={(image) => insertImage(editor, image)}
			/>
		</>
	);
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
