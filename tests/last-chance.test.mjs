import assert from "node:assert/strict";
import { test } from "node:test";
import { createConfirmToken, verifyConfirmToken } from "../lib/confirmation.js";
import { createKeepToken, getKeepUrl, verifyKeepToken } from "../lib/last-chance.js";
import { KEEP_URL_PLACEHOLDER, getLastChanceContent, getLastChanceProblem, getOwnLastChance, isDefaultLastChance } from "../lib/last-chance-content.js";
import { buildRecipientEmail, getCampaignRateProblem, getCampaignStatsPath } from "../lib/sending-rules.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/unsubscribe.js";

process.env.BETTER_AUTH_SECRET ||= "test-secret-for-last-chance-links";
process.env.APP_URL ||= "https://mailcheap.test";

const REFERENCE = { contactId: "64f1a2b3c4d5e6f7a8b9c0a1", newsletterId: "64f1a2b3c4d5e6f7a8b9c0b1" };
const DAY_MS = 24 * 60 * 60 * 1000;
const NEWSLETTER = {
	_id: REFERENCE.newsletterId,
	name: "Field notes",
	fromName: "Jane Doe",
	fromEmail: "hi@mail.example.com",
	replyTo: "jane@example.com",
};

test("a keep link names one contact and works for 90 days", () => {
	const now = Date.now();
	const token = createKeepToken(REFERENCE, now);
	assert.deepEqual(verifyKeepToken(token, now + 60 * DAY_MS), REFERENCE);
	assert.equal(verifyKeepToken(token, now + 91 * DAY_MS), null);

	const [payload, signature] = token.split(".");
	const other = { c: "64f1a2b3c4d5e6f7a8b9c0a2", n: REFERENCE.newsletterId, t: Math.floor(now / 1000) };
	const forged = Buffer.from(JSON.stringify(other)).toString("base64url");
	assert.equal(verifyKeepToken(`${forged}.${signature}`), null, "another contact can't reuse the signature");
	assert.equal(verifyKeepToken(`${payload}.${signature.slice(1)}x`), null);
	assert.equal(verifyKeepToken(undefined), null);
	assert.ok(getKeepUrl(REFERENCE).startsWith("https://mailcheap.test/keep?token="));
});

test("keep, confirmation and unsubscribe links can't stand in for each other", () => {
	assert.equal(verifyKeepToken(createConfirmToken(REFERENCE)), null);
	assert.equal(verifyKeepToken(createUnsubscribeToken(REFERENCE)), null);
	assert.equal(verifyConfirmToken(createKeepToken(REFERENCE)), null);
	assert.equal(verifyUnsubscribeToken(createKeepToken(REFERENCE)), null);
});

test("the last-chance email asks one question, with a clean button", () => {
	const content = getLastChanceContent(NEWSLETTER);
	assert.equal(content.subject, "Do you still want Field notes?");
	assert.ok(!/action required/i.test(`${content.subject} ${content.previewText} ${content.html}`));
	assert.equal(content.format, "rich", "written as the editor writes it, where its owner can change it");
	assert.equal(content.html.match(/<a /g).length, 1, "one button");
	assert.ok(content.html.includes(`<div data-button=""><a href="${KEEP_URL_PLACEHOLDER}">Yes, keep sending it</a></div>`));

	const keepUrl = getKeepUrl(REFERENCE);
	const email = buildRecipientEmail({
		campaign: content,
		newsletter: NEWSLETTER,
		contact: { _id: REFERENCE.contactId, email: "reader@example.com" },
		messageId: null,
		keepUrl,
	});
	assert.equal(email.replyTo, "jane@example.com", "replies go to the newsletter's reply-to");
	assert.ok(email.html.includes(`href="${keepUrl}"`));
	assert.ok(email.text.includes(`Yes, keep sending it (${keepUrl})`));
	assert.ok(!email.html.includes(KEEP_URL_PLACEHOLDER) && !email.text.includes(KEEP_URL_PLACEHOLDER));
	assert.ok(!email.html.includes("/c/") && !email.html.includes("/o/"), "no tracking redirect or pixel");
	assert.ok(email.headers["List-Unsubscribe"].startsWith("<https://mailcheap.test/api/unsubscribe?token="));
	assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
	assert.ok(email.html.includes(email.unsubscribeUrl), "footer unsubscribe link");
});

test("a newsletter's own last-chance email, in its readers' language, goes out with each contact's keep link", () => {
	const lastChance = {
		subject: "Ainda quer receber a Field notes?",
		previewText: "Um clique e ela continua chegando.",
		format: "rich",
		html: `<p>Faz tempo que você não abre.</p><div data-button=""><a href="${KEEP_URL_PLACEHOLDER}">Sim, quero continuar</a></div>`,
	};
	const content = getLastChanceContent({ ...NEWSLETTER, lastChance });
	assert.equal(content.subject, "Ainda quer receber a Field notes?");
	const keepUrl = getKeepUrl(REFERENCE);
	const email = buildRecipientEmail({ campaign: content, newsletter: NEWSLETTER, contact: { _id: REFERENCE.contactId, email: "reader@example.com" }, keepUrl });
	assert.ok(email.html.includes(`href="${keepUrl}"`));
	assert.ok(email.text.includes(`Sim, quero continuar (${keepUrl})`));
	assert.ok(!email.html.includes(KEEP_URL_PLACEHOLDER));

	assert.deepEqual(getLastChanceContent({ ...NEWSLETTER, lastChance }, { builtIn: true }), getLastChanceContent(NEWSLETTER), "held, the built-in one goes out");
});

test("a last-chance email without its subject or its button can't be saved and never goes out", () => {
	const builtIn = getLastChanceContent(NEWSLETTER);
	assert.equal(getLastChanceProblem(builtIn), null);
	assert.equal(getLastChanceProblem({ ...builtIn, subject: "" }), "Last-chance email needs a subject");
	const buttonProblem = /^Last-chance email needs its button: a link to \{\{keep_url\}\}/;
	assert.match(getLastChanceProblem({ subject: "Still there?", format: "rich", html: "<p>Still there?</p>" }), buttonProblem);
	assert.match(getLastChanceProblem({ subject: "Still there?", format: "markdown", markdown: `[Keep](${KEEP_URL_PLACEHOLDER})` }), buttonProblem);
	assert.equal(getLastChanceProblem({ subject: "Still there?", format: "markdown", markdown: `<a href="${KEEP_URL_PLACEHOLDER}">Keep</a>` }), null);

	const broken = { ...NEWSLETTER, lastChance: { subject: "Still there?", format: "rich", html: "<p>No button</p>" } };
	assert.equal(getOwnLastChance(broken), null);
	assert.deepEqual(getLastChanceContent(broken), builtIn, "the built-in one goes out instead");
});

test("the built-in last-chance email sent back as it is stays the built-in one, which follows the name", () => {
	const builtIn = getLastChanceContent(NEWSLETTER);
	assert.equal(isDefaultLastChance(builtIn, NEWSLETTER), true);
	assert.equal(isDefaultLastChance(builtIn, { ...NEWSLETTER, name: "Weekly notes" }), false);
	assert.equal(isDefaultLastChance(builtIn, { ...NEWSLETTER, name: "Weekly notes" }, NEWSLETTER), true, "filled in before the rename");
	assert.equal(isDefaultLastChance({ ...builtIn, subject: "Ainda quer receber?" }, NEWSLETTER), false);
	assert.equal(getLastChanceContent({ ...NEWSLETTER, name: "Tips & <tricks>" }).html.includes("Tips &amp; &lt;tricks&gt;"), true, "the name is text");
});

test("issues keep the newsletter's reply-to", () => {
	const email = buildRecipientEmail({
		campaign: { format: "markdown", subject: "Issue", markdown: "Hi" },
		newsletter: NEWSLETTER,
		contact: { _id: REFERENCE.contactId, email: "reader@example.com" },
	});
	assert.equal(email.replyTo, "jane@example.com");
});

test("last-chance emails keep their own counters but share the pause limits", () => {
	assert.equal(getCampaignStatsPath("campaign"), "stats");
	assert.equal(getCampaignStatsPath("last-chance"), "lastChance");

	const level = (stats, lastChance) => getCampaignRateProblem(stats, lastChance)?.level ?? null;
	assert.equal(level({ sent: 900, complained: 1 }), null);
	assert.equal(level({ sent: 900, complained: 1 }, { sent: 100, complained: 1 }), "pause", "2 complaints in all");
	assert.equal(level({ sent: 400, bounced: 4 }, { sent: 100, bounced: 9 }), "pause", "13 bounces of 500 in all, at 2.60%");
	assert.equal(level({ sent: 400, bounced: 4 }, undefined), null);
});
