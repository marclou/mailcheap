"use client";

import { useState } from "react";
import Image, { getImageProps } from "next/image";
import { ImagePlus, Loader2 } from "lucide-react";
import DialogCropImage from "@/components/DialogCropImage";
import DialogImagePicker, { CHECKERBOARD } from "@/components/DialogImagePicker";
import { Button } from "@/components/ui/button";
import { isSquare } from "@/lib/crop-image";
import { toast } from "@/lib/toast";
import { IMAGE_TYPES, IMAGE_TYPE_ERROR, readImageSize, uploadImageFile } from "@/lib/upload-image";
import { useFileDrop } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

// An image setting: drop a file on it, or open the picker to upload one or reuse an earlier upload. The URL
// goes with the form under name. isRound: a person's photo, maybe Google's, which can fail to load with a referrer.
// isCropped: it has to be square, so a picture that isn't is cropped first (components/DialogCropImage.jsx).
export default function InputImage({ name, defaultValue, label, isRound, isCropped = false, onChange }) {
	const [url, setUrl] = useState(defaultValue ?? "");
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [cropSource, setCropSource] = useState(null);
	const { isDragging, dropProps } = useFileDrop({
		accept: IMAGE_TYPES,
		onFile: isCropped ? cropFile : upload,
		onReject: () => toast.error(IMAGE_TYPE_ERROR),
	});

	function update(value) {
		setUrl(value);
		onChange?.(value);
	}

	async function upload(file) {
		if (isUploading) return;
		setIsUploading(true);
		try {
			update((await uploadImageFile(file)).url);
		} catch (error) {
			toast.error(error.message);
		} finally {
			setIsUploading(false);
		}
	}

	async function cropFile(file) {
		if (isUploading) return;
		if (!IMAGE_TYPES.includes(file?.type)) return void toast.error(IMAGE_TYPE_ERROR);
		const src = URL.createObjectURL(file);
		if (!isSquare(await readImageSize(src))) return setCropSource({ src, name: file.name, isOwn: true });
		URL.revokeObjectURL(src);
		upload(file);
	}

	// An upload from before is drawn through MailCheap's own address (next/image), which a canvas can read. One the image
	// optimizer doesn't take is used as it is.
	function select(image) {
		if (!isCropped || isSquare(image)) return update(image.url);
		try {
			const { src } = getImageProps({ src: image.url, alt: "", width: 1080, height: 1080 }).props;
			setCropSource({ src, name: new URL(image.url, window.location.href).pathname.split("/").pop() });
		} catch {
			update(image.url);
		}
	}

	function closeCrop() {
		if (cropSource?.isOwn) URL.revokeObjectURL(cropSource.src);
		setCropSource(null);
	}

	async function applyCrop(file) {
		const { url: cropped } = await uploadImageFile(file);
		update(cropped);
		closeCrop();
	}

	return (
		<span
			{...dropProps}
			className={cn("-m-1.5 flex items-center gap-3 rounded-xl p-1.5 transition-colors duration-150", isDragging && "bg-muted")}
		>
			<button
				type="button"
				disabled={isUploading}
				aria-label={`${url ? "Change" : "Add"} ${label}`}
				onClick={() => setIsPickerOpen(true)}
				style={url ? CHECKERBOARD : undefined}
				className={cn(
					"group relative grid size-14 shrink-0 place-items-center overflow-hidden bg-muted shadow-border outline-none transition-[box-shadow,scale] duration-150 ease-out hover:shadow-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96]",
					isRound ? "rounded-full" : "rounded-lg",
					isDragging && "ring-2 ring-foreground/30"
				)}
			>
				{url ? (
					<Image src={url} alt="" fill unoptimized referrerPolicy="no-referrer" sizes="56px" className="object-cover" />
				) : (
					<ImagePlus className="size-5 text-muted-foreground transition-transform duration-200 ease-out group-hover:scale-110" />
				)}
				{isUploading && (
					<span className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[2px]">
						<Loader2 className="size-4 animate-spin" />
					</span>
				)}
			</button>
			<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
				<Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => setIsPickerOpen(true)}>
					{url ? "Change" : "Choose"}
				</Button>
				{url ? (
					<Button type="button" variant="ghost" size="sm" disabled={isUploading} onClick={() => update("")}>
						Remove
					</Button>
				) : (
					<span className="text-xs text-muted-foreground">{isDragging ? "Drop to upload" : "or drop a file here"}</span>
				)}
			</span>
			<input type="hidden" name={name} value={url} />
			<DialogImagePicker
				open={isPickerOpen}
				onOpenChange={setIsPickerOpen}
				currentUrl={url}
				onSelect={select}
				onFile={isCropped ? cropFile : undefined}
			/>
			<DialogCropImage source={cropSource} label={label} isRound={isRound} onCancel={closeCrop} onCrop={applyCrop} />
		</span>
	);
}
