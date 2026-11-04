// A picture cut to a square before it's uploaded (components/DialogCropImage.jsx). A crop is the square's side and its
// top left corner in the picture's own pixels, at a zoom from 1, the whole short side, to MAX_ZOOM.
export const MAX_ZOOM = 4;
// Bylines show pictures at 24px and pages at up to 128px: 400px stays sharp on every screen, and light in every email.
const MAX_SIDE = 400;
const JPEG_QUALITY = 0.88;

export function isSquare({ width, height }) {
	return width > 0 && width === height;
}

// The middle of the picture, as large as it goes.
export function getInitialCrop({ width, height }) {
	const side = Math.min(width, height);
	return { zoom: 1, side, left: (width - side) / 2, top: (height - side) / 2 };
}

// Around the square's center, which stays where it was unless the picture's edge is in the way.
export function zoomCrop(crop, zoom, size) {
	const next = Math.min(MAX_ZOOM, Math.max(1, Number(zoom) || 1));
	const side = Math.min(size.width, size.height) / next;
	return placeCrop({ zoom: next, side, left: crop.left + (crop.side - side) / 2, top: crop.top + (crop.side - side) / 2 }, size);
}

// dx and dy: in the picture's pixels. The square never goes past its edges.
export function moveCrop(crop, dx, dy, size) {
	return placeCrop({ ...crop, left: crop.left + dx, top: crop.top + dy }, size);
}

function placeCrop(crop, { width, height }) {
	return { ...crop, left: clamp(crop.left, 0, width - crop.side), top: clamp(crop.top, 0, height - crop.side) };
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

// Where the picture sits in the square that shows the crop, in shares of its side, so it needs no measuring.
export function getCropStyle(crop, { width, height }) {
	return {
		width: `${(width / crop.side) * 100}%`,
		height: `${(height / crop.side) * 100}%`,
		left: `${(-crop.left / crop.side) * 100}%`,
		top: `${(-crop.top / crop.side) * 100}%`,
	};
}

// The square as a file of its own, as big as the picture has pixels for up to MAX_SIDE: a JPEG, or a PNG when it has
// transparent pixels. image: the img element the crop was made on.
export async function cropToFile(image, crop, name) {
	const side = Math.max(1, Math.min(MAX_SIDE, Math.round(crop.side)));
	const canvas = document.createElement("canvas");
	canvas.width = side;
	canvas.height = side;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	context.imageSmoothingQuality = "high";
	context.drawImage(image, crop.left, crop.top, crop.side, crop.side, 0, 0, side, side);
	const type = isOpaque(context, side) ? "image/jpeg" : "image/png";
	const blob = await new Promise((resolve, reject) => {
		canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Couldn't crop the image"))), type, JPEG_QUALITY);
	});
	const base = String(name ?? "").replace(/\.[^.]+$/, "") || "picture";
	return new File([blob], `${base}.${type === "image/jpeg" ? "jpg" : "png"}`, { type });
}

function isOpaque(context, side) {
	const { data } = context.getImageData(0, 0, side, side);
	for (let index = 3; index < data.length; index += 4) {
		if (data[index] < 255) return false;
	}
	return true;
}
