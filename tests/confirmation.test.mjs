import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FormConfirm from "../components/FormConfirm.jsx";
import { CONFIRM_URL_PLACEHOLDER, getConfirmationContent, getConfirmationProblem, isDefaultConfirmation } from "../lib/confirmation-content.js";
import { createConfirmToken, verifyConfirmToken } from "../lib/confirmation.js";
import { getInbox } from "../lib/inbox-links.js";
import { renderEmail } from "../lib/render-email.js";
import { buildRecipientEmail, getWelcomeContent } from "../lib/sending-rules.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/unsubscribe.js";
import { prefillWelcome } from "../lib/welcome-content.js";

process.env.BETTER_AUTH_SECRET ||= "test-secret-for-confirmation-links";
process.env.APP_URL ||= "https://mailcheap.test";

const REFERENCE = { contactId: "64f1a2b3c4d5e6f7a8b9c0a1", newsletterId: "64f1a2b3c4d5e6f7a8b9c0b1" };
const DAY_MS = 24 * 60 * 60 * 1000;

// The text of each paragraph of an email written in the editor.
function paragraphs(content) {
	return [...content.html.matchAll(/<p>(.*?)<\/p>/g)].map(([, html]) => html.replace(/<[^>]+>/g, ""));
}

test("a confirmation link names one contact and stops working after 30 days", () => {
	const now = Date.now();
	const token = createConfirmToken(REFERENCE, now);
	assert.deepEqual(verifyConfirmToken(token, now + DAY_MS), REFERENCE);
	assert.equal(verifyConfirmToken(token, now + 31 * DAY_MS), null);

	const [payload, signature] = token.split(".");
	const forged = Buffer.from(JSON.stringify({ c: "64f1a2b3c4d5e6f7a8b9c0a2", n: REFERENCE.newsletterId, t: Math.floor(now / 1000) })).toString("base64url");
	assert.equal(verifyConfirmToken(`${forged}.${signature}`), null, "another contact can't reuse the signature");
	assert.equal(verifyConfirmToken(`${payload}.${signature.slice(1)}x`), null);
	assert.equal(verifyConfirmToken("not-a-token"), null);
});

test("unsubscribe and confirmation links can't stand in for each other", () => {
	assert.equal(verifyConfirmToken(createUnsubscribeToken(REFERENCE)), null);
	assert.equal(verifyUnsubscribeToken(createConfirmToken(REFERENCE)), null);
});

// Posted without the script, from a page that sends no referrer, a form would come with Origin: null, which Next.js
// refuses with an error.
test("the confirm page has no form to post before its script runs, only the button", () => {
	const html = renderToStaticMarkup(createElement(FormConfirm, { token: "abc", newsletterName: "Field notes", fromEmail: "hi@example.com" }));
	assert.doesNotMatch(html, /<form/);
	assert.match(html, /<button[^>]*>Confirm my subscription<\/button>/);
});

test("the confirmation email carries a clean link in both versions", () => {
	const content = getConfirmationContent({ name: "Field notes" });
	assert.equal(content.subject, "Confirm your subscription to Field notes");
	assert.equal(content.format, "rich", "written as the editor writes it, where its owner can change it");
	assert.ok(content.html.includes(`<div data-button=""><a href="${CONFIRM_URL_PLACEHOLDER}">Confirm my subscription</a></div>`));

	const email = buildRecipientEmail({
		campaign: content,
		newsletter: { _id: REFERENCE.newsletterId, name: "Field notes", fromEmail: "hi@news.example.org" },
		contact: { _id: REFERENCE.contactId, email: "reader@example.com" },
		messageId: null,
		confirmUrl: "https://mailcheap.test/confirm?token=abc",
	});
	assert.ok(email.html.includes('href="https://mailcheap.test/confirm?token=abc"'));
	assert.ok(email.text.includes("Confirm my subscription (https://mailcheap.test/confirm?token=abc)"));
	assert.ok(!email.html.includes("/c/") && !email.html.includes("/o/"), "no tracking redirect or pixel");
	assert.ok(renderEmail(content).html.includes(CONFIRM_URL_PLACEHOLDER), "the link is filled per recipient");
});

test("a newsletter's own confirmation email goes out with each subscriber's link", () => {
	const confirmation = {
		subject: " [Action Required] Confirm your Field notes subscription ",
		previewText: "One click and you're in.",
		markdown: `<p style="text-align:center"><img src="https://mailcheap.test/email/banner.png" alt="Field notes" width="600" height="200"></p>

Confirm your email to get the next issue:

<a href="${CONFIRM_URL_PLACEHOLDER}" style="display:inline-block;">Confirm my subscription</a>

Every Sunday, you'll get:

- One idea about building things`,
	};
	const content = getConfirmationContent({ name: "Field notes", confirmation });
	assert.equal(content.subject, "[Action Required] Confirm your Field notes subscription");
	assert.equal(content.previewText, "One click and you're in.");

	const email = buildRecipientEmail({
		campaign: content,
		newsletter: { _id: REFERENCE.newsletterId, name: "Field notes", fromEmail: "hi@news.example.org" },
		contact: { _id: REFERENCE.contactId, email: "reader@example.com" },
		messageId: null,
		confirmUrl: "https://mailcheap.test/confirm?token=xyz",
	});
	assert.ok(email.html.includes('href="https://mailcheap.test/confirm?token=xyz"'));
	assert.ok(email.html.includes('src="https://mailcheap.test/email/banner.png"'));
	assert.ok(email.html.includes("<li>One idea about building things</li>"));
	assert.ok(email.text.includes("Confirm my subscription (https://mailcheap.test/confirm?token=xyz)"));
	assert.ok(!email.html.includes(CONFIRM_URL_PLACEHOLDER) && !email.text.includes(CONFIRM_URL_PLACEHOLDER));
	assert.ok(!email.html.includes("/c/") && !email.html.includes("/o/"), "no tracking redirect or pixel");
	assert.ok(email.headers["List-Unsubscribe"].includes("/api/unsubscribe?token="));
});

test("a confirmation email without its button can't be saved and never goes out", () => {
	const builtIn = getConfirmationContent({ name: "Field notes" });
	assert.equal(getConfirmationProblem(builtIn), null);
	assert.equal(getConfirmationProblem({ ...builtIn, subject: " " }), "Confirmation email needs a subject");

	const buttonProblem = /^Confirmation email needs its button: a link to \{\{confirm_url\}\}/;
	const inMarkdown = (markdown) => ({ subject: "Confirm", format: "markdown", markdown });
	const inEditor = (html) => ({ subject: "Confirm", format: "rich", html });
	assert.match(getConfirmationProblem(inMarkdown("Welcome to Field notes")), buttonProblem);
	assert.match(
		getConfirmationProblem(inMarkdown(`[Confirm](${CONFIRM_URL_PLACEHOLDER})`)),
		buttonProblem,
		"a Markdown link encodes the braces, so the link would be dead"
	);
	assert.match(getConfirmationProblem(inMarkdown(`    <a href="${CONFIRM_URL_PLACEHOLDER}">Confirm</a>`)), buttonProblem, "an indented line is a code block");
	assert.equal(getConfirmationProblem(inMarkdown(`Hi\n\n<a href="${CONFIRM_URL_PLACEHOLDER}">Confirm</a>`)), null);

	assert.match(getConfirmationProblem(inEditor("<p>Welcome to Field notes</p>")), buttonProblem);
	assert.match(getConfirmationProblem(inEditor('<div data-button=""><a href="https://example.com">Confirm</a></div>')), buttonProblem);
	assert.equal(getConfirmationProblem(inEditor(`<p>Hi</p><div data-button=""><a href="${CONFIRM_URL_PLACEHOLDER}">Confirmar</a></div>`)), null);
	assert.equal(getConfirmationProblem(inEditor(`<p><a href="${CONFIRM_URL_PLACEHOLDER}">Confirm</a> to get it.</p>`)), null, "a link in the text works too");

	const withoutButton = { name: "Field notes", confirmation: { subject: "Welcome", markdown: "No button here" } };
	assert.deepEqual(getConfirmationContent(withoutButton), builtIn, "the built-in email goes out instead");
});

test("one written in the editor goes out with each subscriber's link on its button", () => {
	const confirmation = {
		subject: "Confirme sua inscrição",
		format: "rich",
		html: `<p><strong>Falta só um clique.</strong></p><div data-button="" data-align="left"><a href="${CONFIRM_URL_PLACEHOLDER}">Confirmar</a></div>`,
	};
	const content = getConfirmationContent({ name: "Field notes", confirmation });
	assert.deepEqual(content, { format: "rich", subject: "Confirme sua inscrição", previewText: "", html: confirmation.html });
	const email = buildRecipientEmail({
		campaign: content,
		newsletter: { _id: REFERENCE.newsletterId, name: "Field notes", fromEmail: "hi@news.example.org" },
		contact: { _id: REFERENCE.contactId, email: "reader@example.com" },
		messageId: null,
		confirmUrl: "https://mailcheap.test/confirm?token=abc",
	});
	assert.match(email.html, /<a href="https:\/\/mailcheap\.test\/confirm\?token=abc" style="display:inline-block;[^"]*">Confirmar<\/a>/, "drawn as a button");
	assert.ok(email.text.includes("Confirmar (https://mailcheap.test/confirm?token=abc)"));
	assert.ok(!email.html.includes(CONFIRM_URL_PLACEHOLDER));
});

test("the built-in confirmation email says what the newsletter is about; one it wrote or saved stays as it is", () => {
	const firstLine = (newsletter) => paragraphs(getConfirmationContent(newsletter))[1];
	assert.equal(firstLine({ name: "Field notes", description: " One idea\n\na week " }), "You asked to get Field notes. One idea a week.");
	assert.equal(firstLine({ name: "Field notes", description: "Who's in?" }), "You asked to get Field notes. Who's in?");
	assert.equal(
		firstLine({ name: "Field notes" }),
		"You asked to get Field notes. Confirm your email and the next issue lands in your inbox.",
		"no description, no change"
	);
	assert.equal(firstLine({ name: "Tips & <tricks>" }).startsWith("You asked to get Tips &amp; &lt;tricks&gt;."), true, "the name is text");
	const described = getConfirmationContent({ name: "Field notes", description: "One idea a week." });
	assert.equal(paragraphs(described)[2], "Confirm your email and the next issue lands in your inbox.");
	assert.equal(getConfirmationProblem(described), null);

	const saved = getConfirmationContent({ name: "Field notes" });
	assert.deepEqual(getConfirmationContent({ name: "Field notes", description: "One idea a week.", confirmation: saved }), saved);
});

test("the built-in confirmation email sent back by the settings form is still the built-in one; any edit makes it the newsletter's own", () => {
	const newsletter = { name: "Field notes", description: "One idea a week." };
	const builtIn = getConfirmationContent(newsletter);
	assert.equal(isDefaultConfirmation({ ...builtIn, html: `${builtIn.html}\r\n` }, newsletter), true, "spaces around it aside");
	const renamed = { ...newsletter, name: "Weekly notes" };
	assert.equal(isDefaultConfirmation(builtIn, renamed), false);
	assert.equal(isDefaultConfirmation(builtIn, renamed, newsletter), true, "filled in before the rename");

	assert.equal(isDefaultConfirmation({ ...builtIn, html: `${builtIn.html}<p>P.S. Reply to say hi.</p>` }, newsletter), false);
	assert.equal(isDefaultConfirmation({ ...builtIn, previewText: "" }, newsletter), false);
	assert.equal(isDefaultConfirmation({ subject: "", previewText: "", markdown: "" }, newsletter), false);
	assert.equal(isDefaultConfirmation({ ...builtIn, format: "markdown", markdown: builtIn.html }, newsletter), false, "the same words in Markdown are its own");
});

test("newsletters that confirm signups send no welcome email; the others still do", () => {
	const welcome = { enabled: true, subject: "Welcome to Field notes", markdown: "Hello" };
	assert.equal(getWelcomeContent({ requireConfirmation: true, welcome }), null);
	assert.equal(getWelcomeContent({ requireConfirmation: false, welcome }).subject, "Welcome to Field notes");
	assert.equal(getWelcomeContent({ welcome }).subject, "Welcome to Field notes");
});

test("a welcome email switched on with no subject and no content starts from the description; anything written stays", () => {
	const empty = { subject: "", previewText: "", format: "markdown", content: " " };
	const welcome = prefillWelcome(empty, { name: "Field notes", description: "One idea a week" });
	assert.equal(welcome.subject, "Welcome to Field notes");
	assert.equal(welcome.format, "rich", "in the editor");
	assert.deepEqual(paragraphs({ html: welcome.content }), [
		"Thanks for joining Field notes. One idea a week.",
		"The next issue lands in your inbox. Hit reply to say hi.",
	]);
	assert.ok(getWelcomeContent({ welcome: { ...welcome, enabled: true } }), "once saved, it can go out");
	assert.equal(paragraphs({ html: prefillWelcome(empty, { name: "Field notes" }).content })[0], "Thanks for joining Field notes.");
	assert.equal(prefillWelcome({ ...empty, previewText: "Hey" }, { name: "Field notes" }).previewText, "Hey");
	assert.equal(prefillWelcome({ ...empty, format: "rich", content: "<p></p>" }, { name: "Field notes" }).subject, "Welcome to Field notes", "the editor's empty email is empty");

	for (const written of [{ ...empty, subject: "Hi" }, { ...empty, content: "Hello" }, { ...empty, format: "rich", content: "<p>Olá</p>" }]) {
		assert.equal(prefillWelcome(written, { name: "Field notes", description: "One idea a week" }), written);
	}
});

test("the check-your-inbox button opens the subscriber's webmail", () => {
	const webmails = { "googlemail.com": "Gmail", "hotmail.co.uk": "Outlook", "proton.me": "Proton Mail" };
	const inboxes = Object.keys(webmails).map((domain) => getInbox({ email: `reader@${domain}`, fromEmail: "hi@news.example.org" }));
	assert.deepEqual(
		inboxes.map(({ name }) => name),
		Object.values(webmails)
	);
	const [gmail] = inboxes;
	assert.ok(gmail.url.startsWith("https://mail.google.com/mail/u/0/#search/"));
	assert.ok(decodeURIComponent(gmail.url).includes("from:hi@news.example.org in:anywhere"));
	assert.equal(getInbox({ email: "founder@acme.example" }), null);
});
