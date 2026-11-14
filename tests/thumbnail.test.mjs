import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRate } from "../lib/format.js";
import { firstImageUrl, isOptimizableImage } from "../lib/thumbnail.js";

test("only local and Blob pictures go through Next's resizer", () => {
	assert.equal(isOptimizableImage("/authors/jane.jpg"), true);
	assert.equal(isOptimizableImage("https://abc123.public.blob.vercel-storage.com/uploads/a-x.webp"), true);
	assert.equal(isOptimizableImage("https://images.example.com/uploads/a.png"), false);
	assert.equal(isOptimizableImage("https://mailcheap.example.com/archive/weekly/og?p=x"), false);
	assert.equal(isOptimizableImage("https://evil.test/x.public.blob.vercel-storage.com/a.png"), false);
	assert.equal(isOptimizableImage("https://b0f3a91c24d.blob.upstash.io/accounts/a/images/cover-3xK9mBqR.png"), true);
	assert.equal(isOptimizableImage("https://evil.test/x.blob.upstash.io/a.png"), false);
	assert.equal(isOptimizableImage("https://blob.upstash.io.evil.test/a.png"), false);
});

test("pictures on the images CDN go through it too, once IMAGES_CDN_URL names it", () => {
	const env = { IMAGES_CDN_URL: "https://cdn.example.com" };
	assert.equal(isOptimizableImage("https://cdn.example.com/accounts/a/images/cover-0123456789abcdef.png", env), true);
	assert.equal(isOptimizableImage("https://cdn.example.com.evil.test/accounts/a.png", env), false);
	assert.equal(isOptimizableImage("https://images.example.com/accounts/a.png", env), false);
	assert.equal(isOptimizableImage("https://cdn.example.com/accounts/a.png", {}), false);
});

test("the first real image of an issue becomes its thumbnail", () => {
	const html = `
		<img src="https://cdn.example.com/open-pixel.gif" width="1" height="1">
		<img src="https://cdn.example.com/avatar.png" width="40">
		<img src="https://cdn.example.com/banner.png" width="600">
		<img src="https://cdn.example.com/second.png">`;
	assert.equal(firstImageUrl({ format: "html", html }), "https://cdn.example.com/banner.png");
	assert.equal(
		firstImageUrl({ format: "markdown", markdown: "Hi\n\n![Chart](https://cdn.example.com/chart.png)" }),
		"https://cdn.example.com/chart.png"
	);
	assert.equal(firstImageUrl({ format: "markdown", markdown: "![x](http://insecure.example/a.png)" }), null);
	assert.equal(firstImageUrl({ format: "html", html: "" }), null);
});

test("rates with a missing count are empty instead of NaN", () => {
	assert.equal(formatRate(undefined, 1297, 2), null);
	assert.equal(formatRate(0, 1297, 2), "0.00%");
	assert.equal(formatRate(6, 1297, 2), "0.46%");
	assert.equal(formatRate(1, 0), null);
});
