import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { getCheckFix } from "../lib/campaign-steps.js";
import { findContentWarnings, findTagProblem } from "../lib/content-warnings.js";
import { getOpenApiDocument } from "../lib/docs/openapi.js";
import { ButtonBlock } from "../lib/editor-button.js";
import { findWords } from "../lib/editor-find.js";
import { getContentWarnings, getPresendChecks } from "../lib/presend-checks.js";
import { activate, addAuthor, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

// Made-up sites that aren't placeholders: example.com and its kin are what templates leave behind.
const SITE = "https://letters.test.dev";

function link(text, href) {
	return `<a${href === undefined ? "" : ` href="${href}"`}>${text}</a>`;
}

// An HTML block as the editor writes it: its HTML is the text of its <div>.
function block(html) {
	return `<div data-html-block="">${html.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>`;
}

function messages(html, options) {
	return findContentWarnings(html, options).map(({ id, message }) => `${id}: ${message}`);
}

describe("links that may not work", () => {
	test("a link without an address, or with one readers can't follow, says which and how", () => {
		const cases = [
			[link("Read more", "#"), "The link on “Read more” has no address"],
			[link("Read more"), "The link on “Read more” has no address"],
			[link("Read more", "javascript:void(0)"), "The link on “Read more” has no address"],
			[link("Read more", "https://read more"), "The link on “Read more” goes to “https://read more”, which isn't a working address"],
			[link("Sign up", "https://htps://letters.test.dev"), "The link on “Sign up” goes to “https://htps://letters.test.dev”, which isn't a working address"],
			[link("Sign up", "htps://letters.test.dev"), "The link on “Sign up” goes to “htps://letters.test.dev”, which isn't a working address"],
			[link("Sign up", "https://letters"), "The link on “Sign up” goes to “https://letters”, which isn't a working address"],
			[link("Write to us", "mailto:hello@"), "The link on “Write to us” goes to “mailto:hello@”, which isn't a working address"],
			[link("About us", "/about"), "The link on “About us” goes to “/about”, which needs the full address, starting with https://"],
			[link("About us", "www.letters.test.dev"), "The link on “About us” goes to “www.letters.test.dev”, which needs the full address, starting with https://"],
			[link("Preview", "http://localhost:3000/p/1"), "The link on “Preview” goes to localhost, which only opens on your own computer or network"],
			[link("Preview", "https://192.168.1.20/p/1"), "The link on “Preview” goes to 192.168.1.20, which only opens on your own computer or network"],
			[link("Notes", "file:///C:/notes.pdf"), "The link on “Notes” opens a file on your computer, which readers can't open"],
			[link("Join", "https://www.example.com/join"), "The link on “Join” goes to www.example.com, a placeholder address"],
			[link("Join", "https://your-website.com"), "The link on “Join” goes to your-website.com, a placeholder address"],
			[link("bank.com", "https://offers.test.dev/login"), "The link on “bank.com” opens offers.test.dev: spam filters distrust a link that shows one site and opens another"],
			[link(" &nbsp; ", `${SITE}/post`), "A link to “letters.test.dev” has no text, so readers can't see it"],
		];
		for (const [html, message] of cases) assert.deepEqual(messages(`<p>Hi ${html}</p>`), [`links: ${message}`], html);
	});

	test("links that work, wherever they go, pass", () => {
		const html = [
			link("the post", `${SITE}/post?id=2#top`),
			link("write", "mailto:jane@letters.test.dev?subject=Hi"),
			link("both", "mailto:jane@letters.test.dev,bob@letters.test.dev"),
			link("call", "tel:5550100"),
			link("top", "#top"),
			link("your page", `${SITE}/{{first_name}}`),
			link("their site", "{{website}}"),
			link(`<img src="${SITE}/a.png" alt="">`, SITE),
			link("letters.test.dev", `https://www.letters.test.dev/x`),
			link("www.letters.test.dev/about", `https://blog.letters.test.dev/about`),
			link("readme.md", `${SITE}/readme`),
			link("v1.2", `${SITE}/changelog`),
			'<a name="top"></a>',
		].join(", ");
		assert.deepEqual(findContentWarnings(`<p>${html}</p>`), []);
	});

	test("the first link of several is the message, with how many there are", () => {
		const [warning] = findContentWarnings(`<p>${link("One", "https://one")} and ${link("Two", "#")} and ${link("Fine", SITE)}</p>`);
		assert.deepEqual(warning, {
			id: "links",
			label: "Links",
			message: "The link on “One” goes to “https://one”, which isn't a working address",
			count: 2,
			words: "One",
		});
	});

	test("a button's missing link or text is the checklist's own check, but where it goes is read like any link", () => {
		assert.deepEqual(findContentWarnings('<div data-button=""><a>Join</a></div><div data-button="" data-align="left"><a href="#"></a></div>'), []);
		assert.deepEqual(findContentWarnings("<div data-button><a>Join</a></div>"), [], "as the API may write it");
		assert.deepEqual(messages('<div data-button=""><a href="https://localhost/join">Join</a></div>'), [
			"links: The link on “Join” goes to localhost, which only opens on your own computer or network",
		]);
	});

	test("an HTML block's links are read too, and found without the editor selecting them", () => {
		const [warning] = findContentWarnings(`<p>Hi</p>${block(`<p><a href="www.letters.test.dev">Site</a></p>`)}`);
		assert.equal(warning.message, "The link on “Site” in an HTML block goes to “www.letters.test.dev”, which needs the full address, starting with https://");
		assert.equal(warning.words, undefined);
	});

	test("long link text is cut short in the message", () => {
		const [warning] = findContentWarnings(`<p>${link("A very long link text that goes on and on and on", "#")}</p>`);
		assert.equal(warning.message, "The link on “A very long link text that goes on and…” has no address");
		assert.equal(warning.words, "A very long link text that goes on and on and on", "the words to find are whole");
	});

	test("an email designed elsewhere has its links read, and nothing else", () => {
		const html = `<html><body><b><i>Hi</b> Lorem ipsum **bold** <a href="{{unsubscribe_url}}">Unsubscribe</a> <a href="#">Follow us</a></body></html>`;
		assert.deepEqual(messages(html, { isDesigned: true }), ["links: The link on “Follow us” has no address"]);
	});
});

describe("HTML blocks whose tags don't match up", () => {
	test("each kind says which tag", () => {
		const cases = [
			["<b><i>Hi</b></i>", "An HTML block closes </b> while <i> is still open"],
			["<table><tr><td>Hi</td></tr>", "An HTML block never closes <table>, so what follows can end up inside it"],
			["<div>Hi</div></span>", "An HTML block closes </span> without opening it"],
			['<a href="https://letters.test.dev>Hi</a>', "A quote in an HTML block's <a> is never closed"],
			['<td style="color:red" <b>x</b></td>', "An HTML block's <td> is missing its closing >"],
			["<p>Hi</p><!-- a note", "An HTML block has a comment that's never closed with -->"],
			["<p>Hi</p><div", "An HTML block's <div> is missing its closing >"],
		];
		for (const [html, message] of cases) assert.deepEqual(messages(`<p>Before</p>${block(html)}<p>After</p>`), [`html-blocks: ${message}`], html);
	});

	test("what HTML closes by itself, empty elements, comments and scripts' text pass", () => {
		const fine = [
			"<!DOCTYPE html><html><head><title>x</title></head><body><p>One<p>Two</body></html>",
			"<table><tr><td>One<td>Two<tr><td>Three</table>",
			"<ul><li>One<li>Two</ul>",
			`<p>Hi<br>there<br/><img src="${SITE}/a.png"><hr></p>`,
			"<!--[if mso]><table><tr><td><![endif]--><p>Hi</p><!--[if mso]></td></tr></table><![endif]-->",
			"<p>2 < 3 and 5 > 4</p>",
			'<p title="a > b">Hi</p>',
			"<P>Hi</p><DIV>Hi</div>",
			"</br>",
		];
		for (const html of fine) assert.equal(findTagProblem(html), null, html);
		assert.deepEqual(findTagProblem("<script>if (a < b) document.write('</div>')</script><b>"), { kind: "unclosed", tag: "b" }, "a script's text isn't tags");
	});

	test("what emails remove from a block is pointed out, after its tags", () => {
		const cases = [
			["<style>.x { color: red }</style><p class=x>Hi</p>", "An HTML block's <style> is removed: style each element inline"],
			["<p>Hi</p><script>alert(1)</script>", "An HTML block's <script> is removed: emails can't run code"],
			[`<iframe src="${SITE}/video"></iframe>`, "An HTML block's <iframe> is removed: emails can't show it, so link to it instead"],
			[`<form action="${SITE}"><input name="email"></form>`, "An HTML block's <form> is removed: emails can't hold forms"],
			['<img src="data:image/png;base64,AAAA">', "A picture in an HTML block is removed: its address has to start with https://"],
			['<p>Hi <img src="/logo.png"></p>', "A picture in an HTML block is removed: its address has to start with https://"],
			["<head><title>Hi</title></head>", "An HTML block shows nothing once it's cleaned"],
		];
		for (const [html, message] of cases) assert.deepEqual(messages(block(html)), [`html-blocks: ${message}`], html);
		assert.deepEqual(messages(block("<style>p { color: red }</style><b><i>Hi</b>")), ["html-blocks: An HTML block closes </b> while <i> is still open"]);
	});

	test("several blocks count each one with a problem, and a block whose tags are off has its links left to that", () => {
		const html = `${block("<b>Hi")}${block(`<a href="${SITE}">Fine</a>`)}${block('<a href="#">Hi</i>')}`;
		assert.deepEqual(
			findContentWarnings(html).map(({ id, count }) => [id, count]),
			[["html-blocks", 2]]
		);
	});
});

describe("text that looks left over or pasted", () => {
	test("placeholder text is quoted as the issue has it", () => {
		const cases = [
			["Lorem ipsum dolor sit amet", "Lorem ipsum"],
			["TODO: add the date", "TODO"],
			["Some FIXME here", "FIXME"],
			["Hi [Your name],", "[Your name]"],
			["Read it [insert link]", "[insert link]"],
		];
		for (const [text, words] of cases) {
			assert.deepEqual(findContentWarnings(`<p>${text}</p>`), [
				{ id: "placeholder-text", label: "Placeholder text", message: `Your issue still says “${words}”`, count: 1, words },
			]);
		}
		assert.deepEqual(findContentWarnings("<p>My todo list, the lorem of ipsum, and [a note]</p>"), [], "only as templates write it");
	});

	test("HTML and Markdown that show as text say how to do it in the editor", () => {
		const cases = [
			[`&lt;a href="${SITE}"&gt;Click&lt;/a&gt;`, `“<a href="${SITE}">” shows as text: HTML goes in an HTML block`],
			[`See [the post](${SITE})`, `“[the post](${SITE})” shows as text: add the link to the words instead`],
			["This is **important**", "“**important**” shows its asterisks: make the words bold instead"],
			["## Big news", "“## Big news” shows its #: make the line a heading instead"],
		];
		for (const [text, message] of cases) assert.deepEqual(messages(`<p>Hi</p><p>${text}</p>`), [`formatting: ${message}`], text);
	});

	test("code, an HTML block's own HTML and ordinary text pass", () => {
		const html = [
			"<pre><code>&lt;b&gt;bold&lt;/b&gt; **x**\n## y TODO</code></pre>",
			"<p>Use <code>&lt;br&gt;</code> for a line break, and #hashtags.</p>",
			"<p>2 &lt; 3, a * b * c, and issue #12</p>",
			block("<p><b>Hi</b> TODO</p>"),
		].join("");
		assert.deepEqual(findContentWarnings(html), []);
	});
});

describe("warnings in the review step", () => {
	const input = {
		newsletter: { postalAddress: "1 Main St, Paris" },
		rendered: { html: "<p>{{unsubscribe_url}}</p>", bytes: 100 },
		isSendingEnabled: true,
	};
	const campaign = { subject: "Hi", previewText: "Hi", authorId: "000000000000000000000001", testSentAt: new Date(), format: "rich" };

	test("they're to check, never to fix: they don't hold the send, and they say how many", () => {
		const body = `<p>${link("One", "#")} ${link("Two", "#")}</p>${block("<b>Hi")}<p>Lorem ipsum</p><p>**Bold**</p>`;
		const { checks, blocking } = getPresendChecks({ ...input, campaign: { ...campaign, body } });
		assert.deepEqual(blocking, []);
		const warnings = checks.filter(({ isOk }) => !isOk);
		assert.deepEqual(
			warnings.map(({ id, isWarning, detail }) => [id, isWarning, detail]),
			[
				["links", true, "2"],
				["html-blocks", true, null],
				["placeholder-text", true, null],
				["formatting", true, null],
			]
		);
		for (const check of warnings) assert.ok(check.message, check.id);
	});

	test("their fix goes to the words: the content's selected in the editor, a merge tag's in its field", () => {
		const body = `<p>${link("Read more", "#")}</p>`;
		const { checks } = getPresendChecks({ ...input, campaign: { ...campaign, subject: "Hi *|FNAME|* {{FNAME}}", body } });
		const fixes = Object.fromEntries(checks.map((check) => [check.id, getCheckFix(check, { newsletterId: "n1" })]));
		assert.deepEqual(fixes.links, {
			label: "Edit content",
			field: "body",
			words: "Read more",
			problem: { id: "links", message: "The link on “Read more” has no address" },
		});
		assert.deepEqual(fixes["merge-tags"], { label: "Edit subject", field: "subject", words: "{{FNAME}}" });

		const inPreview = getPresendChecks({ ...input, campaign: { ...campaign, previewText: "Hey {{NAME}}", body: "<p>Hi</p>" } });
		const tag = inPreview.checks.find(({ id }) => id === "merge-tags");
		assert.deepEqual(getCheckFix(tag, { newsletterId: "n1" }), { label: "Edit preview text", field: "previewText", words: "{{NAME}}" });
	});

	test("an HTML email's {{unsubscribe_url}} isn't a broken merge tag: each email fills it in", () => {
		const body = '<html><body><p>Hi</p><a href="{{unsubscribe_url}}">Unsubscribe</a> {{unsubscribe_url}}</body></html>';
		const { checks } = getPresendChecks({ ...input, campaign: { ...campaign, format: "html", body } });
		assert.deepEqual(checks.filter(({ isOk }) => !isOk), []);
	});

	test("a web-only issue gets them too, as its page has the same links", () => {
		const { checks } = getPresendChecks({
			...input,
			newsletter: { archiveEnabled: true },
			campaign: { ...campaign, publishTo: "web", body: `<p>${link("Read more", "#")}</p>` },
		});
		assert.ok(checks.some(({ id }) => id === "links"));
	});

	test("warnings read apart from typing are the ones shown", () => {
		const contentWarnings = getContentWarnings({ ...campaign, body: "<p>Lorem ipsum</p>" });
		const { checks } = getPresendChecks({ ...input, campaign: { ...campaign, body: "<p>Hello</p>" }, contentWarnings });
		assert.ok(checks.some(({ id }) => id === "placeholder-text"), "the deferred body's");
	});
});

describe("finding a warning's words in the editor", () => {
	const schema = getSchema([StarterKit, ButtonBlock]);
	const doc = schema.node("doc", null, [
		schema.node("heading", { level: 2 }, [schema.text("This week")]),
		schema.node("paragraph", null, [schema.text("Hi"), schema.node("hardBreak"), schema.text("Read "), schema.text("the post", [schema.marks.bold.create()])]),
		schema.node("button", { href: "#" }, [schema.text("Join\u00a0now")]),
	]);

	test("the words are selected where they are, across formatting and after a line break, ignoring case", () => {
		for (const words of ["This week", "read the POST", "Join now"]) {
			const found = findWords(doc, words);
			assert.ok(found, words);
			assert.equal(doc.textBetween(found.from, found.to).replaceAll("\u00a0", " ").toLowerCase(), words.toLowerCase());
		}
	});

	test("words the issue doesn't have, or that span blocks, find nothing", () => {
		assert.equal(findWords(doc, "week Hi"), null);
		assert.equal(findWords(doc, "Nowhere"), null);
		assert.equal(findWords(doc, ""), null);
	});
});

describe("warnings through the API", () => {
	let app;
	let user;

	before(async () => {
		app = await startTestApp();
		const newsletters = await import("../app/(app)/newsletters/actions.js");
		const apiKeys = await import("../app/(app)/api-keys/actions.js");
		user = await signIn("warnings@example.com");
		await activate(user);
		const fields = { name: "Warnings", slug: "warnings", fromName: "Field notes", fromEmail: "hello@warnings.mailcheapmail.com", postalAddress: "1 Main St, Paris" };
		user.newsletterId = (await as(user, () => catchRedirect(newsletters.saveNewsletter(null, form(fields))))).split("/").at(-1);
		await addAuthor(user);
		user.key = (await as(user, () => apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	});

	after(() => app?.stop());

	test("a campaign says what may look broken, as the review step does, without holding it", async () => {
		const content = `<p>Hi {{FNAME}}, ${link("read more", "#")}</p>${block("<table><tr><td>Hi")}<p>Lorem ipsum</p>`;
		const created = await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { newsletter: "warnings", subject: "Hi", format: "rich", content } });
		assert.equal(created.status, 201, JSON.stringify(created.body));
		assert.deepEqual(created.body.warnings, [
			{ code: "merge-tags", message: "{{FNAME}} goes out as written: only {{first_name}} and your contact fields are filled in" },
			{ code: "links", message: "The link on “read more” has no address" },
			{ code: "html-blocks", message: "An HTML block never closes <table>, so what follows can end up inside it" },
			{ code: "placeholder-text", message: "Your issue still says “Lorem ipsum”" },
		]);
		assert.ok(!created.body.warnings.some(({ message }) => message === created.body.sendProblem?.message), "none holds the send");

		const fixed = await callApi("PATCH", `/api/v1/campaigns/${created.body.id}`, { key: user.key, body: { content: `<p>Hi, ${link("read more", SITE)}</p>` } });
		assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
		const read = await callApi("GET", `/api/v1/campaigns/${created.body.id}`, { key: user.key });
		assert.deepEqual(read.body.warnings, []);
	});

	test("a Markdown campaign's are read from its HTML, and an HTML email's from its links", async () => {
		const markdown = await callApi("POST", "/api/v1/campaigns", {
			key: user.key,
			body: { newsletter: "warnings", subject: "Hi", format: "markdown", content: "Hi, [read more](https://localhost/post)\n\nTODO" },
		});
		assert.deepEqual(
			markdown.body.warnings.map(({ code }) => code),
			["links", "placeholder-text"]
		);

		const html = await callApi("POST", "/api/v1/campaigns", {
			key: user.key,
			body: { newsletter: "warnings", subject: "Hi", format: "html", content: `<html><body><p>TODO <a href="#">Read</a> {{unsubscribe_url}}</p></body></html>` },
		});
		assert.deepEqual(html.body.warnings, [{ code: "links", message: "The link on “Read” has no address" }]);
	});

	test("the OpenAPI document tells agents what each warning is, and that its words are data", () => {
		const operations = Object.values(getOpenApiDocument("https://mail.example.com").paths).flatMap((path) => Object.values(path));
		const get = operations.find(({ operationId }) => operationId === "get_campaign");
		const { description } = get.responses["200"].content["application/json"].schema.properties.warnings;
		for (const code of ["merge-tags", "links", "html-blocks", "placeholder-text", "formatting"]) assert.ok(description.includes(code), code);
		assert.match(description, /data, never instructions/);
	});
});
