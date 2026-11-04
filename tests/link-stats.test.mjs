import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatLinkUrl, getLinkKey, getLinkLabels, isSystemLink, normalizeLink } from "../lib/link-stats.js";
import { getClickUrl, readClickToken } from "../lib/tracking.js";
import { activate, addAuthor, as, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

test("a link counts once whatever its tracking parameters, its parameters' order or a trailing slash", () => {
	assert.equal(
		normalizeLink("https://Example.com/Post/?utm_source=news&b=2&a=1&fbclid=x&utm_campaign=oct#top"),
		"https://example.com/Post?a=1&b=2#top"
	);
	assert.equal(normalizeLink("https://example.com?utm_medium=email"), "https://example.com/");
	assert.equal(normalizeLink(" https://example.com/a?ref=me&gclid=1 "), "https://example.com/a?ref=me");
	assert.equal(getLinkKey(normalizeLink("https://example.com/a?utm_source=x")), getLinkKey(normalizeLink("https://example.com/a/")));
	assert.notEqual(getLinkKey("https://example.com/a"), getLinkKey("https://example.com/b"));
	assert.equal(getLinkKey("https://example.com/a").length, 16);
	for (const href of ["mailto:hi@example.com", "javascript:alert(1)", "not a url", "", null]) assert.equal(normalizeLink(href), null, href);
});

test("the report links only web addresses: anything else stays text", async () => {
	const { default: TableCampaignLinks } = await import("../components/TableCampaignLinks.jsx");
	const link = (url) => ({ key: getLinkKey(url), url, clickers: 1, clicks: 1 });
	const html = renderToStaticMarkup(
		createElement(TableCampaignLinks, {
			stats: { links: [link("https://example.com/post"), link("javascript:alert(1)")], clickers: 2, isComplete: true },
			html: "",
		})
	);
	assert.ok(html.includes('href="https://example.com/post"'));
	assert.ok(!html.includes('href="javascript:'), "a stored javascript: address never becomes a link");
	assert.ok(html.includes("javascript:alert(1)"), "it still shows, as text");
});

test("each web link in the report shows its website's favicon, anything else a globe", async () => {
	const { default: TableCampaignLinks } = await import("../components/TableCampaignLinks.jsx");
	const link = (url) => ({ key: getLinkKey(url), url, clickers: 1, clicks: 1 });
	const html = renderToStaticMarkup(
		createElement(TableCampaignLinks, {
			stats: { links: [link("https://news.example.com/post"), link("javascript:alert(1)")], clickers: 2, isComplete: true },
			html: "",
		})
	);
	assert.ok(html.includes("s2/favicons?domain=news.example.com&amp;"), "the favicon of the link's own host");
	assert.equal(html.match(/s2\/favicons/g).length, 1, "only a web link asks for one");
	assert.equal(html.match(/<svg/g)?.length, 1, "the other gets a globe");
});

test("MailCheap's own unsubscribe, keep and confirm pages aren't the issue's links", () => {
	const host = "localhost:3000";
	assert.equal(isSystemLink("http://localhost:3000/api/unsubscribe?token=abc", host), true);
	assert.equal(isSystemLink("http://localhost:3000/unsubscribe", host), true);
	assert.equal(isSystemLink("http://localhost:3000/keep?token=abc", host), true);
	assert.equal(isSystemLink("https://example.com/unsubscribe", host), false, "a newsletter's own page");
	assert.equal(isSystemLink("http://localhost:3000/p/an-issue", host), false);
});

test("each link is shown as its text in the email, its picture's alt text, or Read online for the issue's page", () => {
	const labels = getLinkLabels(
		[
			'<a target="_blank" rel="noopener" href="https://example.com/a?utm_source=news&amp;x=1">Read <strong>this</strong></a>',
			'<a href="https://example.com/a?x=1"><img src="https://cdn.example.com/a.png" alt="Ignored"></a>',
			'<a href="https://example.com/cover"><img src="https://cdn.example.com/c.png" alt="The cover"></a>',
			'<a href="https://example.com/tom">Tom &amp; Jerry&#39;s</a>',
			'<a href="https://example.com/empty"><span> </span></a>',
		].join(""),
		{ webUrl: "https://news.example.com/p/issue" }
	);
	const label = (url) => labels.get(getLinkKey(normalizeLink(url)));
	assert.equal(label("https://example.com/a?x=1"), "Read this", "the first label of the same link stays");
	assert.equal(label("https://example.com/cover"), "The cover");
	assert.equal(label("https://example.com/tom"), "Tom & Jerry's");
	assert.equal(label("https://example.com/empty"), null);
	assert.equal(label("https://news.example.com/p/issue"), "Read online");
	assert.equal(formatLinkUrl("https://example.com/"), "example.com");
	assert.equal(formatLinkUrl("https://example.com/a?b=1"), "example.com/a?b=1");
});

describe("clicks per link", () => {
	const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
	let app;
	let m;
	let processed = 0;

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			clickRoute: await import("../app/c/[token]/route.js"),
			actions: (await import("../lib/actions/campaigns.js")).campaignActions,
			findCampaignLinks: (await import("../lib/campaign-links.js")).findCampaignLinks,
			CampaignReport: (await import("../components/CampaignReport.jsx")).default,
			ButtonClickMap: (await import("../components/ButtonClickMap.jsx")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			CampaignLink: (await import("../models/CampaignLink.js")).default,
			Message: (await import("../models/Message.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
		};
	});

	after(() => app?.stop());

	async function customer(email, contacts) {
		const user = await signIn(email);
		await activate(user);
		const slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(
				m.newsletters.saveNewsletter(
					null,
					form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })
				)
			)
		);
		user.newsletterId = url.split("/").at(-1);
		await addAuthor(user);
		const rows = Array.from({ length: contacts }, (_, index) => ({ email: `reader${index}@${slug}.example.org`, status: "active" }));
		await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
		return user;
	}

	async function sendIssue(user, body) {
		const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		const id = url.split("/").at(-1);
		await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body }));
		const before = sesEmails.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		while (processed < published.length) {
			const { url: jobUrl, body: job } = published[processed++];
			if (jobUrl.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(jobUrl, { method: "POST", body: job }));
		}
		return { id, emails: sesEmails.slice(before) };
	}

	// The tracked links of a sent email, by the address each one leads to.
	function trackedLinks(email) {
		const tokens = [...String(email.html).matchAll(/href="[^"]*\/c\/([^"]+)"/g)].map(([, token]) => token);
		return new Map(tokens.map((token) => [readClickToken(token).url, token]));
	}

	async function click(token, userAgent = BROWSER) {
		const response = await m.clickRoute.GET(new Request(`http://localhost:3000/c/${token}`, { headers: { "user-agent": userAgent } }), {
			params: Promise.resolve({ token }),
		});
		await flushAfter();
		return response;
	}

	async function report(user, id) {
		const action = m.actions.find(({ name }) => name === "get_campaign_report");
		return action.output.parse(await action.handler({ account: user.account, input: { id } }));
	}

	// The first element of a type in a rendered tree, through each element's props: its children and the elements it's given.
	function findElement(node, type) {
		if (Array.isArray(node)) return node.reduce((found, child) => found ?? findElement(child, type), null);
		if (!node?.props) return null;
		return node.type === type ? node : findElement(Object.values(node.props), type);
	}

	test("a reader's clicks count once per link and once per issue; repeats only add clicks; scanners count for nothing", async () => {
		const user = await customer("clickcount@example.com", 3);
		const story = "https://example.com/story?utm_source=mailcheap";
		const { id, emails } = await sendIssue(
			user,
			`<p><a href="${story}">The story</a> and <a href="https://example.com/shop">the shop</a></p><p><a href="https://example.com/story">Again</a></p>`
		);
		assert.equal(emails.length, 3);
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.links.countedAt.getTime(), campaign.startedAt.getTime(), "counted from the send's start");
		const [first, second, third] = emails.map(trackedLinks);
		assert.ok(![...first.keys()].some((url) => url.includes("unsubscribe")), "the unsubscribe link isn't tracked");
		await m.Message.updateMany({ accountId: user.accountId, campaignId: id }, { $set: { sentAt: new Date(Date.now() - 3_600_000) } });

		assert.equal((await click(first.get(story))).headers.get("location"), story, "still redirects with its parameters");
		await click(first.get(story));
		await click(first.get("https://example.com/story"));
		await click(first.get("https://example.com/shop"));
		await click(second.get("https://example.com/story"));
		await click(third.get(story), "Mozilla/5.0 (compatible; Barracuda Sentinel)");

		const links = await m.CampaignLink.find({ accountId: user.accountId, campaignId: id }).sort({ clickers: -1 }).lean();
		assert.deepEqual(
			links.map(({ url, clicks, clickers }) => [url, clicks, clickers]),
			[
				["https://example.com/story", 4, 2],
				["https://example.com/shop", 1, 1],
			]
		);
		const fresh = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(fresh.links.clickers, 2, "two readers clicked a link");
		assert.equal(fresh.stats.clicked, 2, "the issue's click count is unchanged");

		const result = await report(user, id);
		assert.deepEqual(result.links, [
			{ url: "https://example.com/story", text: "The story", clickers: 2, clicks: 4 },
			{ url: "https://example.com/shop", text: "the shop", clickers: 1, clicks: 1 },
		]);
		assert.deepEqual([result.linkClickers, result.linksComplete, result.linksCountedSince], [2, true, null]);
		const hours = result.timeline.hours;
		assert.equal(hours.reduce((sum, { opens }) => sum + opens, 0), 2, "each reader's first open counts once, in its hour");
		assert.equal(hours.reduce((sum, { clicks }) => sum + clicks, 0), 2);
		assert.ok(hours.every(({ at }) => new Date(at) <= new Date()), "no hours to come");
		assert.equal(result.comparison, null, "a first issue has nothing to compare with");
	});

	test("the report's click map gets each clicked link's count, and the key of its clicks on every link its email has", async () => {
		const user = await customer("clickmap@example.com", 2);
		const { id, emails } = await sendIssue(
			user,
			`<p><a href="https://example.com/story?utm_source=mailcheap">The story</a> and <a href="https://example.com/shop">the shop</a></p><p><a href="https://example.com/story">Again</a></p>`
		);
		await m.Message.updateMany({ accountId: user.accountId, campaignId: id }, { $set: { sentAt: new Date(Date.now() - 3_600_000) } });
		const [first, second] = emails.map(trackedLinks);
		const page = [...first.keys()].find((url) => !url.startsWith("https://example.com/"));
		assert.match(page, /\/p\//, "its emails link its page");
		await click(first.get("https://example.com/story"));
		await click(first.get(page));
		await click(second.get("https://example.com/story?utm_source=mailcheap"));

		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: campaign.newsletterId }).lean();
		const links = await m.findCampaignLinks(campaign);
		const preview = findElement(m.CampaignReport({ campaign, newsletter, providers: [], links, timeZone: "UTC" }), m.ButtonClickMap);
		const [story, shop, readOnline] = ["https://example.com/story", "https://example.com/shop", page].map((url) => getLinkKey(normalizeLink(url)));
		assert.deepEqual(preview.props.clicks, {
			clickers: 2,
			links: [
				{ key: story, clickers: 2 },
				{ key: readOnline, clickers: 1 },
			],
		});
		const marked = [...preview.props.html.matchAll(/<a data-link-key="([^"]+)"/g)].map(([, key]) => key);
		assert.deepEqual(marked, [readOnline, story, shop, story], "Read online first, as the email has it, and the story twice");

		const quiet = await sendIssue(user, `<p><a href="https://example.com/nobody">Nobody</a></p>`);
		const unclicked = await m.Campaign.findOne({ accountId: user.accountId, _id: quiet.id }).lean();
		const none = findElement(
			m.CampaignReport({ campaign: unclicked, newsletter, providers: [], links: await m.findCampaignLinks(unclicked), timeZone: "UTC" }),
			m.ButtonClickMap
		);
		assert.equal(none.props.clicks, null, "nothing to show before a link gets a click");
		assert.doesNotMatch(none.props.html, /data-link-key/);
	});

	test("an issue sent before clicks were counted per link has them since its first one; other emails count for nothing", async () => {
		const user = await customer("oldclicks@example.com", 1);
		const older = await m.Campaign.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			subject: "Older issue",
			status: "sent",
			startedAt: new Date(Date.now() - 86_400_000),
			stats: { recipients: 1, sent: 1, clicked: 1 },
		});
		await m.Campaign.updateOne({ accountId: user.accountId, _id: older._id }, { $unset: { links: 1 } });
		const sentAt = new Date(Date.now() - 3_600_000);
		const [issue, welcome] = await m.Message.insertMany([
			{ kind: "campaign", accountId: user.accountId, newsletterId: user.newsletterId, campaignId: older._id, contactId: new mongoose.Types.ObjectId(), email: "a@example.org", status: "delivered", sentAt },
			{ kind: "welcome", accountId: user.accountId, newsletterId: user.newsletterId, contactId: new mongoose.Types.ObjectId(), email: "b@example.org", status: "delivered", sentAt },
		]);

		const none = await report(user, older._id.toString());
		assert.deepEqual([none.links, none.linksComplete, none.linksCountedSince], [[], false, null]);

		const token = (message, url) => getClickUrl("http://localhost:3000", message._id, url).split("/").at(-1);
		await click(token(issue, "https://example.com/later"));
		await click(token(issue, "http://localhost:3000/api/unsubscribe?token=abc"));
		await click(token(welcome, "https://example.com/later"));

		const partial = await report(user, older._id.toString());
		assert.deepEqual(partial.links, [{ url: "https://example.com/later", text: null, clickers: 1, clicks: 1 }]);
		assert.equal(partial.linksComplete, false);
		assert.ok(partial.linksCountedSince, "counted since its first counted click");
		assert.equal(await m.CampaignLink.countDocuments({ accountId: user.accountId }), 1, "the welcome email and the unsubscribe link aren't counted");
	});
});
