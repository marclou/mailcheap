"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { CHECKERBOARD } from "@/components/DialogImagePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_ZOOM, cropToFile, getCropStyle, getInitialCrop, moveCrop, zoomCrop } from "@/lib/crop-image";
import { cn } from "@/lib/utils";

const ZOOM_STEP = 0.25;
// A key press moves the picture by this share of the square's side, the way a drag would.
const MOVE_STEP = 0.05;
const MOVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// A picture cut to a square before it's uploaded (lib/crop-image.js): dragged into place and zoomed, with the mouse, a
// finger or the keys. source: { src, name }, an address the page can draw from, its own or a file's. isRound: a person's
// photo, shown in a circle. onCrop gets the square as a file and throws when it couldn't be used.
export default function DialogCropImage({ source, label, isRound, onCancel, onCrop }) {
	return (
		<Dialog open={Boolean(source)} onOpenChange={(isOpen) => !isOpen && onCancel()}>
			<DialogContent className="sm:max-w-sm">
				{source && <FormCrop key={source.src} source={source} label={label} isRound={isRound} onCancel={onCancel} onCrop={onCrop} />}
			</DialogContent>
		</Dialog>
	);
}

function FormCrop({ source, label, isRound, onCancel, onCrop }) {
	const stageRef = useRef(null);
	const imageRef = useRef(null);
	const dragRef = useRef(null);
	const [size, setSize] = useState(null);
	const [crop, setCrop] = useState(null);
	const [error, setError] = useState(null);
	const [isSaving, setIsSaving] = useState(false);

	// Not React's onWheel, which can't keep the page from scrolling.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage || !size) return;
		function wheel(event) {
			event.preventDefault();
			setCrop((current) => zoomCrop(current, current.zoom * Math.exp(-event.deltaY / 300), size));
		}
		stage.addEventListener("wheel", wheel, { passive: false });
		return () => stage.removeEventListener("wheel", wheel);
	}, [size]);

	function load(event) {
		const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
		setSize(next);
		setCrop(getInitialCrop(next));
	}

	function zoom(value) {
		setCrop((current) => zoomCrop(current, value, size));
	}

	// The picture's pixels under one of the stage's.
	function getScale(current) {
		return current.side / (stageRef.current?.clientWidth || 1);
	}

	function startDrag(event) {
		if (!crop) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { x: event.clientX, y: event.clientY };
	}

	function drag(event) {
		if (!dragRef.current) return;
		const dx = event.clientX - dragRef.current.x;
		const dy = event.clientY - dragRef.current.y;
		dragRef.current = { x: event.clientX, y: event.clientY };
		setCrop((current) => moveCrop(current, -dx * getScale(current), -dy * getScale(current), size));
	}

	function endDrag() {
		dragRef.current = null;
	}

	function press(event) {
		if (!crop) return;
		const move = MOVES[event.key];
		if (move) {
			event.preventDefault();
			setCrop((current) => moveCrop(current, -move[0] * current.side * MOVE_STEP, -move[1] * current.side * MOVE_STEP, size));
		} else if (event.key === "+" || event.key === "=") {
			zoom(crop.zoom + ZOOM_STEP);
		} else if (event.key === "-") {
			zoom(crop.zoom - ZOOM_STEP);
		}
	}

	async function save() {
		setIsSaving(true);
		setError(null);
		try {
			await onCrop(await cropToFile(imageRef.current, crop, source.name));
		} catch (problem) {
			setError(problem.message);
			setIsSaving(false);
		}
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>Crop the {label}</DialogTitle>
				<DialogDescription>Drag it into place and zoom until it fits the square.</DialogDescription>
			</DialogHeader>
			<div
				ref={stageRef}
				role="group"
				tabIndex={0}
				aria-label="Picture: drag it, or move it with the arrow keys and zoom with + and -"
				onPointerDown={startDrag}
				onPointerMove={drag}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={press}
				style={CHECKERBOARD}
				className={cn(
					"relative aspect-square w-full touch-none overflow-hidden rounded-lg outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
					crop ? "cursor-grab active:cursor-grabbing" : "grid place-items-center"
				)}
			>
				{/* eslint-disable-next-line @next/next/no-img-element -- drawn on a canvas once it's cropped */}
				<img
					ref={imageRef}
					src={source.src}
					alt=""
					draggable={false}
					onLoad={load}
					onError={() => setError("Couldn't open this image. Try another one.")}
					style={crop ? getCropStyle(crop, size) : undefined}
					className={cn("pointer-events-none absolute max-w-none", !crop && "invisible")}
				/>
				{!crop && !error && <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />}
				{crop && (
					<span
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute inset-0 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] ring-1 ring-white/70 ring-inset",
							isRound ? "rounded-full" : "rounded-lg"
						)}
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Zoom out"
					disabled={!crop || crop.zoom <= 1}
					onClick={() => zoom(crop.zoom - ZOOM_STEP)}
				>
					<ZoomOut />
				</Button>
				<input
					type="range"
					min={1}
					max={MAX_ZOOM}
					step={0.01}
					value={crop?.zoom ?? 1}
					disabled={!crop}
					aria-label="Zoom"
					onChange={(event) => zoom(Number(event.target.value))}
					className="h-1.5 flex-1 cursor-pointer accent-foreground disabled:cursor-default disabled:opacity-50"
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Zoom in"
					disabled={!crop || crop.zoom >= MAX_ZOOM}
					onClick={() => zoom(crop.zoom + ZOOM_STEP)}
				>
					<ZoomIn />
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-pretty text-destructive">
					{error}
				</p>
			)}
			<DialogFooter>
				<Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
					Cancel
				</Button>
				<Button type="button" disabled={!crop || isSaving} onClick={save} className="min-w-28">
					{isSaving ? <Loader2 className="animate-spin" /> : `Use ${label}`}
				</Button>
			</DialogFooter>
		</>
	);
}
