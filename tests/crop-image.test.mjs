import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ZOOM, getCropStyle, getInitialCrop, isSquare, moveCrop, zoomCrop } from "../lib/crop-image.js";

// A picture cut to a square before it's uploaded (components/DialogCropImage.jsx): its middle at first, zoomed around
// the square's center, and never past the picture's edges.
const landscape = { width: 1200, height: 800 };

test("a square picture needs no crop, and another starts on its middle, as large as it goes", () => {
	assert.equal(isSquare({ width: 400, height: 400 }), true);
	assert.equal(isSquare(landscape), false);
	assert.equal(isSquare({ width: 0, height: 0 }), false, "an image that didn't load");
	assert.deepEqual(getInitialCrop(landscape), { zoom: 1, side: 800, left: 200, top: 0 });
	assert.deepEqual(getInitialCrop({ width: 600, height: 900 }), { zoom: 1, side: 600, left: 0, top: 150 });
});

test("zooming keeps the square's center, from the whole short side to a quarter of it", () => {
	const zoomed = zoomCrop(getInitialCrop(landscape), 2, landscape);
	assert.deepEqual(zoomed, { zoom: 2, side: 400, left: 400, top: 200 });
	assert.equal(zoomCrop(zoomed, 10, landscape).zoom, MAX_ZOOM);
	assert.deepEqual(zoomCrop(zoomed, 0.5, landscape), getInitialCrop(landscape), "never wider than the picture");
	const corner = moveCrop(zoomed, -1000, -1000, landscape);
	assert.deepEqual(zoomCrop(corner, 1, landscape), { zoom: 1, side: 800, left: 0, top: 0 }, "an edge in the way moves the center");
});

test("moving stops at the picture's edges", () => {
	const zoomed = zoomCrop(getInitialCrop(landscape), 2, landscape);
	assert.deepEqual(moveCrop(zoomed, 100, -50, landscape), { ...zoomed, left: 500, top: 150 });
	assert.deepEqual(moveCrop(zoomed, 5000, 5000, landscape), { ...zoomed, left: 800, top: 400 });
	assert.deepEqual(moveCrop(zoomed, -5000, -5000, landscape), { ...zoomed, left: 0, top: 0 });
});

test("the picture sits in the square in shares of its side, so the square can be any size", () => {
	assert.deepEqual(getCropStyle(getInitialCrop(landscape), landscape), { width: "150%", height: "100%", left: "-25%", top: "0%" });
	assert.deepEqual(getCropStyle({ zoom: 2, side: 400, left: 400, top: 200 }, landscape), {
		width: "300%",
		height: "200%",
		left: "-100%",
		top: "-50%",
	});
});
