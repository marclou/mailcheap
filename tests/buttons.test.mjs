import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { getSlashItems } from "../components/MenuSlash.jsx";
import { renderIssueBody } from "../lib/archive-content.js";
import { BUTTON_PROBLEM } from "../lib/buttons.js";
import { getCheckFix } from "../lib/campaign-steps.js";
import { cleanRichHtml } from "../lib/clean-html.js";
import { getReviewInput } from "../lib/content-review.js";
import { getLlmsFull } from "../lib/docs/llms.js";
import { getOpenApiDocument } from "../lib/docs/openapi.js";
import { ButtonBlock, backspaceButton, exitButton, findButton } from "../lib/editor-button.js";
import { getLinkKey, getLinkLabels, normalizeLink } from "../lib/link-stats.js";
import { formatLinkUrl, normalizeUrl } from "../lib/links.js";
import { fillForReader } from "../lib/merge-tags.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { findButtonProblem, hasContent, renderEmail } from "../lib/render-email.js";
import { getPublishProblem, getSendProblem } from "../lib/sending-rules.js";
import { addTracking } from "../lib/tracking.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

// A button as the editor writes it (lib/editor-button.js).
function button(text, href, align) {
	const place = align ? ` data-align="${align}"` : "";
	return `<div data-button=""${place}><a${href ? ` href="${href}"` : ""}>${text}</a></div>`;
}

function emailBody(html) {
	return /<td class="body">([\s\S]*?)<\/td><\/tr>\n<tr><td style="padding:32px/.exec(html)?.[1];
}

function render(html, theme) {
	return renderEmail({ format: "rich", html, subject: "Hi", newsletter: { ...NEWSLETTER, ...(theme && { theme }) } });
}

const NEWSLETTER = { _id: "74f1a2b3c4d5e6f7a8b9c0d3", name: "Field notes", fromEmail: "jane@example.com", postalAddress: "1 Main St, Paris" };
const STORY = "https://example.com/story";

describe("what an issue keeps of a button", () => {
	test("the cleaner keeps its marker, its place and its link, written one way, and nothing else", () => {
		assert.equal(
			cleanRichHtml('<div class="x" data-align="right" data-button onclick="alert(1)" style="color:red"><a href="https://example.com/a?b=1&c=2" onclick="x">Go</a></div>'),
			'<div data-button="" data-align="right"><a href="https://example.com/a?b=1&c=2">Go</a></div>'
		);
		assert.equal(cleanRichHtml('<DIV DATA-BUTTON data-align=left><A HREF="https://x.test">x</A></DIV>'), button("x", "https://x.test", "left"));
		for (const align of ["center", "evil", "LEFT", 'left" onmouseover="alert(1)']) {
			assert.equal(cleanRichHtml(`<div data-button="" data-align='${align}'><a href="https://x.test">x</a></div>`), button("x", "https://x.test"), align);
		}
		assert.equal(cleanRichHtml(button("x", "javascript:alert(1)")), button("x"), "a link that could run goes, the button stays");
		assert.equal(cleanRichHtml(button("Hi", STORY, "left")), button("Hi", STORY, "left"), "the editor's own markup stays as it is");
	});

	test("a button or a link keeps the link MailCheap fills in for each reader of the confirmation and last-chance emails, and nothing like it", () => {
		for (const href of ["{{confirm_url}}", "{{keep_url}}"]) {
			assert.equal(cleanRichHtml(button("Yes", href)), button("Yes", href), href);
			assert.equal(cleanRichHtml(`<p><a href="${href}">Yes</a></p>`), `<p><a href="${href}">Yes</a></p>`, `${href} in a link`);
			assert.ok(emailBody(render(button("Yes", href)).html).includes(`<a href="${href}" style="display:inline-block;`), `${href} drawn as a button`);
			assert.equal(findButtonProblem(button("Yes", href)), null);
		}
		for (const href of ["{{first_name}}", "{{confirm_url}}x", "{{unsubscribe_url}}", "javascript:{{keep_url}}"]) {
			assert.equal(cleanRichHtml(button("Yes", href)), button("Yes"), href);
		}
	});

	test("the website sanitizes it to the same markup, which its styles draw as a button", () => {
		const html = `<p>Hi</p>${button("Go", "https://example.com/a?b=1&c=2", "right")}<div data-button="" data-align="evil" data-x="1"><a href="javascript:alert(1)" target="_top">Bad</a></div>`;
		assert.deepEqual(renderIssueBody({ format: "rich", html }), {
			kind: "article",
			html: '<p>Hi</p><div data-button="" data-align="right"><a href="https://example.com/a?b=1&amp;c=2">Go</a></div><div data-button=""><a target="_top">Bad</a></div>',
		});
	});

	test("the editor writes a button as the issue keeps it, its text in the link, centered without a place", () => {
		const spec = (attrs) => ButtonBlock.config.renderHTML({ node: { attrs: { href: "", align: "center", ...attrs } } });
		assert.deepEqual(spec({ href: STORY, align: "left" }), ["div", { "data-button": "", "data-align": "left" }, ["a", { href: STORY }, 0]]);
		assert.deepEqual(spec({ href: STORY }), ["div", { "data-button": "" }, ["a", { href: STORY }, 0]]);
		assert.deepEqual(spec({}), ["div", { "data-button": "" }, ["a", {}, 0]], "no link yet");
	});

	test("the slash menu's Button turns the line into one, and its link field takes what's typed as a web or email address", () => {
		const item = getSlashItems().find(({ title }) => title === "Button");
		assert.equal(item.run({ setNode: (name) => name }), "button");
		assert.match(item.keywords, /\bcta\b/);
		assert.equal(normalizeUrl(" example.com/story "), "https://example.com/story");
		assert.equal(normalizeUrl("jane@example.com"), "mailto:jane@example.com");
		assert.equal(normalizeUrl(STORY), STORY);
		assert.equal(normalizeUrl(""), "");
		assert.equal(formatLinkUrl("https://example.com/"), "example.com", "its toolbar shows where it goes as the click report does");
	});
});

describe("writing on a button in the editor", () => {
	const schema = getSchema([StarterKit, ButtonBlock]);
	const paragraph = (text) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
	const block = (text, href = STORY) => schema.node("button", { href }, text ? [schema.text(text)] : []);

	function stateAt(nodes, pos) {
		const doc = schema.node("doc", null, nodes);
		return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
	}

	function backspace(state) {
		let next = null;
		const isHandled = backspaceButton(state, (tr) => (next = state.apply(tr)));
		return { isHandled, next };
	}

	function enter(state) {
		let next = null;
		exitButton(state, (tr) => (next = state.apply(tr)));
		return next;
	}

	function blocks(state) {
		const names = [];
		state.doc.forEach((node) => names.push(`${node.type.name}:${node.textContent}`));
		return names;
	}

	test("its text is plain: no formatting, no Markdown shortcuts, and a line break never splits it", () => {
		const { spec } = schema.nodes.button;
		assert.equal(spec.code, true, "the editor's Markdown shortcuts skip code");
		assert.equal(schema.nodes.button.allowsMarkType(schema.marks.bold), false);
		assert.equal(schema.nodes.button.allowsMarkType(schema.marks.link), false);
		assert.equal(spec.isolating, true, "Backspace and Delete never join it with the text around it");
	});

	test("Enter goes on below it, in the empty paragraph already there or in a new one", () => {
		const into = enter(stateAt([block("Go"), paragraph("")], 3));
		assert.deepEqual(blocks(into), ["button:Go", "paragraph:"]);
		assert.equal(into.selection.from, 5);
		const added = enter(stateAt([block("Go"), paragraph("Hi")], 3));
		assert.deepEqual(blocks(added), ["button:Go", "paragraph:", "paragraph:Hi"]);
		assert.equal(added.selection.$from.parent.type.name, "paragraph");
		assert.equal(added.selection.from, 5);
		assert.deepEqual(blocks(enter(stateAt([paragraph("Hi"), block("Go")], 7))), ["paragraph:Hi", "button:Go", "paragraph:"], "as the last block");
	});

	test("Backspace in an empty button makes it a paragraph again", () => {
		const { isHandled, next } = backspace(stateAt([paragraph("Hi"), block("")], 5));
		assert.equal(isHandled, true);
		assert.deepEqual(blocks(next), ["paragraph:Hi", "paragraph:"]);
	});

	test("Backspace at the start of a block right after a button goes into its text, and an empty block goes too", () => {
		// The button "Go" is 0 to 4, its text 1 to 3; the paragraph starts at 4, its text at 5.
		const before = backspace(stateAt([block("Go"), paragraph("Hi")], 5));
		assert.deepEqual(blocks(before.next), ["button:Go", "paragraph:Hi"], "the text after it stays where it is");
		assert.equal(before.next.selection.from, 3);
		const empty = backspace(stateAt([block("Go"), paragraph("")], 5));
		assert.deepEqual(blocks(empty.next), ["button:Go"]);
		assert.equal(empty.next.selection.from, 3);
	});

	test("Backspace anywhere else is the editor's own", () => {
		assert.equal(backspace(stateAt([block("Go"), paragraph("Hi")], 2)).isHandled, false, "inside its text");
		assert.equal(backspace(stateAt([block("Go"), paragraph("Hi")], 1)).isHandled, false, "at the start of its text");
		assert.equal(backspace(stateAt([paragraph("Go"), paragraph("Hi")], 5)).isHandled, false, "after a paragraph");
		assert.equal(backspace(stateAt([block("Go"), paragraph("Hi")], 6)).isHandled, false, "inside the next paragraph");
	});

	test("its toolbar is for the button holding the caret or selected whole, not a selection running past it", () => {
		const state = stateAt([paragraph("Hi"), block("Go", "")], 6);
		assert.deepEqual({ pos: findButton(state).pos, href: findButton(state).node.attrs.href }, { pos: 4, href: "" });
		assert.equal(findButton(state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 4)))).pos, 4);
		assert.equal(findButton(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 6)))), null);
		assert.equal(findButton(stateAt([paragraph("Hi"), block("Go")], 2)), null);
	});
});

describe("buttons in emails", () => {
	test("an email draws a button in the newsletter's button colors and corners, where it sits in the column", () => {
		const plain = emailBody(render(`<p>Intro</p>${button("Read the full story", STORY)}<p>Outro</p>`).html);
		assert.match(plain, /^<p>Intro<\/p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><table role="presentation" align="center"/);
		assert.match(plain, /<td align="center" bgcolor="#18181b" style="border-radius:8px;background:#18181b;mso-padding-alt:12px 24px;"><a href="https:\/\/example\.com\/story" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#18181b;color:#ffffff;font-family:-apple-system,[^"]*;font-size:16px;font-weight:600;line-height:20px;text-decoration:none;">Read the full story<\/a><\/td><\/tr><\/table><\/td><\/tr><\/table><p>Outro<\/p>$/);

		const poster = emailBody(render(button("Join", STORY, "left"), { preset: "poster" }).html);
		assert.match(poster, /<td align="left"><table role="presentation" align="left"/);
		assert.match(poster, /bgcolor="#ffd23f" style="border-radius:0px;background:#ffd23f;/);
		assert.match(poster, /color:#0a0a0a;font-family:'MC Archivo',/, "a label that reads on a light accent, in the theme's font");
		assert.match(emailBody(render(button("Join", STORY, "right"), { preset: "sunset" }).html), /<td align="right">[^]*border-radius:999px;/);
	});

	test("the plain-text email reads a button as its text and its link, and it counts as content", () => {
		const { text } = render(`<p>Intro</p>${button("Read the full story", STORY)}`);
		assert.match(text, /^Intro\n\nRead the full story \(https:\/\/example\.com\/story\)\n\n—/);
		assert.equal(hasContent(button("Join", STORY)), true);
	});

	test("a button without text shows nothing, and a <div data-button> that isn't one link stays as it was", () => {
		assert.equal(emailBody(render(`<p>A</p>${button(" &nbsp; ", STORY)}<p>B</p>`).html), "<p>A</p><p>B</p>");
		assert.equal(emailBody(render('<div data-button=""><p>Hi</p></div>').html), '<div data-button=""><p>Hi</p></div>');
		const twoLinks = '<div data-button=""><a href="https://a.test">A</a><a href="https://b.test">B</a></div>';
		assert.equal(emailBody(render(twoLinks).html), twoLinks);
	});

	test("Markdown from the API gets buttons too, and only a web or email address becomes a button's link", () => {
		const markdown = `Hello\n\n${button("Go", STORY, "left")}\n\n${button("Mail us", "mailto:hi@example.com")}\n\n${button("Bad", "javascript:alert(1)")}`;
		const html = emailBody(renderEmail({ markdown, subject: "Hi", newsletter: NEWSLETTER }).html);
		assert.match(html, /<td align="left">[^]*<a href="https:\/\/example\.com\/story" style="display:inline-block;/);
		assert.match(html, /<a href="mailto:hi@example\.com" style="display:inline-block;/);
		assert.match(html, /<a style="display:inline-block;[^"]*">Bad<\/a>/);
		assert.doesNotMatch(html, /javascript:/);
		assert.equal(
			renderIssueBody({ format: "markdown", markdown: `Hi\n\n${button("Go", STORY, "left")}` }).html,
			`<p>Hi</p>\n${button("Go", STORY, "left")}`,
			"the website gets the same markup"
		);
	});

	test("names and fields fill in a button's text and link, and a reader's details stay text", () => {
		const html = render(button("Hi {{first_name|there}}", "https://example.com/?ref={{first_name}}")).html;
		const filled = fillForReader({ html }, { firstName: "Jane" }).html;
		assert.match(filled, /<a href="https:\/\/example\.com\/\?ref=Jane" style="[^"]*">Hi Jane<\/a>/);
		const hostile = fillForReader({ html }, { firstName: '"><img src=x onerror=alert(1)>' }).html;
		assert.doesNotMatch(hostile, /<img src=x/);
		assert.equal(renderIssueBody({ format: "rich", html: button("Hi {{first_name|there}}", STORY) }).html, button("Hi there", STORY), "the website prints the fallback");
	});

	test("click tracking follows a button's link, and the click report names it by its text", () => {
		const stored = `<p>Hi</p>${button("Read the full story", `${STORY}?utm_source=mail`)}`;
		const tracked = addTracking(render(stored).html, { baseUrl: "https://mail.example.com", messageId: "74f1a2b3c4d5e6f7a8b9c0d4" });
		assert.match(tracked, /<a href="https:\/\/mail\.example\.com\/c\/74f1a2b3c4d5e6f7a8b9c0d4\.[^"]+" style="display:inline-block;/);
		assert.equal(getLinkLabels(stored).get(getLinkKey(normalizeLink(STORY))), "Read the full story");
	});
});

describe("what holds an issue with a button", () => {
	test("a button without text or a link holds it, whatever else it has", () => {
		assert.equal(findButtonProblem(`<p>Hi</p>${button("Join", STORY)}`), null);
		assert.equal(findButtonProblem("<p>No buttons</p>"), null);
		for (const broken of [button("Join"), button("", STORY), button(" &nbsp; ", STORY), button("Join", "#top"), button("Join", "javascript:alert(1)")]) {
			assert.equal(findButtonProblem(`<p>Hi</p>${button("Fine", STORY)}${broken}`), BUTTON_PROBLEM, broken);
		}
		assert.equal(findButtonProblem(`Some **Markdown**\n\n${button("Join")}`), BUTTON_PROBLEM, "Markdown's buttons are HTML too");
		assert.equal(findButtonProblem('<div data-html-block="">&lt;div data-button=""&gt;&lt;a&gt;x&lt;/a&gt;&lt;/div&gt;</div>'), null, "an HTML block's code is its own");
	});

	test("the review step blocks on it and goes back to the editor, but not for an email designed elsewhere", () => {
		const input = { newsletter: NEWSLETTER, rendered: { html: "<p>{{unsubscribe_url}}</p>", bytes: 100 }, isSendingEnabled: true };
		const campaign = { subject: "Hi", previewText: "Hi", testSentAt: new Date(), format: "rich", body: `<p>Hi</p>${button("Join")}` };
		const { checks, blocking } = getPresendChecks({ ...input, campaign });
		const check = checks.find(({ id }) => id === "buttons");
		assert.deepEqual(check, { id: "buttons", label: "Buttons", isOk: false, message: BUTTON_PROBLEM });
		assert.deepEqual(blocking.map(({ id }) => id), ["buttons"]);
		assert.deepEqual(getCheckFix(check, { newsletterId: NEWSLETTER._id }), {
			label: "Edit content",
			field: "body",
			problem: { id: "buttons", message: BUTTON_PROBLEM },
		});

		const complete = getPresendChecks({ ...input, campaign: { ...campaign, body: `<p>Hi</p>${button("Join", STORY)}` } });
		assert.equal(complete.checks.some(({ id }) => id === "buttons"), false, "no check to show while every button works");
		assert.equal(getPresendChecks({ ...input, campaign: { ...campaign, format: "html" } }).checks.some(({ id }) => id === "buttons"), false);
	});

	test("sending and publishing refuse it, from the dashboard, the API or a schedule alike", () => {
		const campaign = { format: "rich", subject: "Hi", html: `<p>Hi</p>${button("Join")}` };
		assert.equal(getSendProblem({ campaign, newsletter: NEWSLETTER }), BUTTON_PROBLEM);
		assert.equal(getSendProblem({ campaign: { ...campaign, html: `<p>Hi</p>${button("Join", STORY)}` }, newsletter: NEWSLETTER }), null);
		assert.equal(getSendProblem({ campaign: { ...campaign, html: "" }, newsletter: NEWSLETTER }), "Add content", "content comes first");
		const markdown = { format: "markdown", subject: "Hi", markdown: `Hi\n\n${button("", STORY)}` };
		assert.equal(getPublishProblem({ campaign: markdown, newsletter: { archiveEnabled: true } }), BUTTON_PROBLEM);
		assert.equal(getSendProblem({ campaign: { format: "html", subject: "Hi", html: `<html><body>${button("Join")}</body></html>` }, newsletter: NEWSLETTER }), null);
	});

	test("the content check reads a button's text and where it goes", () => {
		const html = `<p>Hello</p>${button("Verify your account", "https://login.example.net/verify")}`;
		const input = getReviewInput({ campaign: { format: "rich", subject: "Hi", previewText: "", html }, newsletter: { name: "Field notes" } });
		assert.deepEqual(input.links, ["login.example.net"]);
		assert.equal(input.text, "Hello\n\nVerify your account (https://login.example.net/verify)");
	});
});

describe("buttons through the API", () => {
	let app;
	let user;

	before(async () => {
		app = await startTestApp();
		const newsletters = await import("../app/(app)/newsletters/actions.js");
		const apiKeys = await import("../app/(app)/api-keys/actions.js");
		user = await signIn("buttons@example.com");
		await activate(user);
		const fields = { name: "Buttons", slug: "buttons", fromName: "Field notes", fromEmail: "hello@buttons.mailcheapmail.com", postalAddress: "1 Main St, Paris" };
		user.newsletterId = (await as(user, () => catchRedirect(newsletters.saveNewsletter(null, form(fields))))).split("/").at(-1);
		user.key = (await as(user, () => apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	});

	after(() => app?.stop());

	test("update_campaign tells agents how to write buttons and HTML blocks, in the OpenAPI document and the llms file", () => {
		const operations = Object.values(getOpenApiDocument("https://mail.example.com").paths).flatMap((path) => Object.values(path));
		const update = operations.find(({ operationId }) => operationId === "update_campaign");
		const { description } = update.requestBody.content["application/json"].schema.properties.format;
		assert.match(description, /^With content: the format it's in\./);
		assert.ok(description.includes('<div data-button=""><a href="https://…">Its text</a></div>'), description);
		assert.ok(description.includes('<div data-html-block="">'), description);
		assert.ok(getLlmsFull("https://mail.example.com").includes('data-align="left" or "right"'));
	});

	test("an issue's button is kept as written, drawn in its preview, and holds the send until it has a link", async () => {
		const content = `<p>Hello</p>${button("Join the waitlist", null, "right")}`;
		const created = await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { newsletter: "buttons", subject: "Hi", format: "rich", content } });
		assert.equal(created.status, 201, JSON.stringify(created.body));
		assert.equal(created.body.content, content);
		assert.deepEqual(created.body.sendProblem, { code: "send_check_failed", message: BUTTON_PROBLEM });

		const send = await callApi("POST", `/api/v1/campaigns/${created.body.id}/send`, { key: user.key });
		assert.equal(send.body.error?.message, BUTTON_PROBLEM, JSON.stringify(send.body));

		const linked = `<p>Hello</p>${button("Join the waitlist", "https://example.com/waitlist?ref={{first_name}}", "right")}`;
		const updated = await callApi("PATCH", `/api/v1/campaigns/${created.body.id}`, { key: user.key, body: { content: linked } });
		assert.equal(updated.status, 200, JSON.stringify(updated.body));
		assert.notEqual(updated.body.sendProblem?.message, BUTTON_PROBLEM);

		const preview = await callApi("GET", `/api/v1/campaigns/${created.body.id}/preview`, { key: user.key });
		assert.equal(preview.status, 200, JSON.stringify(preview.body));
		assert.match(preview.body.html, /<td align="right"><table role="presentation" align="right"[^]*<a href="https:\/\/example\.com\/waitlist\?ref=Jane" style="display:inline-block;[^"]*">Join the waitlist<\/a>/);
		assert.match(preview.body.text, /Join the waitlist \(https:\/\/example\.com\/waitlist\?ref=Jane\)/);
	});
});
