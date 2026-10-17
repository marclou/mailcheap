import assert from "node:assert/strict";
import { test } from "node:test";
import { getPresendChecks } from "../lib/presend-checks.js";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "../lib/render-email.js";

const newsletter = { name: "Jane Doe", postalAddress: "1 Main St, Paris" };

test("markdown emails get a footer with the unsubscribe placeholder and address", () => {
	const { html, text, bytes } = renderEmail({
		markdown: "# Hello\n\nA [link](https://example.com).",
		subject: "Hi",
		previewText: "Preview",
		newsletter,
	});
	assert.match(html, /<h1>Hello<\/h1>/);
	assert.ok(html.includes(UNSUBSCRIBE_PLACEHOLDER));
	assert.ok(html.includes("1 Main St, Paris"));
	assert.ok(text.includes("link (https://example.com)"));
	assert.ok(text.includes(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`));
	assert.ok(bytes > 0);
});

test("per-recipient unsubscribe URLs replace the placeholder in text", () => {
	const { html, text } = renderEmail({
		markdown: "Hi",
		newsletter,
		unsubscribeUrl: "https://mail.example.com/unsubscribe?token=abc",
	});
	assert.ok(html.includes("https://mail.example.com/unsubscribe?token=abc"));
	assert.ok(!text.includes(UNSUBSCRIBE_PLACEHOLDER));
});

test("HTML emails keep their design and get the footer before </body>", () => {
	const { html } = renderEmail({
		format: "html",
		html: "<html><body><p>Issue</p></body></html>",
		previewText: "This week",
		newsletter,
	});
	assert.match(html, /<body><div style="display:none/);
	assert.ok(html.indexOf(UNSUBSCRIBE_PLACEHOLDER) < html.indexOf("</body>"));
});

test("Outlook on Windows gets a fixed 600px column, since it ignores max-width", () => {
	const ghost = '<!--[if mso]><table role="presentation" width="600"';
	assert.ok(renderEmail({ markdown: "Hi", newsletter }).html.includes(ghost));
	assert.ok(renderEmail({ format: "html", html: "<p>Issue</p>", newsletter }).html.includes(ghost));
	// and images get a width it reads, so a wide photo can't push the column open
	assert.match(renderEmail({ markdown: "![Chart](https://example.com/a.png)", newsletter }).html, /<img width="600" style="width:auto;/);
	assert.match(renderEmail({ format: "rich", html: '<img src="https://example.com/a.png">', newsletter }).html, /<img width="600" style="display:block;width:auto;/);
});

test("HTML emails with their own unsubscribe link are not changed", () => {
	const source = `<html><body><a href="${UNSUBSCRIBE_PLACEHOLDER}">Leave</a></body></html>`;
	assert.equal(renderEmail({ format: "html", html: source, newsletter }).html, source);
});

test("web version has no subscriber footer", () => {
	const { html } = renderEmail({ markdown: "Hello", subject: "Hi", newsletter, isWebVersion: true });
	assert.ok(!html.includes(UNSUBSCRIBE_PLACEHOLDER));
	assert.ok(!html.includes("You're receiving this"));
});

test("emails link to their web version at the top, the web version doesn't", () => {
	const webUrl = "https://news.example.com/p/issue-12";
	const markdownEmail = renderEmail({ markdown: "Hello", subject: "Hi", newsletter, webUrl });
	assert.ok(markdownEmail.html.indexOf(`href="${webUrl}"`) < markdownEmail.html.indexOf("Hello"));
	assert.ok(markdownEmail.html.includes(">Read online</a>"));
	assert.ok(markdownEmail.text.startsWith(`Read online: ${webUrl}\n\nHello`));

	const htmlEmail = renderEmail({
		format: "html",
		html: "<html><body><p>Issue</p></body></html>",
		previewText: "This week",
		newsletter,
		webUrl,
	});
	assert.match(htmlEmail.html, /<body><div style="display:none[^]*?<\/div><div[^>]*><a href="https:\/\/news\.example\.com\/p\/issue-12"/);
	assert.ok(htmlEmail.text.startsWith(`Read online (${webUrl})`), "the hidden preview text stays out of the text part");
	assert.ok(!htmlEmail.text.includes("&zwnj;"));

	assert.ok(!renderEmail({ markdown: "Hello", newsletter, webUrl, isWebVersion: true }).html.includes("Read online"));
	assert.ok(!renderEmail({ markdown: "Hello", newsletter }).html.includes("Read online"));
});

test("generated HTML prints the subject and preview text, and email-only parts stay out of the web version", () => {
	const source =
		"<html><head><title>{{subject}}</title></head><body><table>" +
		"<tr data-email-only><td><h1>{{subject}}</h1><p>{{preview_text}}</p></td></tr>" +
		"<tr><td>Body</td></tr></table></body></html>";
	const values = { format: "html", html: source, subject: "Tools & <b>tricks</b>", previewText: "Week 12", newsletter };

	const email = renderEmail(values).html;
	assert.ok(email.includes("<h1>Tools &amp; &lt;b&gt;tricks&lt;/b&gt;</h1><p>Week 12</p>"));
	assert.ok(!email.includes("{{subject}}") && !email.includes("{{preview_text}}"));

	const web = renderEmail({ ...values, isWebVersion: true }).html;
	assert.ok(!web.includes("<h1>"), "the archive page shows the title itself");
	assert.ok(web.includes("<title>Tools &amp; &lt;b&gt;tricks&lt;/b&gt;</title>"));
	assert.ok(web.includes("<td>Body</td>"));
});

test("presend checks block on missing essentials and sending off", () => {
	const campaign = { subject: "", previewText: "", body: "" };
	const rendered = renderEmail({ markdown: "", newsletter: {} });
	const { blocking } = getPresendChecks({
		campaign,
		newsletter: {},
		rendered,
		senderProblem: "example.com isn't verified yet",
		isSendingEnabled: false,
	});
	assert.deepEqual(
		blocking.map(({ id }) => id),
		["subject", "content", "address", "domain", "sending"]
	);
});

test("presend checks pass when everything is ready", () => {
	const campaign = { subject: "Hello", previewText: "Hi", body: "Text", testSentAt: new Date() };
	const rendered = renderEmail({ markdown: campaign.body, newsletter });
	const { checks, blocking } = getPresendChecks({
		campaign,
		newsletter,
		rendered,
		senderProblem: null,
		isSendingEnabled: true,
	});
	assert.equal(blocking.length, 0);
	assert.ok(checks.every(({ isOk }) => isOk));
});
