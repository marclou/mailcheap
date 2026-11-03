import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: CampaignReport } = await import("../components/CampaignReport.jsx");
const { default: ButtonClickMap } = await import("../components/ButtonClickMap.jsx");
const { default: MenuReport } = await import("../components/MenuReport.jsx");
const { TooltipProvider } = await import("../components/ui/tooltip.jsx");
const { UNSUBSCRIBE_PLACEHOLDER } = await import("../lib/render-email.js");

const STATS = { recipients: 1000, sent: 1000, delivered: 990, opened: 462, clicked: 70, bounced: 10, complained: 1, unsubscribed: 4 };

function renderReport(props = {}) {
	return renderToStaticMarkup(
		createElement(CampaignReport, {
			campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "sent", format: "markdown", markdown: "Hi", stats: STATS },
			newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com" },
			providers: [],
			links: null,
			comparison: { isSettled: true, issues: 3, delta: { opened: 0.042, clicked: -0.004 }, average: { opened: 0.42, clicked: 0.074 } },
			timeZone: "UTC",
			...props,
		})
	);
}

const card = (label) => `>${label}</span>`;

test("the report's cards are delivered, opened, clicked, bounced and unsubscribed, with complaints only for an admin", () => {
	const owner = renderReport();
	const cards = ["Delivered", "Opened", "Clicked", "Bounced", "Unsubscribed"].map((label) => owner.indexOf(card(label)));
	assert.ok(cards.every((index, position) => index > (cards[position - 1] ?? -1)), "all five, in that order");
	assert.ok(!owner.includes(card("Complaints")), "the owner sees complaints by inbox instead");

	const admin = renderReport({ readOnly: true });
	assert.ok(admin.indexOf(card("Bounced")) < admin.indexOf(card("Complaints")));
	assert.ok(admin.indexOf(card("Complaints")) < admin.indexOf(card("Unsubscribed")));
});

test("the Delivered card says how many emails weren't delivered, when bounces don't explain them all", () => {
	const stats = { recipients: 22, sent: 22, delivered: 20, opened: 7, clicked: 0, bounced: 1, complained: 0, unsubscribed: 0 };
	const html = renderReport({ campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "sent", format: "markdown", markdown: "Hi", stats } });
	assert.ok(html.includes(">20 · 1 not delivered</span>"), "one still on its way or refused for now, on top of the bounce");
	assert.ok(!renderReport().includes("not delivered"), "every email delivered or bounced");
});

// Each tab's label and whether it's the open one, in order.
function tabsOf(html) {
	return [...html.matchAll(/<button([^>]*role="tab"[^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => [
		inner.replace(/<[^>]*>/g, ""),
		attributes.includes('aria-selected="true"'),
	]);
}

// What a tab's panel holds, up to the next one.
function panelOf(html, value) {
	const start = html.search(new RegExp(`id="[^"]*-content-${value}"`));
	if (start < 0) return "";
	const end = html.indexOf('role="tabpanel"', start);
	return html.slice(start, end < 0 ? undefined : end);
}

test("the report's numbers stay on top, and its details are in tabs: Timeline open, then Links with the click map, Inboxes and Website", () => {
	const html = renderToStaticMarkup(
		createElement(
			TooltipProvider,
			null,
			createElement(CampaignReport, {
				campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "sent", format: "markdown", markdown: "Hi", stats: STATS, archiveSlug: "hello", webViews: 1204 },
				newsletter: { _id: "6ad87a2affc219b3be2cc72d", name: "Weekly", slug: "weekly", fromName: "Weekly", fromEmail: "hi@example.com", archiveEnabled: true },
				providers: [{ provider: "gmail", sent: 600, delivered: 595, opened: 300, clicked: 50, bounced: 5, complained: 0 }],
				links: { links: [{ key: "post", url: "https://example.com/post", clickers: 40, clicks: 50 }], clickers: 40, isComplete: true },
				timeline: { hours: [{ at: new Date(), opens: 3, clicks: 1 }], later: { opens: 0, clicks: 0 } },
				timeZone: "UTC",
			})
		)
	);
	assert.deepEqual(tabsOf(html), [
		["Timeline", true],
		["Links", false],
		["Inboxes", false],
		["Website", false],
	]);
	assert.ok(html.indexOf(card("Unsubscribed")) < html.indexOf('role="tablist"'), "the numbers come first, whatever tab is open");
	assert.match(panelOf(html, "timeline"), />After sending</);
	const links = panelOf(html, "links");
	assert.match(links, /40 contacts clicked a link/);
	assert.match(links, />Click map</, "the click map opens from the links");
	assert.match(links, />Link<\/th>/);
	assert.match(panelOf(html, "inboxes"), />Inbox<\/th>/);
	assert.match(panelOf(html, "website"), />1,204</, "the page's views");
	assert.match(panelOf(html, "website"), /value="hello"/, "and its address, to change");
	assert.doesNotMatch(html, />Preview</, "no Preview button at the top: it's in the ⋯ menu");

	const quiet = renderReport({ campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "sent", format: "markdown", markdown: "Hi", stats: STATS } });
	assert.deepEqual(
		tabsOf(quiet).map(([label]) => label),
		["Timeline", "Links", "Inboxes"],
		"no Website tab for an issue that isn't on the website"
	);
	assert.match(panelOf(quiet, "links"), /No clicks yet[\s\S]*>Click map</, "the email as it went out, before any click");
	const admin = renderReport({ readOnly: true });
	assert.doesNotMatch(admin, />Click map</, "an admin reads the email on their own page");
	const unsent = renderReport({ campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "paused", format: "markdown", markdown: "Hi", stats: { recipients: 0, sent: 0 } }, readOnly: true });
	assert.doesNotMatch(unsent, /role="tablist"/, "nothing to break down before an email goes out");
});

test("under its subject, when it went out and where; the Website tab has its page, which it pins, beside its views day by day", () => {
	const newsletter = { _id: "6ad87a2affc219b3be2cc72d", name: "Weekly", slug: "weekly", fromName: "Weekly", fromEmail: "hi@example.com", archiveEnabled: true };
	const campaign = {
		_id: "6ad87a2affc219b3be2cc72c",
		subject: "Hello",
		status: "sent",
		format: "markdown",
		markdown: "Hi",
		stats: STATS,
		archiveSlug: "hello",
		webViews: 1204,
		sentAt: new Date("2026-10-15T13:29:00Z"),
	};
	const days = Array.from({ length: 30 }, (_, index) => ({ key: `2026-10-${String(15 + index).padStart(2, "0")}`, views: index < 3 ? [800, 300, 104][index] : null }));
	const render = (props) =>
		renderToStaticMarkup(
			createElement(
				TooltipProvider,
				null,
				createElement(CampaignReport, { campaign, newsletter, providers: [], links: null, timeZone: "UTC", ...props })
			)
		);
	const pageViews = { total: 1204, days, today: "2026-10-17", published: "2026-10-15", since: null };
	const html = render({ pageViews, webPage: { title: "Hello", description: "This week", imageUrl: "https://cdn.example.com/card.png" } });
	const header = html.slice(0, html.indexOf('role="tablist"'));
	assert.match(header, />Sent<\/span>[\s\S]*>Oct 15, 2026, 1:29 PM<\/time>/, "the date it went out, next to where it stands");
	assert.match(header, /href="http:\/\/localhost:3000\/archive\/weekly\/p\/hello"[^>]*>[\s\S]*?On your website<\/a>/);
	const website = panelOf(html, "website");
	assert.match(website, /href="\/campaigns\/6ad87a2affc219b3be2cc72c\/web"[^>]*>[\s\S]*?Edit web page/);
	assert.match(website, />Pin to top<\/button>/);
	assert.match(website, />Best day<\/dt><dd[^>]*>800<span[^>]*> · Oct 15<\/span>/, "its best day");
	assert.match(website, /aria-label="1,204 page views from Oct 15 to Oct 17"/);
	assert.doesNotMatch(website, />Published</, "the date is under the subject");

	const pinned = panelOf(render({ campaign: { ...campaign, archivePinned: true }, pageViews }), "website");
	assert.match(pinned, />Unpin<\/button>/);
	assert.match(pinned, />Pinned<\/span>/);
	const unlisted = panelOf(render({ campaign: { ...campaign, archiveListed: false }, pageViews }), "website");
	assert.doesNotMatch(unlisted, /Pin to top/, "only a page the website lists takes a pin");

	const emailOnly = render({ campaign: { ...campaign, publishTo: "email" } });
	assert.match(emailOnly.slice(0, emailOnly.indexOf('role="tablist"')), />Email only</);
});

// The first element of a type in a rendered tree, through each element's props: its children and the elements it's given.
function findElement(node, type) {
	if (Array.isArray(node)) return node.reduce((found, child) => found ?? findElement(child, type), null);
	if (!node?.props) return null;
	return node.type === type ? node : findElement(Object.values(node.props), type);
}

test("Preview, right above Duplicate in a sent campaign's ⋯ menu, shows the email as it went out, without its clicks", async () => {
	const campaign = {
		_id: "6ad87a2affc219b3be2cc72c",
		subject: "Hello",
		previewText: "This week",
		status: "sent",
		format: "markdown",
		markdown: "Read [the story](https://example.com/story)",
		stats: STATS,
		archiveSlug: "hello",
	};
	const newsletter = { _id: "6ad87a2affc219b3be2cc72d", name: "Weekly", slug: "weekly", fromName: "Weekly", fromEmail: "hi@example.com", archiveEnabled: true };
	const links = { links: [{ key: "story", url: "https://example.com/story", clickers: 40, clicks: 50 }], clickers: 40, isComplete: true };
	const report = CampaignReport({ campaign, newsletter, contactFields: [{ key: "city", label: "City" }], providers: [], links, timeZone: "UTC" });
	const { html, ...email } = findElement(report, MenuReport).props.preview;
	const { html: clickMapHtml, clicks, ...clickMapEmail } = findElement(report, ButtonClickMap).props;
	assert.deepEqual(email, clickMapEmail, "the same email as the click map, its reader picker included");
	assert.ok(clicks && !("clicks" in email), "without the clicks the click map shows on it");
	assert.match(html, /href="https:\/\/example\.com\/story"/);
	assert.match(html, />Read online<\/a>/, "with the Read online link its emails had");
	assert.ok(!html.includes(UNSUBSCRIBE_PLACEHOLDER), "an unsubscribe link that goes nowhere");
	assert.doesNotMatch(html, /data-link-key/);
	assert.match(clickMapHtml, /data-link-key/);

	const webOnly = CampaignReport({ campaign: { ...campaign, publishTo: "web" }, newsletter, providers: [], links: null, timeZone: "UTC" });
	assert.equal(findElement(webOnly, MenuReport).props.preview, null, "a web-only issue sent no email: View page shows it");

	// The menu only renders once opened, so its source says where Preview is.
	const source = await readFile(new URL("../components/MenuReport.jsx", import.meta.url), "utf8");
	const menu = source.match(/<DropdownMenuContent\b[\s\S]*?<\/DropdownMenuContent>/)[0];
	const items = [...menu.matchAll(/<DropdownMenuItem\b((?:[^>{}]|\{[^{}]*\})*)>([\s\S]*?)<\/DropdownMenuItem>/g)];
	const labels = items.map(([, , inner]) => inner.replace(/<[^>]+>/g, "").trim());
	const at = labels.indexOf("Preview");
	assert.equal(labels[at + 1], "Duplicate", "right above Duplicate");
	assert.doesNotMatch(menu.slice(items[at].index, items[at + 1].index), /<DropdownMenuSeparator/, "in the same group");
	assert.match(items[at][1], /onSelect=\{openPreview\}/);
	assert.match(source, /<DialogPreviewEmail isOpen=\{isPreviewOpen\} [^>]*\{\.\.\.preview\} \/>/, "the email, and nothing else");

	const help = await readFile(new URL("../app/(site)/help/sending/page.js", import.meta.url), "utf8");
	assert.match(help, /Preview, in the <strong>⋯<\/strong> menu at the top of the page, shows the email as it went out/);
});

test("Gmail's row in the inbox table shows Gmail's logo, and other inboxes their favicon", () => {
	const html = renderReport({
		providers: [
			{ provider: "gmail", sent: 600, delivered: 595, opened: 300, clicked: 50, bounced: 5, complained: 0 },
			{ provider: "outlook", sent: 400, delivered: 395, opened: 162, clicked: 20, bounced: 5, complained: 1 },
		],
	});
	assert.ok(html.includes('<svg viewBox="52 42 88 66" width="16" height="16"'), "Gmail's own logo");
	assert.ok(!html.includes("s2/favicons?domain=gmail.com"), "the favicon service answers gmail.com with Google's G");
	assert.ok(html.includes("s2/favicons?domain=outlook.com&amp;"));
});

const HOUR_MS = 3_600_000;
const inHours = (hours) => new Date(Date.now() + hours * HOUR_MS - 60_000).toISOString();
const sending = (campaign) => ({
	_id: "6ad87a2affc219b3be2cc72c",
	subject: "Hello",
	format: "markdown",
	markdown: "Hi",
	stats: { ...STATS, sent: 200 },
	...campaign,
});
const restart = { day: 1, intoDayMs: 0, waitMs: 4 * HOUR_MS, firstDay: 500, days: 3, isGradual: true, sentToday: 0, inFlight: 0, hasStarted: true, domain: "news.example.com" };

test("a first send going out in steps says which step it's on, what comes next and when, and why", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", firstSend: { steps: [200, 467, 8668], step: 2, slice: 200, held: 8668, checkAt: inHours(0.4) } }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 5600, later: 0, laterAt: null },
	});
	assert.match(html, /New contacts get it in steps: 2 of 3/);
	assert.match(html, /role="progressbar"[^>]*aria-valuenow="2"/);
	assert.match(html, /200 first \(2%\)/);
	assert.match(html, /467 more \(5%\), 30 minutes later/);
	assert.match(html, /The other 8,668, in about 23 minutes/, "the step coming next, and when");
	assert.match(html, /To keep your emails out of spam/);
	assert.match(html, /It&#x27;s only the first time/);
	assert.match(html, /href="\/help\/sending#first-send"/);
	assert.doesNotMatch(html, /Gmail readers/, "nothing about Gmail while none wait for another day");

	const legacy = renderReport({ campaign: sending({ status: "sending", firstSend: { slice: 200, held: 800, checkAt: inHours(2) } }) });
	assert.match(legacy, /New contacts get it in steps: 1 of 2/, "a send from before had one slice");
	assert.match(legacy, /The other 800, in about 2 hours/);

	const done = renderReport({ campaign: sending({ status: "sending", firstSend: { steps: [200, 467, 8668], step: 3, checkedAt: inHours(-1) } }) });
	assert.doesNotMatch(done, /get it in steps/, "past its last step");
});

test("a send in steps whose Gmail readers also wait for the next day says both, apart, each with why", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", firstSend: { steps: [1000, 5000, 194000], step: 2, checkAt: inHours(0.4) } }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 80000, later: 400, laterAt: inHours(20) },
	});
	assert.match(html, /New contacts get it in steps: 2 of 3/);
	assert.match(html, /1,000 first \(0\.5%\)/, "a capped first step, a fraction of a percent of a large list");
	assert.match(html, /Some Gmail readers get it tomorrow/);
	assert.match(html, /The other 400 Gmail readers get it in about 20 hours\./);
	assert.match(html, /href="\/help\/sending#first-send"/);
	assert.match(html, /href="\/help\/warm-up#new-domain"/);
	assert.ok(html.indexOf("New contacts get it in steps") < html.indexOf("Some Gmail readers get it tomorrow"), "the steps first");
});

test("a send's Gmail readers its new domain sends the next day say so, with the domain", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", sendingUntil: inHours(20) }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 4103, later: 4103, laterAt: inHours(20) },
	});
	assert.match(html, /Some Gmail readers get it tomorrow/);
	assert.match(html, /news\.example\.com/);
	assert.match(html, /The other 4,103 Gmail readers get it in about 20 hours\./);
	assert.match(html, /Gmail is careful with the first emails from a new domain/);
	assert.match(html, /href="\/help\/warm-up#new-domain"/);
});

test("a send Gmail paused says when it starts again, in the same look", () => {
	const campaign = sending({
		status: "paused",
		pauseCode: "rate_limited",
		pauseReason: "Gmail asked to slow down, so this newsletter's sends wait 6 hours, then go on by themselves, more slowly at first",
	});
	// Read only: without its buttons, whose tooltips need the dashboard's provider.
	const html = renderReport({ campaign, readOnly: true, pace: { sender: restart }, gmail: { waiting: 800, later: 0, laterAt: null } });
	assert.match(html, /Paused: Gmail asked to slow down/);
	assert.match(html, /Gmail gets it again in 4 hours: 500 of your Gmail readers that day\./);
	assert.match(html, /Next: the other 300 tomorrow\./);
	assert.match(html, /href="\/help\/warm-up#gmail"/);
	assert.doesNotMatch(html, /Paused: Gmail asked to slow down, so/, "not the look of a pause that needs something from its owner");

	const withoutPace = renderReport({ campaign, readOnly: true, pace: null });
	assert.match(withoutPace, /this newsletter&#x27;s sends wait 6 hours/, "the reason, when the domain's pace isn't there to say it");
});

test("the report compares opens and clicks with the average in percent, never in points", () => {
	const html = renderReport();
	assert.ok(html.includes("+4.2%"));
	assert.ok(html.includes("−0.4%"));
	assert.ok(!/\bpts\b/.test(html));
});
