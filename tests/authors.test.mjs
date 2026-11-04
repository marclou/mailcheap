import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_AUTHORS, MAX_AUTHOR_NAME_LENGTH, describeAuthorPlaces, getAuthorByline, getAuthorProblem, readAuthorName } from "../lib/author-rules.js";
import { formatIssue, getReviewInput, hashReviewInput } from "../lib/content-review.js";
import { renderEmail } from "../lib/render-email.js";
import { activate, addAuthor, anonymous, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent } from "./stubs/ses.mjs";

// Who writes a newsletter's issues (lib/authors.js): a name and an address, maybe a picture. An issue needs one before it
// goes out, its replies go to them, and its emails and page say "By <name>" where the author says they show, never with
// their address. A send keeps the author it started with; a page shows them as they are now.
let app;
let m;
let processed = 0;

const PICTURE = "https://cdn.example.com/jane.webp";
const newsletter = { name: "Field notes", postalAddress: "1 Main St, Paris" };

async function customer(email, settings = {}) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	const fields = { name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on", ...settings };
	user.newsletterId = (await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))))).split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	const rows = [{ email: `reader@${user.slug}.example.org`, status: "active" }];
	await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	return user;
}

async function draft(user, subject = "Issue") {
	const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)))).split("/").at(-1);
	assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body: "<p>Hello readers</p>" })), { ok: true });
	return id;
}

async function runJobs() {
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	}
}

async function runAtItsTime(user, id) {
	const due = new Date();
	await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { scheduledAt: due } });
	return m.scheduling.runScheduledSend({ accountId: String(user.accountId), campaignId: String(id), scheduledAt: due.toISOString() });
}

const load = (user, id) => m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
const page = (id) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const emailsTo = (address, from) => sent.slice(from).filter(({ to }) => String(to).includes(address));
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

// The element of this type in a page, with its props, or null.
function findElement(node, type) {
	if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean) ?? null;
	if (!node || typeof node !== "object") return null;
	return node.type === type ? node : findElement(node.props?.children, type);
}

async function visitIssue(user, id) {
	const { archiveSlug } = await load(user, id);
	const issuePage = await anonymous(() => m.issuePage({ params: Promise.resolve({ slug: user.slug, post: archiveSlug }) }));
	return {
		byline: findElement(issuePage, m.BylineAuthor)?.props.author ?? null,
		jsonLd: JSON.stringify(findElement(issuePage, m.ScriptJsonLd)?.props.data),
	};
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		campaignPage: (await import("../app/(app)/campaigns/[id]/page.js")).default,
		senderPage: (await import("../app/(app)/newsletters/sender/page.js")).default,
		issuePage: (await import("../app/archive/[slug]/p/[post]/page.js")).default,
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		scheduling: await import("../lib/scheduling.js"),
		BylineAuthor: (await import("../components/BylineAuthor.jsx")).default,
		ScriptJsonLd: (await import("../components/ScriptJsonLd.jsx")).default,
		Author: (await import("../models/Author.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("an author's fields", () => {
	test("a name is one line of plain text, 60 characters at most, with no braces or angle brackets", () => {
		assert.equal(MAX_AUTHOR_NAME_LENGTH, 60);
		assert.equal(readAuthorName("  Jane\n\tDoe\u200b "), "Jane Doe");
		assert.deepEqual(getAuthorProblem({ name: readAuthorName("\u200b") }), { field: "name", message: "Add their name" });
		assert.equal(getAuthorProblem({ name: "x".repeat(60) }), null);
		assert.deepEqual(getAuthorProblem({ name: "x".repeat(61) }), { field: "name", message: "60 characters at most" });
		for (const name of ["{{unsubscribe_url}}", "Jane {FNAME}", "<b>Jane</b>", "Jane <jane@example.com>"]) {
			assert.deepEqual(getAuthorProblem({ name }), { field: "name", message: "No braces or angle brackets" }, name);
		}
		assert.equal(getAuthorProblem({ name: "Zoë O'Brien & co." }), null);
	});

	test("an address that takes email, and a picture at an https:// address that can't end an attribute", () => {
		assert.deepEqual(getAuthorProblem({ email: "not-an-email" }), { field: "email", message: "Add a valid email address" });
		assert.equal(getAuthorProblem({ email: "jane@example.com" }), null);
		for (const imageUrl of ["http://cdn.example.com/a.png", "javascript:alert(1)", 'https://cdn.example.com/a.png" onerror="x', "https://a b.example.com"]) {
			assert.deepEqual(getAuthorProblem({ imageUrl }), { field: "imageUrl", message: "Use an https:// image URL" }, imageUrl);
		}
		assert.equal(getAuthorProblem({ imageUrl: PICTURE }), null);
		assert.equal(getAuthorProblem({ imageUrl: "" }), null, "no picture");
	});

	test("readers see their name and picture where they show, never their address", () => {
		const jane = { name: "Jane", email: "jane@example.com", imageUrl: PICTURE, showInEmails: true, showOnWeb: false };
		assert.deepEqual(getAuthorByline(jane, "email"), { name: "Jane", imageUrl: PICTURE });
		assert.equal(getAuthorByline(jane, "web"), null);
		assert.deepEqual(getAuthorByline({ ...jane, imageUrl: undefined, showOnWeb: true }, "web"), { name: "Jane", imageUrl: null });
		assert.equal(getAuthorByline(null, "email"), null, "issues from before authors");

		assert.equal(describeAuthorPlaces({ showOnWeb: true, showInEmails: true }), null);
		assert.equal(describeAuthorPlaces({ showOnWeb: true, showInEmails: false }), "Shown on the web only");
		assert.equal(describeAuthorPlaces({ showOnWeb: false, showInEmails: true }), "Shown in emails only");
		assert.equal(describeAuthorPlaces({ showOnWeb: false, showInEmails: false }), "Not shown to readers");
	});
});

describe("the byline in emails", () => {
	const email = { markdown: "Hello **readers**.", subject: "Hi", previewText: "This week", newsletter, webUrl: "https://notes.example.com/p/hi" };

	test("By and their name above the content, after their picture, in the HTML and the text", () => {
		const { html, text } = renderEmail({ ...email, author: { name: "Tom & Jerry", imageUrl: PICTURE } });
		assert.match(html, /<img src="https:\/\/cdn\.example\.com\/jane\.webp" width="24" height="24" alt=""/);
		assert.match(html, />By Tom &amp; Jerry<\/span>/);
		assert.ok(html.indexOf("By Tom") < html.indexOf("Hello"), "above the content");
		assert.match(html, /Read online/, "next to the link to its page");
		assert.match(text, /^Read online: https:\/\/notes\.example\.com\/p\/hi\n\nBy Tom & Jerry\n\nHello readers\./);

		const html5 = renderEmail({ ...email, format: "html", html: "<html><body><p>Hello</p></body></html>", author: { name: "Jane", imageUrl: null } }).html;
		assert.match(html5, /<body>.*>By Jane<\/span><\/div>.*<p>Hello<\/p>/s, "above an email designed elsewhere too");
		assert.doesNotMatch(html5, /<img/);
	});

	test("a picture that isn't at an https:// address is left out, and emails without an author are as they were", () => {
		const { html } = renderEmail({ ...email, author: { name: "Jane", imageUrl: "javascript:alert(1)" } });
		assert.doesNotMatch(html, /<img/);
		assert.match(html, />By Jane<\/span>/);

		const without = renderEmail(email);
		assert.deepEqual(renderEmail({ ...email, author: null }), without);
		assert.doesNotMatch(without.html, />By /);
		assert.doesNotMatch(renderEmail({ ...email, author: { name: "Jane" }, isWebVersion: true }).html, />By /, "its page shows its own");
	});
});

describe("the content check", () => {
	const campaign = { format: "rich", subject: "Hi", previewText: "News", html: "<p>Hello</p>" };

	test("reads the author's name, never their address", () => {
		const input = getReviewInput({ campaign: { ...campaign, author: { name: "Jane Doe", email: "jane@example.com" } }, newsletter });
		assert.equal(input.author, "Jane Doe");
		assert.ok(!JSON.stringify(input).includes("jane@example.com"));
		assert.match(formatIssue(input, "b0undary"), /^Author: Jane Doe$/m);
		assert.notEqual(hashReviewInput(input), hashReviewInput({ ...input, author: "Someone else" }), "a new name is checked again");
	});

	test("an issue from before authors reads as it did, so its check still counts", () => {
		const input = getReviewInput({ campaign, newsletter });
		assert.equal("author" in input, false);
		assert.equal(hashReviewInput(getReviewInput({ campaign: { ...campaign, author: null }, newsletter })), hashReviewInput(input));
		assert.doesNotMatch(formatIssue(input, "b0undary"), /Author:/);
	});
});

describe("writing and sending", () => {
	test("an issue needs an author before it goes out: the editor suggests the first, and new issues start with the default one", async () => {
		const user = await customer("author-first@example.com");
		const id = await draft(user, "First issue");
		const editor = await as(user, () => m.campaignPage(page(id)));
		assert.deepEqual(editor.props.authors, []);
		assert.equal(editor.props.authorSuggestion.email, "author-first@example.com", "the first author's form starts with their own address");

		const blocked = { error: "Choose an author for this issue" };
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), blocked);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() })), blocked);
		const viaApi = await callApi("POST", `/api/v1/campaigns/${id}/send`, { key: user.key });
		assert.deepEqual([viaApi.status, viaApi.body.error], [422, { code: "send_check_failed", message: "Choose an author for this issue" }]);
		assert.equal((await load(user, id)).status, "draft");

		const added = await as(user, () =>
			m.campaigns.addCampaignAuthor(id, user.newsletterId, { name: "  Jane\nDoe ", email: "Jane@Example.com", imageUrl: "", showOnWeb: true, showInEmails: true })
		);
		assert.deepEqual(
			{ ...added.author, id: undefined, gravatarHash: undefined },
			{ id: undefined, name: "Jane Doe", email: "jane@example.com", imageUrl: null, showOnWeb: true, showInEmails: true, gravatarHash: undefined }
		);
		assert.match(added.author.gravatarHash, /^[a-f0-9]{64}$/, "the menu shows their Gravatar, else their initial");
		assert.equal(String((await load(user, id)).authorId), added.author.id, "the draft is theirs at once");
		assert.deepEqual((await as(user, () => m.campaignPage(page(id)))).props.authors.map(({ id }) => id), [added.author.id]);

		const next = await draft(user, "Second issue");
		assert.equal(String((await load(user, next)).authorId), added.author.id, "a new issue gets the default author, the first one");
		const ada = await as(user, () => m.campaigns.addCampaignAuthor(next, user.newsletterId, { name: "Ada", email: "ada@example.com" }));
		assert.equal(String((await load(user, next)).authorId), ada.author.id, "one added in the editor writes that issue");
		assert.equal(String((await load(user, await draft(user, "Third issue"))).authorId), added.author.id, "the next starts with the default again");
		assert.deepEqual(await as(user, () => m.campaigns.setCampaignAuthor(next, added.author.id)), { ok: true });
		assert.equal(String((await load(user, next)).authorId), added.author.id, "and the one picked from the menu");
		assert.deepEqual(await as(user, () => m.campaigns.setDefaultAuthor(ada.author.id)), { ok: true });
		assert.equal(String((await load(user, await draft(user, "Fourth issue"))).authorId), ada.author.id, "the default the Sender page picks");

		const copy = await callApi("POST", `/api/v1/campaigns/${id}/duplicate`, { key: user.key });
		assert.equal(copy.body.authorId, added.author.id, "a copy keeps its author");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
	});

	test("replies go to the author, and the emails say who wrote them where the author shows, never with their address", async () => {
		const user = await customer("author-replies@example.com");
		const jane = await addAuthor(user, user.newsletterId, { name: "Jane Doe", email: "jane@example.com", imageUrl: PICTURE, showInEmails: true });
		const id = await draft(user);
		const before = sent.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		await runJobs();
		const tested = emailsTo("author-replies@example.com", before)[0];
		const issued = emailsTo("reader@author-replies.example.org", before)[0];
		for (const email of [tested, issued]) {
			assert.equal(email.replyTo, "jane@example.com");
			assert.match(email.html, />By Jane Doe<\/span>/);
			assert.ok(email.html.includes(`src="${PICTURE}"`));
			assert.match(email.text, /By Jane Doe/);
			assert.ok(!`${email.html}${email.text}`.includes("jane@example.com"), "their address is only where replies go");
		}

		await m.Author.updateOne({ accountId: user.accountId, _id: jane._id }, { $set: { showInEmails: false } });
		const quiet = await draft(user, "Quiet issue");
		const from = sent.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(quiet)), { ok: true });
		const [email] = emailsTo("author-replies@example.com", from);
		assert.doesNotMatch(email.html, />By /, "not shown in emails");
		assert.equal(email.replyTo, "jane@example.com", "replies still reach them");
	});

	test("a send keeps the author it started with, and the issue's page shows them as they are now, where they show", async () => {
		const user = await customer("author-page@example.com");
		const jane = await addAuthor(user, user.newsletterId, { name: "Jane Doe", email: "jane@example.com", showInEmails: true, showOnWeb: true });
		const id = await draft(user);
		const before = sent.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		assert.deepEqual((await load(user, id)).sentAuthor, { name: "Jane Doe", email: "jane@example.com", showInEmails: true });

		const renamed = await as(user, () => m.campaigns.editAuthor(String(jane._id), { name: "Jane Smith", email: "smith@example.com", imageUrl: PICTURE }));
		assert.deepEqual([renamed.author.name, renamed.author.email, renamed.author.imageUrl], ["Jane Smith", "smith@example.com", PICTURE]);
		await runJobs();
		const [email] = emailsTo("reader@author-page.example.org", before);
		assert.match(email.html, />By Jane Doe<\/span>/, "its emails on their way stay as they were");
		assert.equal(email.replyTo, "jane@example.com");

		const visit = await visitIssue(user, id);
		assert.deepEqual(visit.byline, { name: "Jane Smith", imageUrl: PICTURE });
		assert.match(visit.jsonLd, /"author":\{"@type":"Person","name":"Jane Smith"/);
		assert.ok(!visit.jsonLd.includes("@example.com"), "never their address");
		const byline = renderToStaticMarkup(createElement(m.BylineAuthor, { author: visit.byline }));
		assert.match(byline, /By <span[^>]*>Jane Smith<\/span>/);
		assert.match(byline, /<img[^>]+src="https:\/\/cdn\.example\.com\/jane\.webp"/);

		await as(user, () => m.campaigns.editAuthor(String(jane._id), { name: "Jane Smith", email: "smith@example.com", showOnWeb: false }));
		assert.equal((await visitIssue(user, id)).byline, null, "not shown on the web: the newsletter's own byline instead");
	});

	test("removing an author keeps them in the database: their scheduled issues hold it, and their drafts need another", async () => {
		const user = await customer("author-remove@example.com");
		const jane = await addAuthor(user, user.newsletterId, { showOnWeb: true });
		const sentId = await draft(user, "Sent issue");
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(sentId, {})), { ok: true });
		await runJobs();
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() })), { ok: true });

		assert.deepEqual(await as(user, () => m.campaigns.removeAuthor(String(jane._id))), {
			error: "A campaign by this author is scheduled or in review: give it another author, or wait until it's out",
		});
		assert.deepEqual(await as(user, () => m.campaigns.unscheduleCampaign(id)), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.removeAuthor(String(jane._id))), { ok: true });
		assert.ok((await m.Author.findOne({ accountId: user.accountId, _id: jane._id }).lean()).deletedAt, "only marked removed");

		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { error: "Choose an author for this issue" });
		assert.equal((await visitIssue(user, sentId)).byline, null, "their name leaves their issues' pages");
		assert.equal((await load(user, await draft(user, "Next"))).authorId, undefined, "nobody to suggest");
		assert.equal((await callApi("GET", "/api/v1/authors", { key: user.key })).body.authors.length, 0);
	});

	test("at its time, an issue whose author was removed since goes back to draft, and one from before authors goes out", async () => {
		const user = await customer("author-late@example.com");
		const jane = await addAuthor(user);
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.scheduleCampaign(id, { scheduledAt: tomorrow() })), { ok: true });
		// As a removal racing the schedule would leave it: removing them refuses while it's scheduled.
		await m.Author.updateOne({ accountId: user.accountId, _id: jane._id }, { $set: { deletedAt: new Date() } });
		assert.deepEqual(await runAtItsTime(user, id), { failed: "Choose an author for this issue", code: "send_check_failed" });
		assert.equal((await load(user, id)).status, "draft");

		const older = await m.Campaign.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			subject: "From before authors",
			previewText: "This week",
			format: "rich",
			html: "<p>Hello readers</p>",
			status: "scheduled",
			scheduledAt: new Date(),
		});
		const before = sent.length;
		assert.equal((await runAtItsTime(user, older._id)).started, true);
		await runJobs();
		const [email] = emailsTo("reader@author-late.example.org", before);
		assert.doesNotMatch(email.html, />By /);
		assert.equal(email.replyTo, "author-late@example.com", "replies go where they went before authors");
	});

	test("an issue prepared before authors goes on as it started: resumed, and sent to more contacts, with replies to the default author", async () => {
		const user = await customer("author-older@example.com");
		await addAuthor(user, user.newsletterId, { name: "Jane Doe", email: "jane@example.com" });
		const prepared = () =>
			m.Campaign.create({
				accountId: user.accountId,
				newsletterId: user.newsletterId,
				subject: "Prepared before authors",
				previewText: "This week",
				format: "rich",
				html: "<p>Hello readers</p>",
				status: "scheduled",
				scheduledAt: new Date(),
			});

		const paused = await prepared();
		assert.equal((await runAtItsTime(user, paused._id)).started, true);
		assert.deepEqual(await as(user, () => m.campaigns.pauseCampaign(String(paused._id))), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.resumeCampaign(String(paused._id))), { ok: true });
		const before = sent.length;
		await runJobs();
		assert.equal((await load(user, paused._id)).status, "sent");
		const [email] = emailsTo("reader@author-older.example.org", before);
		assert.doesNotMatch(email.html, />By /, "no byline: it has no author");
		assert.equal(email.replyTo, "jane@example.com", "replies go to the newsletter's default author");

		const rows = [{ email: "late@author-older.example.org", status: "active" }];
		await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaignToMore(String(paused._id))), { ok: true });
		await runJobs();
		assert.equal(emailsTo("late@author-older.example.org", before).length, 1, "a contact who joined since gets it too");
	});

	test("the newsletter's default author: its first one, else the one its Sender page picks, gets the replies to its own emails", async () => {
		const user = await customer("author-default@example.com", { welcomeSubject: "Welcome", welcomeContent: "Glad you're here." });
		const welcomeReplyTo = async () => {
			const from = sent.length;
			assert.deepEqual(await as(user, () => m.newsletters.sendWelcomeTest(user.newsletterId)), { ok: true });
			return emailsTo("author-default@example.com", from).at(-1).replyTo;
		};
		const senderPage = async () => (await as(user, () => m.senderPage({ searchParams: Promise.resolve({}) }))).props.authors;
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { replyTo: "desk@example.com" } });
		assert.equal(await welcomeReplyTo(), "desk@example.com", "the reply-to from before authors, while it has none");
		assert.equal((await senderPage()).suggestion.email, "desk@example.com", "a first author starts where replies went");

		const jane = await as(user, () => m.campaigns.addDefaultAuthor(user.newsletterId, { name: "Jane Doe", email: "jane@example.com" }));
		const ada = await as(user, () => m.campaigns.addDefaultAuthor(user.newsletterId, { name: "Ada", email: "ada@example.com" }));
		assert.equal(await welcomeReplyTo(), "ada@example.com", "one added on the Sender page becomes the default");
		assert.deepEqual(await as(user, () => m.campaigns.setDefaultAuthor(jane.author.id)), { ok: true });
		assert.equal(await welcomeReplyTo(), "jane@example.com");
		const listed = await callApi("GET", "/api/v1/authors", { key: user.key });
		assert.deepEqual(listed.body.authors.map(({ name, isDefault }) => [name, isDefault]), [["Jane Doe", true], ["Ada", false]]);
		const page = await senderPage();
		assert.deepEqual([page.defaultId, page.list.map(({ name }) => name)], [jane.author.id, ["Jane Doe", "Ada"]]);

		const { fromEmail } = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const fields = { id: user.newsletterId, section: "sender", fromName: "Field notes", fromEmail, postalAddress: "1 Main St, Paris" };
		assert.equal((await as(user, () => m.newsletters.saveNewsletter(null, form(fields)))).ok, true);
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean()).replyTo, "desk@example.com", "saving the page keeps it");

		assert.deepEqual(await as(user, () => m.campaigns.removeAuthor(jane.author.id)), { ok: true });
		assert.equal(await welcomeReplyTo(), "ada@example.com", "a removed default's place goes to the first of the others");
		assert.equal((await senderPage()).defaultId, ada.author.id);
	});
});

describe("the API", () => {
	test("adds, lists, changes and removes a newsletter's authors, with the dashboard's checks", async () => {
		const user = await customer("author-api@example.com");
		const created = await callApi("POST", "/api/v1/authors", { key: user.key, body: { name: "Jane\nDoe", email: "Jane@Example.com" } });
		assert.equal(created.status, 201, JSON.stringify(created.body));
		assert.deepEqual(
			[created.body.name, created.body.email, created.body.imageUrl, created.body.showOnWeb, created.body.showInEmails],
			["Jane Doe", "jane@example.com", null, true, true]
		);
		const refused = async (body) => {
			const response = await callApi("POST", "/api/v1/authors", { key: user.key, body: { name: "Jane", email: "jane@example.com", ...body } });
			assert.deepEqual([response.status, response.body.error.code], [400, "validation_failed"], JSON.stringify(body));
			return response.body.error.message;
		};
		await refused({ name: "x".repeat(61) });
		await refused({ name: "   " });
		assert.equal(await refused({ name: "{{unsubscribe_url}}" }), "name: No braces or angle brackets");
		assert.equal(await refused({ email: "nope" }), "email: Add a valid email address");
		assert.equal(await refused({ imageUrl: "http://cdn.example.com/a.png" }), "imageUrl: Use an https:// image URL");

		const path = `/api/v1/authors/${created.body.id}`;
		assert.equal(created.body.isDefault, true, "a newsletter's first author is its default one");
		const ada = await callApi("POST", "/api/v1/authors", { key: user.key, body: { name: "Ada", email: "ada@example.com" } });
		assert.equal(ada.body.isDefault, false);
		const promoted = await callApi("PATCH", `/api/v1/authors/${ada.body.id}`, { key: user.key, body: { isDefault: true } });
		assert.deepEqual([promoted.status, promoted.body.isDefault], [200, true]);
		assert.equal((await callApi("PATCH", path, { key: user.key, body: { isDefault: false } })).status, 400, "another author takes it instead");
		assert.equal((await callApi("DELETE", `/api/v1/authors/${ada.body.id}`, { key: user.key })).status, 200);
		const changed = await callApi("PATCH", path, { key: user.key, body: { imageUrl: PICTURE, showOnWeb: false } });
		assert.deepEqual([changed.status, changed.body.imageUrl, changed.body.showOnWeb, changed.body.name], [200, PICTURE, false, "Jane Doe"]);
		assert.equal((await callApi("PATCH", path, { key: user.key, body: { imageUrl: "" } })).body.imageUrl, null, "an empty picture removes it");

		const campaign = await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { subject: "Issue", content: "Hello" } });
		assert.equal(campaign.body.authorId, created.body.id, "a new campaign gets the newsletter's author");
		assert.deepEqual(await callApi("DELETE", path, { key: user.key }).then(({ status, body }) => [status, body]), [200, { id: created.body.id, deleted: true }]);
		assert.equal((await callApi("GET", "/api/v1/authors", { key: user.key })).body.authors.length, 0);
		assert.equal((await callApi("PATCH", path, { key: user.key, body: { name: "Back" } })).status, 404, "a removed author stays removed");
	});

	test("an issue's author writes for its newsletter, in its account, and a newsletter has 20 at most", async () => {
		const user = await customer("author-scope@example.com");
		const stranger = await customer("author-stranger@example.com");
		const strangers = await addAuthor(stranger, stranger.newsletterId, { name: "Mallory", email: "mallory@example.com" });
		const second = (await callApi("POST", "/api/v1/newsletters", { key: user.key, body: { name: "Second news", postalAddress: "1 Main St, Paris" } })).body;
		const elsewhere = await addAuthor(user, second.id, { name: "Ada", email: "ada@example.com" });

		const id = (await callApi("POST", "/api/v1/campaigns", { key: user.key, body: { subject: "Issue", content: "Hello" } })).body.id;
		const pick = (author) => callApi("PATCH", `/api/v1/campaigns/${id}`, { key: user.key, body: { author: String(author) } });
		assert.deepEqual((await pick(strangers._id)).body.error, { code: "not_found", message: "Author not found" });
		assert.deepEqual((await pick(elsewhere._id)).body.error, { code: "validation_failed", message: "author: they write for another newsletter" });
		assert.equal((await load(user, id)).authorId, undefined);
		assert.equal((await callApi("PATCH", `/api/v1/authors/${strangers._id}`, { key: user.key, body: { name: "Mine" } })).status, 404);
		assert.equal((await callApi("DELETE", `/api/v1/authors/${strangers._id}`, { key: user.key })).status, 404);
		assert.equal((await m.Author.findOne({ accountId: stranger.accountId, _id: strangers._id }).lean()).name, "Mallory");
		const listed = await callApi("GET", "/api/v1/authors", { key: user.key });
		assert.deepEqual(listed.body.authors, [], "the first newsletter's only");

		await m.Author.insertMany(
			Array.from({ length: MAX_AUTHORS }, (_, index) => ({ accountId: user.accountId, newsletterId: user.newsletterId, name: `Writer ${index}`, email: `writer${index}@example.com` }))
		);
		const over = await callApi("POST", "/api/v1/authors", { key: user.key, body: { name: "One more", email: "more@example.com" } });
		assert.deepEqual([over.status, over.body.error], [409, { code: "conflict", message: "A newsletter has 20 authors at most" }]);
	});
});
