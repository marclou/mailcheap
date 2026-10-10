"use client";

import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { toast } from "sonner";
import DialogSparkLoopCard from "@/components/DialogSparkLoopCard";
import MenuFormat from "@/components/MenuFormat";
import { SlashCommand } from "@/components/MenuSlash";
import { Callout } from "@/lib/editor-callout";
import { SparkLoopCard } from "@/lib/editor-sparkloop-card";
import { IMAGE_TYPES, getDisplaySize, prepareImage, uploadImage } from "@/lib/upload-image";

const MIN_HEIGHT = "min-h-[560px]";

// hasCards: SparkLoop offers and recommendations can be added (lib/sparkloop-content.js decides when).
export default function EditorRich({ content, onChange, newsletterId, hasCards = false }) {
	const [isEditingLink, setIsEditingLink] = useState(false);
	// A SparkLoop card being added ({ kind }) or edited ({ kind, attrs, getPos }).
	const [card, setCard] = useState(null);
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
			Image.configure({
				resize: {
					enabled: true,
					directions: ["left", "right"],
					minWidth: 80,
					minHeight: 40,
					alwaysPreserveAspectRatio: true,
				},
			}),
			Callout,
			SparkLoopCard.configure({ onEdit: ({ attrs, getPos }) => setCard({ kind: attrs.kind, attrs, getPos }) }),
			Placeholder.configure({
				placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press / for commands"),
			}),
			FileHandler.configure({
				allowedMimeTypes: IMAGE_TYPES,
				consumePasteEvent: true,
				onDrop: (current, files, position) => insertImages(current, files, position),
				onPaste: (current, files) => insertImages(current, files),
			}),
			SlashCommand.configure({ onPickImage: pickImages, onPickCard: (_editor, kind) => setCard({ kind }), hasCards }),
		],
		editorProps: {
			attributes: { class: `prose-issue ${MIN_HEIGHT} px-5 py-5 outline-none`, "aria-label": "Content" },
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
			<EditorContent editor={editor} />
			<MenuFormat editor={editor} isEditingLink={isEditingLink} onEditLink={setIsEditingLink} />
			<DialogSparkLoopCard
				request={card}
				newsletterId={newsletterId}
				onOpenChange={(isOpen) => !isOpen && setCard(null)}
				onSave={(attrs) => saveCard(editor, card, attrs)}
			/>
		</>
	);
}

// An edited card keeps its place and its SparkLoop link; a new one goes where the slash command was.
function saveCard(editor, request, attrs) {
	if (!request?.getPos) {
		editor.chain().focus().insertContent({ type: "sparkloopCard", attrs }).run();
		return;
	}
	const position = request.getPos();
	if (typeof position !== "number") return;
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.setNodeMarkup(position, undefined, { ...request.attrs, ...attrs });
			return true;
		})
		.run();
}

// Safari only opens pickers for inputs in the document, so this one joins it until a choice is made.
function pickImages(editor) {
	const input = Object.assign(document.createElement("input"), {
		type: "file",
		accept: IMAGE_TYPES.join(","),
		multiple: true,
		hidden: true,
	});
	input.addEventListener("change", () => insertImages(editor, [...input.files]));
	for (const event of ["change", "cancel"]) input.addEventListener(event, () => input.remove());
	document.body.append(input);
	input.click();
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
