import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRate } from "../lib/format.js";
import { firstImageUrl, isOptimizableImage } from "../lib/thumbnail.js";

test("only local and Blob pictures go through Next's resizer", () => {
	assert.equal(isOptimizableImage("/authors/jane.jpg"), true);
	assert.equal(
		isOptimizableImage("https://br-broad-darkness-b5i5ke6a.storage.c-7.us-east-2.aws.neon.tech/mailcheap-images/images/a-x.webp"),
		true
	);
	assert.equal(isOptimizableImage("https://br-x.storage.c-7.us-east-2.aws.neon.tech/other-bucket/a.png"), false);
	assert.equal(isOptimizableImage("https://images.example.com/uploads/a.png"), false);
	assert.equal(isOptimizableImage("https://mailcheap.example.com/archive/weekly/og?p=x"), false);
	assert.equal(isOptimizableImage("https://evil.test/x.storage.c-7.us-east-2.aws.neon.tech/mailcheap-images/a.png"), false);
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
