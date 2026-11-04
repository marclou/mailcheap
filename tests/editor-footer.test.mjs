import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FooterEmail from "../components/FooterEmail.jsx";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "../lib/render-email.js";
import { TeamRoleContext } from "../lib/use-team-role.js";

// The footer every email ends with, under the issue in the campaign editor (components/FooterEmail.jsx): the email's own
// lines, which can't be removed there, and for the newsletter's admins, links to edit its name and postal address in its
// settings, in a new tab.
const newsletter = { _id: "6650f0c2a1b2c3d4e5f60718", name: "Field notes", postalAddress: "1 Main St, Springfield" };

function renderFooter({ role = "owner", ...changes } = {}) {
	const footer = createElement(FooterEmail, { newsletter: { ...newsletter, ...changes } });
	return renderToStaticMarkup(createElement(TeamRoleContext, { value: role }, footer));
}

function readText(html) {
	return html
		.replace(/<[^>]+>/g, " ")
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replace(/\s+/g, " ")
		.trim();
}

function readParagraphs(html) {
	return [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map(([, content]) => readText(content));
}

function readLinks(html) {
	return [...html.matchAll(/<a\s([^>]*)>(.*?)<\/a>/gs)].map(([, attributes, label]) => ({
		label: readText(label),
		href: attributes.match(/href="([^"]*)"/)[1],
		target: attributes.match(/target="([^"]*)"/)?.[1] ?? null,
	}));
}

test("the editor's footer has the email footer's lines", () => {
	const email = renderEmail({ format: "rich", html: "<p>Hi</p>", newsletter });
	const reason = "You're receiving this because you subscribed to Field notes.";
	assert.ok(email.html.includes(`${reason} <a `), "Unsubscribe follows the first sentence, on its line");
	assert.match(email.html, />Unsubscribe<\/a><br>1 Main St, Springfield/);
	// Plain text keeps the unsubscribe address on a line of its own.
	assert.deepEqual(email.text.split("\n").slice(-4), ["—", reason, `Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`, "1 Main St, Springfield"]);

	const footer = renderFooter();
	assert.deepEqual(readParagraphs(footer), [`${reason} Unsubscribe`, "1 Main St, Springfield"]);
	assert.ok(readText(footer).startsWith(`${reason} Unsubscribe 1 Main St, Springfield Added to every email`));
});

test("a name is escaped in the email and shown as it is in the editor", () => {
	const name = "Tom & Jerry <weekly>";
	const { html } = renderEmail({ format: "rich", html: "<p>Hi</p>", newsletter: { ...newsletter, name } });
	assert.ok(html.includes("You're receiving this because you subscribed to Tom &amp; Jerry &lt;weekly&gt;. <a "));
	assert.ok(readText(renderFooter({ name })).startsWith(`You're receiving this because you subscribed to ${name}.`));
});

test("the newsletter's admins get links to edit its name and address, in a new tab", () => {
	const links = [
		{ label: "Edit name", href: `/newsletters/${newsletter._id}?next=%2Fnewsletters%2Fgeneral`, target: "_blank" },
		{ label: "Edit address", href: "/newsletters/sender#postal-address", target: "_blank" },
	];
	assert.deepEqual(readLinks(renderFooter({ role: "owner" })), links);
	assert.deepEqual(readLinks(renderFooter({ role: "admin" })), links);

	const member = renderFooter({ role: "member" });
	assert.deepEqual(readLinks(member), []);
	assert.ok(readText(member).includes("Unsubscribe 1 Main St, Springfield Added to every email"));
});

test("without a postal address, the footer links to adding one", () => {
	const html = renderFooter({ postalAddress: "" });
	assert.ok(readText(html).includes("Unsubscribe Added to every email"));
	assert.deepEqual(readLinks(html)[1], { label: "Add a postal address", href: "/newsletters/sender#postal-address", target: "_blank" });
});
