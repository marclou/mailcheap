import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderIssueBody } from "../lib/archive-content.js";
import { getIssueSeo, getShareCardUrl } from "../lib/archive-seo.js";
import { WEB_CHANGE_REFUSED } from "../lib/content-review-codes.js";
import { listImageUrls } from "../lib/thumbnail.js";
import { WEB_CARD, getWebContent, getWebDescription, getWebImageUrl, getWebTitle, isWebImage } from "../lib/web-page.js";
import { activate, as, callApi, catchRedirect, form, mockOpenAI, openaiRequests, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";

// An issue's page on the website (lib/web-page.js): the email's subject, preview text, content and first picture until
// the page gets its own, a draft's from the send step and a sent issue's from its editor, which leaves the emails as sent.

describe("what an issue's page shows", () => {
	const email = { subject: "Club news", previewText: "This week", format: "rich", html: "<p>Email</p>", thumbnailUrl: "https://cdn.example.com/one.png" };

	test("the email's, until the page has its own", () => {
		assert.equal(getWebTitle(email), "Club news");
		assert.equal(getWebDescription(email), "This week");
		assert.deepEqual(getWebContent(email), { format: "rich", html: "<p>Email</p>", markdown: undefined });
		assert.equal(getWebImageUrl(email), "https://cdn.example.com/one.png");

		const page = { ...email, web: { title: "On the web", description: "Read it here", image: "https://cdn.example.com/two.png", format: "html", html: "<html>Page</html>" } };
		assert.equal(getWebTitle(page), "On the web");
		assert.equal(getWebDescription(page), "Read it here");
		assert.deepEqual(getWebContent(page), { format: "html", html: "<html>Page</html>", markdown: undefined });
		assert.equal(getWebImageUrl(page), "https://cdn.example.com/two.png");
		assert.equal(getWebImageUrl({ ...email, web: { image: WEB_CARD } }), null, "the drawn card");
		assert.equal(getWebImageUrl({ subject: "No picture" }), null);
	});

	test("a picture picked for it is an https:// address, the card, or nothing", () => {
		for (const value of ["", WEB_CARD, "https://cdn.example.com/a.png", "https://images.example.com/path/to/a.webp?w=1200"]) assert.ok(isWebImage(value), value);
		for (const value of ["http://cdn.example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "/email/a.png", "https://user:pass@example.com/a.png", "cards", `https://example.com/${"a".repeat(2000)}`]) {
			assert.ok(!isWebImage(value), value);
		}
	});

	test("the pictures that can stand for an issue: each once, in order, without icons and tracking pixels", () => {
		const html = [
			'<img src="https://cdn.example.com/logo.png" width="48">',
			'<img src="https://cdn.example.com/one.png" width="600">',
			'<img src="https://track.example.com/pixel.gif">',
			'<img src="https://cdn.example.com/one.png" width="600">',
			'<img src="https://cdn.example.com/two.png">',
			'<img src="https://cdn.example.com/three.png">',
		].join("");
		assert.deepEqual(listImageUrls({ format: "html", html }, 2), ["https://cdn.example.com/one.png", "https://cdn.example.com/two.png"]);
		assert.deepEqual(listImageUrls({ format: "html", html }, 5), ["https://cdn.example.com/one.png", "https://cdn.example.com/two.png", "https://cdn.example.com/three.png"]);
		assert.deepEqual(listImageUrls({ format: "html", html }), ["https://cdn.example.com/one.png"], "the first, by default");
	});

	test("a page edited after it went out tells search engines and link previews", () => {
		const newsletter = { slug: "club", name: "Club", theme: null, socialLinks: [] };
		const issue = { archiveSlug: "club-news", subject: "Club news", sentAt: new Date("2026-10-28T09:00:00Z") };
		const editedAt = new Date("2026-11-02T10:00:00Z");
		assert.doesNotMatch(getShareCardUrl(newsletter, issue, "https://mail.example.com"), /[?&]v=/);
		assert.match(getShareCardUrl(newsletter, { ...issue, editedAt }, "https://mail.example.com"), /[?&]v=[a-z0-9]+$/, "a new card past the cached one");
		const seo = getIssueSeo(newsletter, { ...issue, editedAt }, "https://mail.example.com");
		assert.equal(seo.jsonLd.dateModified, editedAt.toISOString());
		assert.equal(seo.jsonLd.datePublished, issue.sentAt.toISOString());
		assert.equal(seo.metadata.openGraph.modifiedTime, editedAt.toISOString());
		assert.equal(getIssueSeo(newsletter, issue, "https://mail.example.com").jsonLd.dateModified, issue.sentAt.toISOString());
	});
});

const VERDICTS = {
	clean: { verdict: "clean", categories: [], reasons: [], confidence: 0.95, tips: [] },
	phishing: { verdict: "violation", categories: ["phishing"], reasons: ["Asks readers to log in on a fake bank page"], confidence: 0.97, tips: [] },
};

describe("an issue's page on the website", () => {
	let app;
	let m;
	let answer = "clean";

	before(async () => {
		app = await startTestApp({ OPENAI_MODERATION_API_KEY: "sk-test-moderation" });
		mockOpenAI(({ path }) => {
			if (path === "/moderations") return { model: "omni-moderation-latest", results: [{ category_scores: { sexual: 0.01 } }] };
			const text = JSON.stringify(VERDICTS[answer]);
			return { model: "gpt-6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] };
		});
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			campaignPage: await import("../app/(app)/campaigns/[id]/page.js"),
			campaignsPage: await import("../app/(app)/campaigns/(list)/page.js"),
			webPage: await import("../app/(app)/campaigns/[id]/web/page.js"),
			TableCampaigns: (await import("../components/TableCampaigns.jsx")).default,
			archive: await import("../lib/archive-data.js"),
			review: await import("../lib/content-review.js"),
			TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
			Campaign: (await import("../models/Campaign.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
			Upload: (await import("../models/Upload.js")).default,
		};
	});

	after(() => app?.stop());

	async function customer(email) {
		const user = await signIn(email);
		await activate(user);
		user.slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(
				m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, fromEmail: `hello@${user.slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" }))
			)
		);
		user.newsletterId = url.split("/").at(-1);
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { archiveEnabled: true } });
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
		return user;
	}

	async function draft(user, body, subject = "Club news") {
		const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)))).split("/").at(-1);
		assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "This week", body })), { ok: true });
		return id;
	}

	// On the website only, which puts it there at once.
	async function publish(user, body, subject) {
		const id = await draft(user, body, subject);
		assert.deepEqual(await as(user, () => m.campaigns.setCampaignPublishTo(id, "web")), { ok: true });
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		return id;
	}

	const load = (user, id) => m.Campaign.findOne({ accountId: user.accountId, _id: id }).select("+webReview").lean();
	const upload = (user, url) => m.Upload.create({ accountId: user.accountId, url, pathname: `accounts/${user.accountId}/images/${url.split("/").at(-1)}`, contentType: "image/png", bytes: 100 });
	const patch = (user, id, body) => callApi("PATCH", `/api/v1/campaigns/${id}/archive`, { key: user.key, body });

	async function shown(user, id) {
		const campaign = await load(user, id);
		const newsletter = await m.archive.getArchiveNewsletter(user.slug);
		return m.archive.getArchiveIssue(newsletter, campaign.archiveSlug);
	}

	test("a draft's page takes a title, a description and a picture of its own, which its send's check reads", async () => {
		const user = await customer("web-draft@example.com");
		const id = await draft(user, '<p>Hi</p><img src="https://cdn.example.com/one.png" width="600"><img src="https://cdn.example.com/two.png" width="600">');

		const saved = await patch(user, id, { title: "On the web", description: "Read it here", image: "https://cdn.example.com/two.png" });
		assert.equal(saved.status, 200, JSON.stringify(saved.body));
		assert.deepEqual(saved.body.web, { title: "On the web", description: "Read it here", image: "https://cdn.example.com/two.png", edited: false });
		const detail = (await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key })).body;
		assert.deepEqual(detail.web, { title: "On the web", description: "Read it here", image: "https://cdn.example.com/two.png", edited: false, format: null, content: null });
		assert.equal(detail.subject, "Club news", "the email keeps its subject");

		const error = async (body, status, code) => {
			const response = await patch(user, id, body);
			assert.equal(response.status, status, JSON.stringify(response.body));
			assert.equal(response.body.error.code, code);
			return response.body.error.message;
		};
		await error({ image: "http://cdn.example.com/two.png" }, 400, "validation_failed");
		await error({ image: "javascript:alert(1)" }, 400, "validation_failed");
		assert.match(await error({ content: "<p>Web only words</p>" }, 409, "conflict"), /once it's on the website/);
		assert.match(await error({ format: "rich" }, 400, "validation_failed"), /send content with it/);

		assert.equal((await patch(user, id, { image: WEB_CARD })).body.web.image, WEB_CARD);
		assert.equal((await patch(user, id, { title: "" })).body.web.title, null, "empty: the subject again");
		assert.deepEqual(await as(user, () => m.campaigns.updateWebPage(id, { title: "From the dashboard" })), { ok: true });

		const campaign = await load(user, id);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const input = m.review.getReviewInput({ campaign, newsletter });
		assert.equal(input.webTitle, "From the dashboard");
		assert.equal(input.webDescription, "Read it here");
		assert.match(m.review.formatIssue(input, "b0undary"), /Title on its web page: From the dashboard\nDescription on its web page: Read it here/);
		const { web, ...withoutPage } = campaign;
		assert.ok(web);
		assert.equal(m.review.formatIssue(m.review.getReviewInput({ campaign: withoutPage, newsletter }), "b0undary").includes("web page"), false);
	});

	test("once it's out, its page changes without its emails, its picture and dates following", async () => {
		answer = "clean";
		const user = await customer("web-sent@example.com");
		const id = await publish(user, '<p>First words</p><img src="https://cdn.example.com/one.png" width="600">');
		const before = await load(user, id);
		assert.equal(before.status, "sent");
		assert.equal((await shown(user, id)).thumbnailUrl, "https://cdn.example.com/one.png");

		const response = await patch(user, id, { title: "Club news, updated", content: '<p>New words</p><img src="https://cdn.example.com/new.png" width="600">' });
		assert.equal(response.status, 200, JSON.stringify(response.body));
		assert.deepEqual(response.body.web, { title: "Club news, updated", description: null, image: null, edited: true });
		const after = await load(user, id);
		assert.equal(after.html, before.html, "the email's content stays as it went out");
		assert.equal(after.subject, "Club news");
		assert.equal(after.web.format, "rich");
		assert.ok(after.web.editedAt instanceof Date);
		assert.equal(after.webReview.outcome, "allow");

		const issue = await shown(user, id);
		assert.equal(issue.subject, "Club news, updated");
		assert.equal(issue.thumbnailUrl, "https://cdn.example.com/new.png", "its new first picture");
		const body = renderIssueBody(issue).html;
		assert.ok(body.includes("New words") && !body.includes("First words"), body);
		const newsletter = await m.archive.getArchiveNewsletter(user.slug);
		assert.equal(getIssueSeo(newsletter, issue).jsonLd.dateModified, after.web.editedAt.toISOString());

		const detail = (await callApi("GET", `/api/v1/campaigns/${id}`, { key: user.key })).body;
		assert.equal(detail.web.format, "rich");
		assert.match(detail.web.content, /New words/);
		assert.match(detail.content, /First words/, "content is the email's");

		const elsewhere = await patch(user, id, { image: "https://cdn.example.com/picked.png" });
		assert.equal(elsewhere.status, 400, "a picture from anywhere could change after the page was checked");
		assert.match(elsewhere.body.error.message, /page's own pictures, or an image uploaded/);
		await upload(user, "https://cdn.example.com/picked.png");
		assert.equal((await patch(user, id, { image: "https://cdn.example.com/picked.png" })).status, 200, "one uploaded to MailCheap");
		assert.equal((await shown(user, id)).thumbnailUrl, "https://cdn.example.com/picked.png");
		const other = await customer("web-sent-other@example.com");
		await upload(other, "https://cdn.example.com/theirs.png");
		assert.equal((await patch(user, id, { image: "https://cdn.example.com/theirs.png" })).status, 400, "nor another account's upload");
		assert.equal((await patch(user, id, { image: WEB_CARD })).status, 200);
		assert.equal((await shown(user, id)).thumbnailUrl, undefined, "the drawn card");

		const restored = await patch(user, id, { content: null });
		assert.equal(restored.body.web.edited, false);
		const back = await shown(user, id);
		assert.ok(renderIssueBody(back).html.includes("First words"));
		assert.equal((await load(user, id)).thumbnailUrl, "https://cdn.example.com/one.png");
	});

	test("a change the content check would hold stays off the website, and the admins hear of it", async () => {
		answer = "clean";
		const user = await customer("web-held@example.com");
		const id = await publish(user, "<p>Our news</p>");
		answer = "phishing";
		const emailsBefore = platformEmails.length;

		const refused = await patch(user, id, { content: '<p>Log in to your bank <a href="https://bank.example.net">here</a></p>' });
		assert.equal(refused.status, 409, JSON.stringify(refused.body));
		assert.equal(refused.body.error.message, WEB_CHANGE_REFUSED);
		assert.ok(renderIssueBody(await shown(user, id)).html.includes("Our news"), "the page keeps what it showed");
		assert.equal((await load(user, id)).web?.format, undefined);
		const alerts = platformEmails.slice(emailsBefore).filter(({ subject }) => subject === "[MailCheap] Page change refused");
		assert.equal(alerts.length, 1);
		assert.ok(!JSON.stringify(alerts).includes("Log in to your bank"), "alerts name the page, never its words");

		const requests = openaiRequests.length;
		assert.equal((await patch(user, id, { content: '<p>Log in to your bank <a href="https://bank.example.net">here</a></p>' })).status, 409);
		assert.equal(openaiRequests.length, requests, "the same change is refused without another check");
		const dashboard = await as(user, () => m.campaigns.updateWebPage(id, { title: "Log in now" }));
		assert.equal(dashboard.error, WEB_CHANGE_REFUSED, "a new title is read too");

		answer = "clean";
		assert.equal((await patch(user, id, { content: "<p>Our news, fixed</p>" })).status, 200);
		assert.ok(renderIssueBody(await shown(user, id)).html.includes("Our news, fixed"));
	});

	test("an issue that isn't on the website has no page to change, and another account's isn't found", async () => {
		const user = await customer("web-email-only@example.com");
		const campaign = await m.Campaign.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			subject: "Email only",
			format: "rich",
			html: "<p>Hi</p>",
			publishTo: "email",
			status: "sent",
			archiveSlug: "email-only",
			sentAt: new Date(),
		});
		const response = await patch(user, campaign._id, { title: "On the web" });
		assert.equal(response.status, 409);
		assert.equal(response.body.error.message, "This campaign isn't on the website");

		const other = await customer("web-other@example.com");
		assert.equal((await patch(other, campaign._id, { title: "Mine now" })).status, 404);
		assert.equal((await load(user, campaign._id)).web, undefined);
	});

	test("a picture several issues show is the newsletter's banner, unless it was picked for a page", async () => {
		answer = "clean";
		const user = await customer("web-banner@example.com");
		const banner = '<img src="https://cdn.example.com/banner.png" width="600">';
		const first = await publish(user, `${banner}<p>One</p>`, "First issue");
		const second = await publish(user, `${banner}<p>Two</p>`, "Second issue");
		assert.equal((await shown(user, first)).thumbnailUrl, undefined, "both get the drawn card");
		assert.equal((await shown(user, second)).thumbnailUrl, undefined);

		await upload(user, "https://cdn.example.com/own.png");
		assert.equal((await patch(user, first, { image: "https://cdn.example.com/own.png" })).status, 200);
		assert.equal((await shown(user, first)).thumbnailUrl, "https://cdn.example.com/own.png");
		assert.equal((await shown(user, second)).thumbnailUrl, "https://cdn.example.com/banner.png", "no other issue shows it now");

		await patch(user, first, { image: "https://cdn.example.com/banner.png" });
		assert.equal((await shown(user, first)).thumbnailUrl, "https://cdn.example.com/banner.png", "picked, it shows");
		assert.equal((await shown(user, second)).thumbnailUrl, undefined);

		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
		const firstId = (await load(user, first))._id;
		assert.deepEqual(await m.archive.listOtherIssuePictures(newsletter, firstId), ["https://cdn.example.com/banner.png"]);
		const third = await draft(user, `${banner}<p>Three</p>`, "Third issue");
		assert.deepEqual((await m.archive.listOtherIssuePictures(newsletter, (await load(user, third))._id)).sort(), ["https://cdn.example.com/banner.png"]);
	});

	test("the campaign's page and its ⋯ menu in the list open its web page, whose editor starts on what the website shows", async () => {
		answer = "clean";
		const user = await customer("web-dashboard@example.com");
		const id = await publish(user, '<p>Hello readers</p><section data-section="" data-where="email"><p>Reply to this email</p></section>');
		await patch(user, id, { description: "Read it on the web" });

		const render = async (page, params) => {
			const element = await as(user, () => page.default({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }));
			return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
		};
		const report = await render(m.campaignPage, { id });
		assert.ok(report.includes(`href="/campaigns/${id}/web"`));
		assert.ok(report.includes("Edit web page"));
		assert.ok(report.includes("Read it on the web"), "its card as the website shows it");

		const editor = await render(m.webPage, { id });
		assert.ok(editor.includes("Web page"));
		assert.match(editor, /aria-label="Description"[^>]*>Read it on the web<\/textarea>/);
		assert.match(editor, /aria-label="Title"[^>]*>Club news<\/textarea>/, "the title starts as the subject");
		assert.match(editor, />Preview<\/button>/, "the page as it will look, before Update page");
		assert.match(editor, /role="switch"[^>]*aria-checked="false"/, "Pin to top, at once");
		assert.match(editor, />Remove from website<\/button>/);
		assert.match(editor, /<input(?=[^>]*aria-label="URL")(?=[^>]*value="club-news)[^>]*>/, "and its address");

		const draftId = await draft(user, "<p>Not out yet</p>");
		assert.equal(await catchRedirect(as(user, () => m.webPage.default({ params: Promise.resolve({ id: draftId }) }))), `/campaigns/${draftId}`);

		const { pageUrls } = findElement(await as(user, () => m.campaignsPage.default()), m.TableCampaigns).props;
		assert.ok(pageUrls[id], "in the campaigns list, its ⋯ menu has its page's items");
		assert.equal(pageUrls[draftId], undefined, "a draft's has none");
		// The menu only renders once opened, so its source says where Edit web page is.
		const menu = await readFile(new URL("../components/MenuCampaign.jsx", import.meta.url), "utf8");
		const pageItems = menu.match(/\{pageUrl && \(\s*<>([\s\S]*?)<\/>\s*\)\}/)[1];
		assert.match(pageItems, /<Link href=\{`\/campaigns\/\$\{id\}\/web`\}>\s*<PenLine \/>\s*Edit web page\s*<\/Link>/);
	});
});

test("a picture's address is the one it loads, however the HTML writes its &", () => {
	const url = "https://images.example.com/photo.jpg?w=1200&q=80";
	assert.deepEqual(listImageUrls({ format: "rich", html: '<img src="https://images.example.com/photo.jpg?w=1200&amp;q=80">' }), [url]);
	assert.deepEqual(listImageUrls({ format: "html", html: `<img src="${url}">` }), [url]);
});

function findElement(node, type) {
	if (Array.isArray(node)) return node.reduce((found, child) => found ?? findElement(child, type), null);
	if (!node?.props) return null;
	return node.type === type ? node : findElement(Object.values(node.props), type);
}
