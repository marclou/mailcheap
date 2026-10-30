import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { HtmlBlock } from "../components/BlockHtml.jsx";
import { placeDots } from "../components/GutterProblems.jsx";
import { getCheckFix } from "../lib/campaign-steps.js";
import { findContentWarnings } from "../lib/content-warnings.js";
import { ButtonBlock } from "../lib/editor-button.js";
import { Problems, findDocProblems, findProblem, isBeingWritten, mapProblems, problemsKey } from "../lib/editor-problems.js";
import { getPresendChecks } from "../lib/presend-checks.js";

const schema = getSchema([StarterKit, ButtonBlock, HtmlBlock]);
const text = (value, marks = []) => schema.text(value, marks);
const link = (href) => schema.marks.link.create({ href });
const paragraph = (...content) => schema.node("paragraph", null, content);
const doc = (...blocks) => schema.node("doc", null, blocks);
const button = (label, href = "") => schema.node("button", { href }, label ? [text(label)] : []);
const htmlBlock = (html) => schema.node("htmlBlock", { html });

// Each block with problems, by its kind, with each problem's kind, how much it matters and its words in the issue.
function describeProblems(content) {
	return findDocProblems(content).map(({ pos, problems }) => [
		content.nodeAt(pos).type.name,
		problems.map(({ id, severity, from, to }) => [id, severity, from === undefined ? null : content.textBetween(from, to)]),
	]);
}

describe("what the editor marks beside a block", () => {
	test("each paragraph and heading says what may look broken in it, with the words to select", () => {
		const content = doc(
			paragraph(text("Read "), text("my ", [link("https://localhost:3000/notes")]), text("notes", [link("https://localhost:3000/notes"), schema.marks.bold.create()]), text(" first.")),
			paragraph(text("Fine, with "), text("a link", [link("https://letters.test.dev/post")]), text(".")),
			paragraph(text("Lorem ipsum dolor, "), text("TODO", [schema.marks.code.create()]), text(" stays code.")),
			schema.node("heading", { level: 2 }, [text("## Big news")]),
			paragraph(text("Hi {{FNAME}}, {{first_name|there}} and {{unsubscribe_url}}")),
			paragraph(text("Line one"), schema.node("hardBreak"), text("**two**")),
			schema.node("bulletList", null, [schema.node("listItem", null, [paragraph(text("[insert link]"))])])
		);
		assert.deepEqual(describeProblems(content), [
			["paragraph", [["links", "warning", "my notes"]]],
			["paragraph", [["placeholder-text", "warning", "Lorem ipsum"]]],
			["heading", [["formatting", "warning", "## Big news"]]],
			["paragraph", [["merge-tags", "warning", "{{FNAME}}"]]],
			["paragraph", [["formatting", "warning", "**two**"]]],
			["paragraph", [["placeholder-text", "warning", "[insert link]"]]],
		]);
	});

	test("a button without its text or link holds the send, and one that has both has its link read", () => {
		const content = doc(button("Join"), button("", "https://letters.test.dev"), button(""), button("Preview", "https://localhost/p"), button("Go", "https://letters.test.dev"));
		const blocks = findDocProblems(content);
		assert.deepEqual(
			blocks.map(({ problems }) => problems.map(({ id, severity, message }) => [id, severity, message])),
			[
				[["buttons", "error", "This button needs a link"]],
				[["buttons", "error", "This button needs its text"]],
				[["buttons", "error", "This button needs its text and a link"]],
				[["links", "warning", "The link on “Preview” goes to localhost, which only opens on your own computer or network"]],
			]
		);
		const [{ problems }] = blocks;
		assert.equal(content.textBetween(problems[0].from, problems[0].to), "Join", "its text, where the caret goes");
	});

	test("a name or field without a fallback leaves a gap, in a paragraph or a button, and the review step goes to it", () => {
		const fields = [{ key: "points", label: "Gift points", type: "number" }];
		const content = doc(
			paragraph(text("Hi {{first_name}}, you have {{points}}, {{first_name|}} and {{points|no}} points")),
			button("Claim {{ points }}", "https://letters.test.dev"),
			button("Claim {{points}}")
		);
		const blocks = findDocProblems(content, fields);
		assert.deepEqual(
			blocks.map(({ problems }) => problems.map(({ id, severity, from, to }) => [id, severity, content.textBetween(from, to)])),
			[
				[
					["merge-tags", "warning", "{{first_name}}"],
					["merge-tags", "warning", "{{points}}"],
				],
				[["merge-tags", "warning", "{{ points }}"]],
				[
					["buttons", "error", "Claim {{points}}"],
					["merge-tags", "warning", "{{points}}"],
				],
			]
		);
		assert.equal(blocks[0].problems[1].message, "{{points}} leaves a gap for readers with no gift points: add | and a word inside the braces");

		const input = { newsletter: { postalAddress: "1 Main St" }, rendered: { html: "{{unsubscribe_url}}", bytes: 100 }, isSendingEnabled: true };
		const campaign = { subject: "News", previewText: "Hi", testSentAt: new Date(), format: "rich", body: "<p>Hi {{first_name}}, you have {{points}}</p>" };
		const check = getPresendChecks({ ...input, campaign, contactFields: fields }).checks.find(({ id }) => id === "merge-tags");
		const { problem } = getCheckFix(check, { newsletterId: "n1" });
		assert.deepEqual(findProblem(blocks, problem), { pos: blocks[0].pos, problem: blocks[0].problems[0] });
	});

	test("an HTML block says what its review step warnings say, with no words of the editor's", () => {
		const content = doc(htmlBlock("<table><tr><td>Hi"), htmlBlock('<p><a href="www.letters.test.dev">Site</a></p>'), htmlBlock("<p>Fine</p>"));
		assert.deepEqual(
			findDocProblems(content).map(({ problems }) => problems.map(({ id, message, from }) => [id, message, from])),
			[
				[["html-blocks", "An HTML block never closes <table>, so what follows can end up inside it", undefined]],
				[["links", "The link on “Site” in an HTML block goes to “www.letters.test.dev”, which needs the full address, starting with https://", undefined]],
			]
		);
	});

	test("a block's problems say what the review step says about the same issue", () => {
		const html = [
			'<p>Read <a href="https://localhost:3000/notes">my notes</a></p>',
			'<div data-html-block="">&lt;b&gt;&lt;i&gt;Hi&lt;/b&gt;</div>',
			"<p>Lorem ipsum</p>",
			"<p>Some **bold**</p>",
		].join("");
		const content = doc(
			paragraph(text("Read "), text("my notes", [link("https://localhost:3000/notes")])),
			htmlBlock("<b><i>Hi</b>"),
			paragraph(text("Lorem ipsum")),
			paragraph(text("Some **bold**"))
		);
		const fromEditor = findDocProblems(content).flatMap(({ problems }) => problems.map(({ id, message }) => [id, message]));
		assert.deepEqual(fromEditor, findContentWarnings(html).map(({ id, message }) => [id, message]));
	});

	test("a long issue is read in linear time", () => {
		const content = doc(
			...Array.from({ length: 4000 }, (_, index) => paragraph(text(`Paragraph ${index}, [your note] and **bold** with `), text("a link", [link("#")]))),
			paragraph(text("**a".repeat(150_000))),
			paragraph(text("[your ".repeat(80_000))),
			htmlBlock("<div>".repeat(100_000))
		);
		const startedAt = performance.now();
		const blocks = findDocProblems(content);
		assert.ok(performance.now() - startedAt < 2000, `${Math.round(performance.now() - startedAt)} ms`);
		assert.equal(blocks.length, 4002, "the brackets never close, so they're no placeholder");
	});
});

describe("where the dots sit", () => {
	test("in the page's margin, just left of the editor's card, on a target wide enough to find, when the page leaves room", () => {
		assert.deepEqual(placeDots({ editorLeft: 400, paddingLeft: 48, pageLeft: 60 }), { x: 366, width: 32, isOutside: true });
		assert.deepEqual(placeDots({ editorLeft: 34, paddingLeft: 48, pageLeft: 0 }), { x: 0, width: 32, isOutside: true });
	});

	test("in the editor's left padding, clear of the grip, where the page has no room, as on a phone, or no margin to give", () => {
		assert.deepEqual(placeDots({ editorLeft: 33, paddingLeft: 48, pageLeft: 0 }), { x: 36, width: 16, isOutside: false });
		assert.deepEqual(placeDots({ editorLeft: 16, paddingLeft: 20, pageLeft: 0 }), { x: 18, width: 16, isOutside: false });
		assert.deepEqual(placeDots({ editorLeft: 400, paddingLeft: 48, pageLeft: 60, hasGutter: false }), { x: 403, width: 16, isOutside: false });
	});
});

describe("the dots following their blocks", () => {
	const content = doc(paragraph(text("Intro")), paragraph(text("TODO later")));
	const [plugin] = Problems.config.addProseMirrorPlugins.call({ options: { contactFields: [] }, storage: { segmentIds: [], contactFields: [] } });

	test("typing moves each block's problems with it, and deleting a block takes them away", () => {
		const blocks = findDocProblems(content);
		const state = EditorState.create({ doc: content });
		const typed = state.tr.insertText("Hello, ", 1);
		const [moved] = mapProblems({ blocks, flash: null }, typed.mapping).blocks;
		assert.equal(moved.pos, blocks[0].pos + 7);
		assert.equal(typed.doc.textBetween(moved.problems[0].from, moved.problems[0].to), "TODO");

		const { pos } = blocks[0];
		const deleted = state.tr.delete(pos, pos + content.nodeAt(pos).nodeSize);
		assert.deepEqual(mapProblems({ blocks, flash: { pos, severity: "warning" } }, deleted.mapping), { blocks: [], flash: null });
	});

	test("the plugin reads the issue as it opens, maps it as it changes, and takes a new reading or a flash when given one", () => {
		const state = EditorState.create({ doc: content, plugins: [plugin] });
		const [{ pos }] = problemsKey.getState(state).blocks;
		const typed = state.apply(state.tr.insertText("Hi ", 1));
		assert.equal(problemsKey.getState(typed).blocks[0].pos, pos + 3);

		const flashed = typed.apply(typed.tr.setMeta(problemsKey, { flash: { pos: pos + 3, severity: "warning" } }));
		const [decoration] = plugin.props.decorations(flashed).find();
		assert.deepEqual([decoration.from, decoration.type.attrs], [pos + 3, { "data-flash": "warning" }]);
		const read = flashed.apply(flashed.tr.setMeta(problemsKey, { blocks: [] }));
		assert.deepEqual(problemsKey.getState(read).blocks, []);
		assert.ok(problemsKey.getState(read).flash, "a reading keeps the flash");
	});

	test("a button's dot waits while the caret is in it, and an HTML block's while it's open, not while it's selected", () => {
		const blocks = doc(paragraph(text("Hi")), button("Join"), htmlBlock("<b>x"));
		const buttonPos = 4;
		const blockPos = buttonPos + blocks.nodeAt(buttonPos).nodeSize;
		assert.equal(isBeingWritten(EditorState.create({ doc: blocks, selection: TextSelection.create(blocks, buttonPos + 3) }), buttonPos), true);
		assert.equal(isBeingWritten(EditorState.create({ doc: blocks, selection: TextSelection.create(blocks, 2) }), buttonPos), false);
		assert.equal(isBeingWritten(EditorState.create({ doc: blocks, selection: NodeSelection.create(blocks, blockPos) }), blockPos), false);
	});
});

describe("going from the review step to a problem", () => {
	const blocks = [
		{ pos: 1, problems: [{ id: "links", message: "The link on “A” has no address" }] },
		{ pos: 9, problems: [{ id: "placeholder-text", message: "Your issue still says “TODO”" }, { id: "links", message: "The link on “B” has no address" }] },
	];

	test("its fix finds the problem with its very message, else the first of its kind", () => {
		assert.deepEqual(findProblem(blocks, { id: "links", message: "The link on “B” has no address" }), { pos: 9, problem: blocks[1].problems[1] });
		assert.deepEqual(findProblem(blocks, { id: "links", message: "Add text and a link to each button" }), { pos: 1, problem: blocks[0].problems[0] });
		assert.equal(findProblem(blocks, { id: "formatting", message: "Something else" }), null);
		assert.equal(findProblem(blocks, {}), null, "a tip's fix has words only");
	});

	test("each fix in the issue carries its kind and message, a merge tag in the subject its words in the subject", () => {
		const input = { newsletter: { postalAddress: "1 Main St" }, rendered: { html: "{{unsubscribe_url}}", bytes: 100 }, isSendingEnabled: true };
		const body = '<p><a href="#">Read more</a></p><div data-button=""><a>Join</a></div><div data-html-block="">&lt;b&gt;x</div>';
		const campaign = { subject: "Hi {{FNAME}}", previewText: "Hi", testSentAt: new Date(), format: "rich", body };
		const { checks } = getPresendChecks({ ...input, campaign });
		const fixes = Object.fromEntries(checks.filter(({ isOk }) => !isOk).map((check) => [check.id, getCheckFix(check, { newsletterId: "n1" })]));
		assert.deepEqual(fixes, {
			buttons: { label: "Edit content", field: "body", problem: { id: "buttons", message: "Add text and a link to each button" } },
			"merge-tags": { label: "Edit subject", field: "subject", words: "{{FNAME}}" },
			links: { label: "Edit content", field: "body", words: "Read more", problem: { id: "links", message: "The link on “Read more” has no address" } },
			"html-blocks": {
				label: "Edit content",
				field: "body",
				problem: { id: "html-blocks", message: "An HTML block never closes <b>, so what follows can end up inside it" },
			},
		});
	});
});
