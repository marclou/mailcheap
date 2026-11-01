import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfirmationContent } from "../lib/confirmation-content.js";
import { hasEmailBody, isSameEmail, readEmail, toDraftEmail, toEditorHtml, toEmailContent, toStoredBody } from "../lib/newsletter-emails.js";

// A newsletter's own welcome, confirmation and last-chance emails: stored with their body in markdown or html, as the
// editor or the API wrote it, and on the settings form and in the API as { format, content }.
test("an email reads the same from any of its shapes, and stores the body in its own format's field", () => {
	const stored = { subject: "Welcome", previewText: "", format: "rich", markdown: "", html: "<p>Hi</p>" };
	assert.deepEqual(toDraftEmail(stored), { subject: "Welcome", previewText: "", format: "rich", content: "<p>Hi</p>" });
	assert.deepEqual(toDraftEmail(toDraftEmail(stored)), toDraftEmail(stored));
	assert.deepEqual(toDraftEmail({ subject: "Hi", markdown: "Hello" }), { subject: "Hi", previewText: "", format: "markdown", content: "Hello" }, "saved before the editor");
	assert.deepEqual(toDraftEmail(null), { subject: "", previewText: "", format: "markdown", content: "" });
	assert.deepEqual(readEmail(undefined), { subject: "", previewText: "", format: "markdown", markdown: "", html: "" });

	assert.deepEqual(toStoredBody({ format: "rich", content: "<p>Hi</p>" }), { format: "rich", markdown: "", html: "<p>Hi</p>" });
	assert.deepEqual(toStoredBody({ format: "markdown", content: "Hi" }), { format: "markdown", markdown: "Hi", html: "" });
	assert.deepEqual(toStoredBody({ format: "anything", content: "Hi" }), { format: "markdown", markdown: "Hi", html: "" });

	assert.deepEqual(toEmailContent({ ...stored, subject: " Welcome ", previewText: " Hi " }), { format: "rich", subject: "Welcome", previewText: "Hi", html: "<p>Hi</p>" });
	assert.deepEqual(toEmailContent({ subject: "Hi", markdown: "Hello" }), { format: "markdown", subject: "Hi", previewText: "", markdown: "Hello" });
});

test("an email has a body with words or a picture: the editor's empty paragraph isn't one", () => {
	assert.equal(hasEmailBody({ format: "rich", content: "<p></p>" }), false);
	assert.equal(hasEmailBody({ format: "rich", content: '<p><img src="https://cdn.example.com/a.png"></p>' }), true);
	assert.equal(hasEmailBody({ format: "rich", html: "<p>Hi</p>" }), true);
	assert.equal(hasEmailBody({ markdown: " \n" }), false);
	assert.equal(hasEmailBody({ markdown: "Hi" }), true);
});

test("two emails are the same when they say the same in the same format, line breaks aside", () => {
	const email = { subject: "Hi", previewText: "", format: "markdown", content: "Hello\nthere" };
	assert.equal(isSameEmail(email, { ...email, content: "Hello\r\nthere\r\n" }), true);
	assert.equal(isSameEmail(email, { ...email, format: "rich" }), false);
	assert.equal(isSameEmail(email, { ...email, subject: "Hello" }), false);
	assert.equal(isSameEmail(email, { subject: "Hi", markdown: "Hello\nthere" }), true, "stored or from the form");
});

test("the editor opens an email written in it as it is, and one in Markdown as HTML, its button line as a button", () => {
	const rich = getConfirmationContent({ name: "Field notes" });
	assert.equal(toEditorHtml(rich), rich.html);

	// The built-in confirmation email as owners copied it before the editor.
	const legacy = `**One click and you're in.**\n\nYou asked to get Field notes.\n\n<a href="{{confirm_url}}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my subscription</a>\n\nDidn't sign up? Ignore this email.`;
	const html = toEditorHtml({ format: "markdown", content: legacy });
	assert.ok(html.includes('<div data-button=""><a href="{{confirm_url}}">Confirm my subscription</a></div>'));
	assert.ok(!html.includes("style="), "the button takes the newsletter's colors");
	assert.ok(html.includes("<p><strong>One click and you&#39;re in.</strong></p>"));

	const inline = toEditorHtml({ format: "markdown", content: 'Please <a href="{{confirm_url}}">confirm</a> now.' });
	assert.equal(inline.trim(), '<p>Please <a href="{{confirm_url}}">confirm</a> now.</p>', "a link in a sentence stays a link");
	assert.ok(toEditorHtml({ format: "markdown", content: "<p><a href=\"https://example.com\">Site</a></p>" }).includes('<a href="https://example.com">'), "other links stay links");
});
