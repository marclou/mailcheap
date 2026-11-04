"use client";

import { Suspense, use, useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { Check, ImageUp, Images, Loader2 } from "lucide-react";
import ZoneUpload from "@/components/ZoneUpload";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import { IMAGE_TYPES, IMAGE_TYPE_ERROR, fetchImages, loadImageLibrary, readImageSize, uploadImageFile } from "@/lib/upload-image";
import { useFileDrop } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

// Transparent images sit on a light checkerboard in both themes: emails are white, so a dark logo has to show.
export const CHECKERBOARD = { background: "repeating-conic-gradient(#f4f4f5 0 25%, #ffffff 0 50%) 0 0 / 12px 12px" };
const GRID = "grid grid-cols-3 gap-2 p-4 sm:grid-cols-4";

// onFile: takes a file picked, dropped or pasted in its place, without uploading it.
export default function DialogImagePicker({ open, onOpenChange, onSelect, onFile, currentUrl }) {
	function select(image) {
		onSelect(image);
		onOpenChange(false);
	}

	function take(file) {
		onOpenChange(false);
		onFile(file);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-xl">
				<PickerImage currentUrl={currentUrl} onSelect={select} onFile={onFile && take} />
			</DialogContent>
		</Dialog>
	);
}

// The whole dialog takes drops and pastes, so a file let go next to the zone isn't opened by the browser.
function PickerImage({ currentUrl, onSelect, onFile }) {
	const [library] = useState(loadImageLibrary);
	const [upload, setUpload] = useState(null);
	const { isDragging, dropProps } = useFileDrop({
		accept: IMAGE_TYPES,
		onFile: uploadFile,
		onReject: () => toast.error(IMAGE_TYPE_ERROR),
	});

	useEffect(() => () => upload?.previewUrl && URL.revokeObjectURL(upload.previewUrl), [upload]);

	async function uploadFile(file) {
		if (upload) return;
		if (onFile) return void onFile(file);
		setUpload({ previewUrl: IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : null });
		try {
			onSelect(await uploadImageFile(file));
		} catch (error) {
			toast.error(error.message);
			setUpload(null);
		}
	}

	function paste(event) {
		const [file] = event.clipboardData.files;
		if (!file) return;
		event.preventDefault();
		uploadFile(file);
	}

	return (
		<div {...dropProps} onPaste={paste} className="flex min-w-0 flex-col">
			<DialogHeader className="px-4 pt-4 pb-3">
				<DialogTitle>Choose an image</DialogTitle>
				<DialogDescription>Upload one, or use an image you uploaded before.</DialogDescription>
			</DialogHeader>
			<div className="px-4">
				<ZoneUpload
					icon={ImageUp}
					title="Drop an image here or click to upload"
					hint="PNG, JPEG, GIF or WebP under 4 MB. Pasting works too."
					accept={IMAGE_TYPES}
					isDragging={isDragging}
					isBusy={Boolean(upload)}
					onFile={uploadFile}
					className="h-36"
				>
					{upload && (
						<>
							{upload.previewUrl && (
								<Image src={upload.previewUrl} alt="" fill unoptimized sizes="544px" className="object-contain p-3 opacity-30" />
							)}
							<Loader2 className="relative size-5 animate-spin" />
							<span className="relative text-sm font-medium">Uploading…</span>
						</>
					)}
				</ZoneUpload>
			</div>
			<Suspense fallback={<SkeletonLibrary />}>
				<GridLibrary request={library} currentUrl={currentUrl} isDisabled={Boolean(upload)} onSelect={onSelect} />
			</Suspense>
		</div>
	);
}

function GridLibrary({ request, currentUrl, isDisabled, onSelect }) {
	const firstPage = use(request);
	const [more, setMore] = useState({ images: [], nextCursor: firstPage.nextCursor });
	const [isLoadingMore, startLoadingMore] = useTransition();
	const images = [...firstPage.images, ...more.images];

	function loadMore() {
		startLoadingMore(async () => {
			try {
				const page = await fetchImages(more.nextCursor);
				setMore((current) => ({ images: [...current.images, ...page.images], nextCursor: page.nextCursor }));
			} catch (error) {
				toast.error(error.message);
			}
		});
	}

	// The tile's picture is usually loaded already, which gives the editor its size without another download.
	async function pick(event, image) {
		const picture = event.currentTarget.querySelector("img");
		const size = picture?.naturalWidth
			? { width: picture.naturalWidth, height: picture.naturalHeight }
			: await readImageSize(image.url);
		onSelect({ url: image.url, ...size });
	}

	if (firstPage.error) return <NoteLibrary title="Couldn't load your images" text={firstPage.error} />;
	if (images.length === 0) {
		return <NoteLibrary title="No images yet" text="The images you upload show here, ready to use again." />;
	}

	return (
		<section className="mt-4 border-t border-border/60 animate-fade-in">
			<h3 className="px-4 pt-3 text-xs font-medium text-muted-foreground">Uploaded before</h3>
			<div className="max-h-[min(20rem,45dvh)] overflow-y-auto overscroll-contain">
				<ul className={GRID}>
					{images.map((image) => {
						const isCurrent = image.url === currentUrl;
						return (
							<li key={image.id}>
								<button
									type="button"
									disabled={isDisabled}
									aria-current={isCurrent || undefined}
									aria-label={`Image uploaded ${formatDate(image.createdAt)}`}
									onClick={(event) => pick(event, image)}
									style={CHECKERBOARD}
									className={cn(
										"group relative block aspect-square w-full overflow-hidden rounded-lg shadow-border outline-none transition-[box-shadow,scale,opacity] duration-150 ease-out hover:shadow-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-50",
										isCurrent && "ring-2 ring-foreground"
									)}
								>
									<Image
										src={image.url}
										alt=""
										fill
										unoptimized
										sizes="128px"
										loading="lazy"
										className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
									/>
									{isCurrent && (
										<span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-sm">
											<Check className="size-3" strokeWidth={3} />
										</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
				{more.nextCursor && (
					<div className="flex justify-center pb-4">
						<Button type="button" variant="ghost" size="sm" onClick={loadMore} disabled={isLoadingMore}>
							{isLoadingMore && <Loader2 data-icon="inline-start" className="animate-spin" />}
							Show more
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}

function SkeletonLibrary() {
	return (
		<div className="mt-4 border-t border-border/60">
			<Skeleton className="mx-4 mt-3.5 h-3 w-24" />
			<div className={GRID}>
				{Array.from({ length: 8 }, (_, index) => (
					<Skeleton key={index} className="aspect-square rounded-lg" />
				))}
			</div>
		</div>
	);
}

function NoteLibrary({ title, text }) {
	return (
		<div className="mt-4 flex flex-col items-center gap-1 border-t border-border/60 px-4 py-8 text-center animate-fade-in">
			<Images className="mb-1 size-5 text-muted-foreground" />
			<p className="text-sm font-medium">{title}</p>
			<p className="max-w-xs text-xs text-muted-foreground">{text}</p>
		</div>
	);
}
