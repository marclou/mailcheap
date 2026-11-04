import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDrafts, mergeField, mergeSequences } from "../lib/draft-merge.js";

const base = ["<h2>Hi</h2>", "<p>One</p>", "<p>Two</p>", "<p>Three</p>"];

test("changes to different paragraphs are both kept", () => {
	const mine = ["<h2>Hi</h2>", "<p>One, edited by me</p>", "<p>Two</p>", "<p>Three</p>"];
	const theirs = ["<h2>Hi</h2>", "<p>One</p>", "<p>Two</p>", "<p>Three, edited by them</p>"];
	assert.deepEqual(mergeSequences(base, mine, theirs), ["<h2>Hi</h2>", "<p>One, edited by me</p>", "<p>Two</p>", "<p>Three, edited by them</p>"]);
});

test("a paragraph added next to one the other changed keeps both", () => {
	const mine = ["<h2>Hi</h2>", "<p>One</p>", "<p>Two, edited</p>", "<p>Three</p>"];
	const theirs = ["<h2>Hi</h2>", "<p>One</p>", "<p>Two</p>", "<p>New</p>", "<p>Three</p>"];
	assert.deepEqual(mergeSequences(base, mine, theirs), ["<h2>Hi</h2>", "<p>One</p>", "<p>Two, edited</p>", "<p>New</p>", "<p>Three</p>"]);
});

test("a paragraph both changed keeps the latest typing, and a changed one beats a deletion", () => {
	assert.deepEqual(
		mergeSequences(base, [base[0], "<p>One, mine</p>", base[2], base[3]], [base[0], "<p>One, theirs</p>", base[2], base[3]]),
		[base[0], "<p>One, mine</p>", base[2], base[3]]
	);
	assert.deepEqual(mergeSequences(base, [base[0], base[2], base[3]], [base[0], "<p>One, theirs</p>", base[2], base[3]]), [
		base[0],
		"<p>One, theirs</p>",
		base[2],
		base[3],
	]);
	assert.deepEqual(mergeSequences(base, [base[0], base[1], base[3]], base), [base[0], base[1], base[3]], "a deletion alone goes through");
});

test("blocks both added at the same place go in, theirs first, once each", () => {
	const mine = [...base, "<p>Mine</p>", "<p>Same</p>"];
	const theirs = [...base, "<p>Theirs</p>", "<p>Same</p>"];
	assert.deepEqual(mergeSequences(base, mine, theirs), [...base, "<p>Theirs</p>", "<p>Same</p>", "<p>Mine</p>"]);
	assert.deepEqual(mergeSequences([], ["<p>A</p>"], ["<p>B</p>"]), ["<p>B</p>", "<p>A</p>"], "an empty draft");
});

test("fields keep this editor's change, else take theirs", () => {
	assert.equal(mergeField("Hi", "Hi", "Hello"), "Hello");
	assert.equal(mergeField("Hi", "Hey", "Hello"), "Hey");
	const split = (html) => html.match(/<p>.*?<\/p>/g) ?? [];
	const merged = mergeDrafts({
		base: { subject: "S", previewText: "P", body: "<p>A</p><p>B</p>" },
		mine: { subject: "S", previewText: "Mine", body: "<p>A!</p><p>B</p>" },
		theirs: { subject: "Theirs", previewText: "P", body: "<p>A</p><p>B!</p>" },
		split,
	});
	assert.deepEqual(merged, { subject: "Theirs", previewText: "Mine", body: "<p>A!</p><p>B!</p>" });
});
