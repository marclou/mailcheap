import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderIssueBody } from "../lib/archive-content.js";
import { cleanRichHtml } from "../lib/clean-html.js";
import { findContentWarnings } from "../lib/content-warnings.js";
import { findButtonProblem, renderEmail } from "../lib/render-email.js";
import {
	EVERY_READER,
	SECTION_ATTRIBUTE_PATTERN,
	SECTION_SEGMENT_DELETED,
	SECTION_UNREADABLE,
	describeSectionReaders,
	findSectionProblem,
	forEmail,
	forReader,
	forWeb,
	hasNestedSections,
	hasSectionsInBlocks,
	listSectionGroups,
	listSections,
	readSectionGroup,
	readSectionRule,
	toSectionReader,
	withAllSections,
	withEmailSections,
	writeSectionRule,
} from "../lib/sections.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { firstImageUrl } from "../lib/thumbnail.js";
import { activate, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

// Sections (lib/sections.js): parts of an issue only some readers get, or only its emails or its website show. Each
// reader's email resolves its own, the website its sections for the web, and anything that can't tell who's reading
// drops them, content included.
const SEGMENT = "66f2c0a1e4b0c2d3e4f5a6b7";
const DAY_MS = 24 * 60 * 60 * 1000;

function section(attributes, content) {
	return `<section data-section=""${attributes}>${content}</section>`;
}

const ISSUE = [
	"<p>For all</p>",
	section(' data-show="tag:vip" data-where="email"', "<p>VIP only</p>"),
	section(` data-hide="segment:${SEGMENT}"`, "<p>Not new</p>"),
	section(' data-where="web"', "<p>Web only</p>"),
	section(' data-where="email"', "<p>Email only</p>"),
	"<p>Bye</p>",
].join("");

function shows(html, ...parts) {
	return ["For all", "VIP only", "Not new", "Web only", "Email only", "Bye"].filter((part) => html.includes(part)).join(", ") === parts.join(", ");
}

describe("section rules", () => {
	test("who and where, as the editor and the API write them", () => {
		assert.deepEqual(readSectionGroup("tag:VIP"), { kind: "tag", value: "vip" });
		assert.deepEqual(readSectionGroup("tag:early%20bird"), { kind: "tag", value: "early bird" });
		assert.deepEqual(readSectionGroup(`segment:${SEGMENT.toUpperCase()}`), { kind: "segment", value: SEGMENT });
		for (const value of ["tag:", "tag:%E0%A4%A", "segment:42", "list:vip", "vip", ""]) assert.equal(readSectionGroup(value), null, value);

		assert.deepEqual(readSectionRule({}), { group: null, isExcept: false, place: "both" });
		assert.deepEqual(readSectionRule({ hide: "tag:vip", where: "EMAIL" }), { group: { kind: "tag", value: "vip" }, isExcept: true, place: "email" });
		assert.equal(readSectionRule({ show: "tag:a", hide: "tag:b" }), null, "who sees it and who doesn't at once");
		assert.equal(readSectionRule({ where: "print" }), null);
		assert.equal(readSectionRule({ show: "" }), null, "an empty value names nobody");

		const rule = { group: { kind: "tag", value: "early bird" }, isExcept: true, place: "email" };
		assert.deepEqual(writeSectionRule(rule), { "data-hide": "tag:early%20bird", "data-where": "email" });
		assert.deepEqual(readSectionRule({ hide: "tag:early%20bird", where: "email" }), rule);
		assert.deepEqual(writeSectionRule({ group: null, place: "both" }), {}, "everyone, everywhere: no attribute");
	});

	test("each reader's email has their sections; the website its own, to every visitor", () => {
		const vip = { tags: ["vip"], segments: { [SEGMENT]: false } };
		const newbie = { tags: [], segments: { [SEGMENT]: true } };
		assert.ok(shows(forReader(ISSUE, vip), "For all", "VIP only", "Not new", "Email only", "Bye"));
		assert.ok(shows(forReader(ISSUE, newbie), "For all", "Email only", "Bye"));
		assert.ok(shows(forReader(ISSUE, { tags: [] }), "For all", "Email only", "Bye"), "a segment the reader's isn't known in shows to nobody, even everyone except its readers");
		assert.ok(shows(forWeb(ISSUE), "For all", "Not new", "Web only", "Bye"), "who sees it doesn't count on the website");
		assert.ok(shows(withEmailSections(ISSUE), "For all", "VIP only", "Not new", "Email only", "Bye"));
		assert.ok(shows(withAllSections(ISSUE), "For all", "VIP only", "Not new", "Web only", "Email only", "Bye"));
		assert.ok(shows(forEmail(ISSUE, EVERY_READER), "For all", "VIP only", "Not new", "Email only", "Bye"), "a test email has them all");
		assert.ok(shows(forEmail(ISSUE), "For all", "Email only", "Bye"), "without a reader, only those for everyone");
		assert.doesNotMatch(forReader(ISSUE, vip), /<\/?section/, "the tags go");

		const reader = toSectionReader({ _id: "a1", tags: ["vip"] }, new Map([[SEGMENT, new Set(["a1"])]]));
		assert.deepEqual(reader, { tags: ["vip"], segments: { [SEGMENT]: true } });
	});

	test("a section that can't be resolved shows to nobody", () => {
		const nested = `${section(' data-show="tag:vip"', `<p>a</p>${section(' data-show="tag:x"', "<p>b</p>")}<p>c</p>`)}<p>after</p>`;
		assert.equal(forReader(nested, { tags: [] }), "<p>after</p>", "what's in a hidden section goes with it");
		assert.equal(forReader(nested, { tags: ["vip"] }), "<p>a</p><p>c</p><p>after</p>");
		assert.equal(forReader('<p>a</p><section data-show="tag:vip"><p>secret', { tags: [] }), "<p>a</p>", "one left open runs to the end");
		assert.equal(forReader("<p>a</p></section><p>b</p>", { tags: [] }), "<p>a</p><p>b</p>", "an end tag with nothing to close goes");
		assert.equal(forReader(section(' data-show="tag:"', "<p>x</p>"), { tags: [""] }), "", "rules it can't read");
		const hiding = `${section(' data-show="tag:vip"', '<p>s1</p><script></section></script><!-- </section> --><a title="</section>">s2</a>')}<p>out</p>`;
		assert.equal(forReader(hiding, { tags: [] }), "<p>out</p>", "a </section> in a script, a comment or an attribute closes nothing");
		assert.equal(forReader("<p>no sections</p><style>x</style>", { tags: [] }), "<p>no sections</p><style>x</style>", "HTML without a section comes back as it was");

		assert.equal(cleanRichHtml(`<p>a</p>${section(' data-show="tag:vip"', "<p>secret</p>")}<p>b</p>`), "<p>a</p><p>b</p>", "the cleaners drop a section left");
		const email = renderEmail({ format: "rich", html: ISSUE, subject: "Hi", newsletter: { name: "Field notes" } });
		assert.ok(!/VIP only|Not new|Web only|Email only/.test(email.html + email.text), "an email nobody resolved shows none");
		const block = '<div data-html-block="">&lt;section style="padding:8px"&gt;Layout&lt;/section&gt;</div>';
		assert.match(renderEmail({ format: "rich", html: block, subject: "Hi" }).html, /<section style="padding:8px">Layout<\/section>/, "an HTML block's own <section> is layout");
	});

	test("the website, its share picture and the archive page only have the web's sections", () => {
		const issue = `${section(' data-show="tag:vip" data-where="email"', '<p>VIP <img src="https://cdn.example.com/vip.png" alt=""></p>')}${section(' data-show="tag:vip"', "<p>Promo</p>")}<p>Public</p>`;
		const { html } = renderIssueBody({ format: "rich", html: issue });
		assert.ok(!html.includes("VIP") && !html.includes("vip.png"));
		assert.ok(html.includes("Promo"), "a section for some readers on the website too shows to every visitor");
		assert.ok(html.includes("Public"));
	});

	test("the checks read every section, whoever it's for", () => {
		const hidden = section(' data-show="tag:vip" data-where="email"', '<p>Lorem ipsum</p><div data-button=""><a>Join</a></div>');
		assert.ok(findContentWarnings(hidden).some(({ id }) => id === "placeholder-text"));
		assert.ok(findButtonProblem(hidden), "a button without its link holds the send in a section too");
	});

	test("what holds the send, and what only rich content holds", () => {
		assert.equal(findSectionProblem(ISSUE, [SEGMENT]), null);
		assert.equal(findSectionProblem(ISSUE, []), SECTION_SEGMENT_DELETED);
		assert.equal(findSectionProblem(section(' data-hide="tag:"', "x"), []), SECTION_UNREADABLE);
		assert.equal(hasNestedSections(ISSUE), false);
		assert.equal(hasNestedSections(section("", section("", "x"))), true);
		assert.deepEqual(listSectionGroups(ISSUE), [
			{ kind: "tag", value: "vip" },
			{ kind: "segment", value: SEGMENT },
		]);
		assert.equal(listSections(ISSUE).length, 4);
		assert.match('# Hi\n\n<section data-show="tag:vip">', SECTION_ATTRIBUTE_PATTERN);
		assert.doesNotMatch("<section><p>A designed email's own layout</p></section>", SECTION_ATTRIBUTE_PATTERN);
		assert.equal(describeSectionReaders(listSections(ISSUE)[1], [{ id: SEGMENT, name: "New" }]), "Everyone except readers in “New”");
		assert.equal(describeSectionReaders(listSections(ISSUE)[1], []), "Everyone except readers in a deleted segment");
	});

	test("each recipient's email, a test email and the size check", () => {
		const newsletter = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "hello@example.net", postalAddress: "1 Main St, Paris" };
		const campaign = { format: "rich", subject: "Issue", html: ISSUE };
		const contact = { _id: "64f1a2b3c4d5e6f7a8b9c0d1", email: "reader@example.com" };
		const vip = buildRecipientEmail({ campaign, newsletter, contact, reader: { tags: ["vip"], segments: { [SEGMENT]: true } } });
		assert.ok(vip.html.includes("VIP only") && !vip.html.includes("Not new") && !vip.html.includes("Web only"));
		assert.ok(vip.text.includes("VIP only"), "the plain text too");
		const test = buildRecipientEmail({ campaign, newsletter, contact, reader: EVERY_READER });
		assert.ok(["VIP only", "Not new", "Email only"].every((part) => test.html.includes(part)) && !test.html.includes("Web only"));
		const unknown = buildRecipientEmail({ campaign, newsletter, contact });
		assert.ok(!unknown.html.includes("VIP only") && !unknown.html.includes("Not new"));
	});

	test("a section's rules in an HTML block's HTML: the block goes, from every email and the website", () => {
		const block = (html) => `<div data-html-block="">${html}</div>`;
		const secret = '&lt;section data-show="tag:vip" data-where="email"&gt;&lt;p&gt;Secret &lt;img src="https://cdn.example.com/vip.png" width="600"&gt;&lt;/p&gt;&lt;/section&gt;';
		const issue = `<p>For all</p>${block(secret)}`;
		const newsletter = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "hello@example.net", postalAddress: "1 Main St, Paris" };
		const contact = { _id: "64f1a2b3c4d5e6f7a8b9c0d1", email: "reader@example.com" };
		for (const reader of [{ tags: ["vip"], segments: {} }, { tags: [], segments: {} }, EVERY_READER]) {
			const email = buildRecipientEmail({ campaign: { format: "rich", subject: "Issue", html: issue }, newsletter, contact, reader });
			assert.ok(email.html.includes("For all") && !`${email.html}${email.text}`.includes("Secret"), JSON.stringify(reader));
		}
		assert.ok(!renderIssueBody({ format: "rich", html: issue }).html.includes("Secret"), "nor the website");
		assert.equal(firstImageUrl({ format: "rich", html: forWeb(issue) }), null, "nor the thumbnail");

		assert.equal(hasSectionsInBlocks(issue), true);
		const encoded = block('&lt;section d&#97;ta-hide="tag:vip"&gt;x&lt;/section&gt;');
		assert.equal(hasSectionsInBlocks(section(' data-where="email"', encoded)), true, "read as the cleaners read it, in a section too");
		assert.equal(hasSectionsInBlocks(block('&lt;section &lt;!x&gt; data-show="tag:vip"&gt;x&lt;/section&gt;')), true, "a declaration the cleaner drops hides nothing");
		const unseen = block('&lt;template&gt;&lt;section data-show="tag:vip"&gt;x&lt;/section&gt;&lt;/template&gt;&lt;p&gt;Hi&lt;/p&gt;');
		assert.equal(hasSectionsInBlocks(unseen), false, "nor does what no email shows");
		assert.equal(hasSectionsInBlocks(block('&lt;section style="padding:8px"&gt;Layout&lt;/section&gt;')), false, "a block's own <section> is layout");
		assert.equal(hasSectionsInBlocks(block('&lt;!-- &lt;section data-show="tag:vip"&gt; --&gt;&lt;p&gt;Hi&lt;/p&gt;')), false, "one in a comment is no section");
	});
});

describe("sections in sends, previews, the API and the website", () => {
	let app;
	let m;
	let processed = 0;

	before(async () => {
		app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			archive: await import("../lib/archive-data.js"),
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
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
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
		return user;
	}

	async function newSegment(user) {
		const result = await as(user, () =>
			m.contacts.saveSegment(null, { newsletterId: user.newsletterId, name: "New", match: "all", conditions: [{ field: "signed_up", op: "within", value: 30 }] })
		);
		assert.ok(result.id, JSON.stringify(result));
		return result.id;
	}

	async function draft(user, body) {
		const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)))).split("/").at(-1);
		assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject: "Club news", previewText: "This week", body })), { ok: true });
		return id;
	}

	// Each email the send's jobs gave the provider, by address.
	async function send(user, id) {
		const before = sesEmails.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		while (processed < published.length) {
			const { url, body } = published[processed++];
			if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
		}
		return new Map(sesEmails.slice(before).map((email) => [email.to, email]));
	}

	function issueWith(segmentId) {
		return ISSUE.replace(SEGMENT, segmentId);
	}

	test("each reader gets their own sections, and so do the preview, the API's counts and the website", async () => {
		const alice = await customer("sections-alice@example.com");
		const contact = (email, fields) => ({ accountId: alice.accountId, newsletterId: alice.newsletterId, email, status: "active", ...fields });
		await m.Contact.insertMany([
			contact("vip@sections.example.com", { tags: ["vip"], subscribedAt: new Date(Date.now() - 400 * DAY_MS) }),
			contact("new@sections.example.com", { subscribedAt: new Date(Date.now() - 2 * DAY_MS) }),
			contact("other@sections.example.com", { subscribedAt: new Date(Date.now() - 400 * DAY_MS) }),
		]);
		const segmentId = await newSegment(alice);
		const id = await draft(alice, issueWith(segmentId));
		await m.Newsletter.updateOne({ accountId: alice.accountId, _id: alice.newsletterId }, { $set: { archiveEnabled: true } });

		const preview = async (contactEmail) =>
			(await callApi("GET", `/api/v1/campaigns/${id}/preview${contactEmail ? `?contact=${contactEmail}` : ""}`, { key: alice.key })).body.html;
		assert.ok(shows(await preview("vip@sections.example.com"), "For all", "VIP only", "Not new", "Email only", "Bye"));
		assert.ok(shows(await preview("new@sections.example.com"), "For all", "Email only", "Bye"));
		assert.ok(shows(await preview(), "For all", "Not new", "Email only", "Bye"), "the sample reader has no tags and is in no segment");

		const [picked] = (await as(alice, () => m.campaigns.findPreviewContacts(alice.newsletterId, "new@", [segmentId]))).contacts;
		assert.deepEqual([picked.tags, picked.segments], [[], { [segmentId]: true }], "the dashboard's picker gets what sections read");

		const detail = (await callApi("GET", `/api/v1/campaigns/${id}`, { key: alice.key })).body;
		assert.deepEqual(detail.sections, [
			{ readers: "Only readers tagged “vip”", where: "email", count: 1 },
			{ readers: "Everyone except readers in “New”", where: "both", count: 2 },
			{ readers: "Everyone", where: "web", count: null },
			{ readers: "Everyone", where: "email", count: 3 },
		]);
		const counts = await callApi("POST", `/api/v1/campaigns/${id}/sections/count`, { key: alice.key, body: { groups: ["tag:vip", `segment:${segmentId}`] } });
		assert.deepEqual(counts.body, {
			readers: 3,
			groups: [
				{ group: "tag:vip", name: "vip", readers: 1 },
				{ group: `segment:${segmentId}`, name: "New", readers: 1 },
			],
		});

		assert.deepEqual(await as(alice, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.ok(shows(sesEmails.at(-1).html, "For all", "VIP only", "Not new", "Email only", "Bye"), "a test email has every section an email can have");

		const sent = await send(alice, id);
		assert.ok(shows(sent.get("vip@sections.example.com").html, "For all", "VIP only", "Not new", "Email only", "Bye"));
		assert.ok(shows(sent.get("new@sections.example.com").html, "For all", "Email only", "Bye"));
		assert.ok(shows(sent.get("other@sections.example.com").html, "For all", "Not new", "Email only", "Bye"));
		assert.ok(!sent.get("new@sections.example.com").text.includes("VIP only"), "nor in the plain text");

		const campaign = await m.Campaign.findOne({ accountId: alice.accountId, _id: id }).lean();
		const newsletter = await m.archive.getArchiveNewsletter(alice.slug);
		const issue = await m.archive.getArchiveIssue(newsletter, campaign.archiveSlug);
		assert.ok(shows(renderIssueBody(issue).html, "For all", "Not new", "Web only", "Bye"), "the website: its sections for the web, to every visitor");
	});

	test("saves refuse sections that would show to everyone, can't be read, nest, or name a segment that isn't theirs", async () => {
		const bob = await customer("sections-bob@example.com");
		const carol = await customer("sections-carol@example.com");
		const carolSegment = await newSegment(carol);
		const id = await draft(bob, "<p>Hi</p>");
		const update = (content, format = "rich") => callApi("PATCH", `/api/v1/campaigns/${id}`, { key: bob.key, body: { format, content } });
		const error = async (response, status, code) => {
			assert.equal(response.status, status, JSON.stringify(response.body));
			assert.equal(response.body.error.code, code);
			return response.body.error.message;
		};

		assert.match(await error(await update('# Hi\n\n<section data-show="tag:vip">Secret</section>', "markdown"), 400, "validation_failed"), /rich content only/);
		assert.match(await error(await update('<html><body><section data-hide="tag:vip">Secret</section></body></html>', "html"), 400, "validation_failed"), /rich content only/);
		assert.match(await error(await update(section(' data-show="tag:"', "<p>x</p>")), 400, "validation_failed"), /can't be read/);
		assert.match(await error(await update(section(' data-show="tag:a"', section("", "<p>x</p>"))), 400, "validation_failed"), /inside another/);
		const inBlock = '<div data-html-block>&lt;section data-show="tag:vip"&gt;Secret&lt;/section&gt;</div>';
		assert.match(await error(await update(inBlock), 400, "validation_failed"), /HTML block's HTML/);
		assert.match(await error(await update(section(` data-show="segment:${carolSegment}"`, "<p>x</p>")), 404, "not_found"), /isn't one of the newsletter's/);
		assert.equal((await update(section(' data-show="tag:vip" data-where="email"', "<p>x</p>"))).status, 200);
		const many = Array.from({ length: 21 }, (_, index) => section(` data-show="tag:t${index}"`, "<p>x</p>")).join("");
		assert.match(await error(await update(many), 400, "validation_failed"), /20 sections at most/);
	});

	test("a picture only some emails have never becomes the issue's thumbnail", async () => {
		const dave = await customer("sections-dave@example.com");
		const response = await callApi("POST", "/api/v1/campaigns", {
			key: dave.key,
			body: {
				newsletter: dave.newsletterId,
				format: "rich",
				content: `${section(' data-show="tag:vip" data-where="email"', '<img src="https://cdn.example.com/vip.png" width="600">')}<img src="https://cdn.example.com/public.png" width="600">`,
			},
		});
		assert.equal(response.status, 201, JSON.stringify(response.body));
		const campaign = await m.Campaign.findOne({ accountId: dave.accountId, _id: response.body.id }).lean();
		assert.equal(campaign.thumbnailUrl, "https://cdn.example.com/public.png");
	});

	test("a segment stays while a scheduled issue has a section for it, and a deleted one holds a draft's send", async () => {
		const erin = await customer("sections-erin@example.com");
		await m.Contact.create({ accountId: erin.accountId, newsletterId: erin.newsletterId, email: "reader@erin.example.com", status: "active" });
		const segmentId = await newSegment(erin);
		const scheduled = await draft(erin, section(` data-show="segment:${segmentId}" data-where="email"`, "<p>Welcome</p>"));
		const later = new Date(Date.now() + 2 * DAY_MS).toISOString();
		assert.deepEqual(await as(erin, () => m.campaigns.scheduleCampaign(scheduled, { scheduledAt: later })), { ok: true });
		const remove = await callApi("DELETE", `/api/v1/segments/${segmentId}`, { key: erin.key });
		assert.equal(remove.status, 409, JSON.stringify(remove.body));
		assert.match(remove.body.error.message, /has a section for this segment/);

		assert.deepEqual(await as(erin, () => m.campaigns.unscheduleCampaign(scheduled)), { ok: true });
		assert.equal((await callApi("DELETE", `/api/v1/segments/${segmentId}`, { key: erin.key })).status, 200);
		const detail = (await callApi("GET", `/api/v1/campaigns/${scheduled}`, { key: erin.key })).body;
		assert.deepEqual(detail.sendProblem, { code: "send_check_failed", message: SECTION_SEGMENT_DELETED });
		assert.deepEqual(detail.sections, [{ readers: "Only readers in a deleted segment", where: "email", count: null }]);
		const saved = await as(erin, () => m.campaigns.saveCampaign(scheduled, { subject: "Still saves", body: section(` data-show="segment:${segmentId}" data-where="email"`, "<p>Welcome!</p>") }));
		assert.deepEqual(saved, { ok: true }, "a segment it named before can stay, so the draft keeps saving");
	});

	test("a section's menu counts every tag and segment among the readers a campaign goes to, a tag only unsubscribed contacts have at 0, and only for its own account", async () => {
		const dana = await customer("sections-dana@example.com");
		const contact = (email, fields) => ({ accountId: dana.accountId, newsletterId: dana.newsletterId, email, status: "active", ...fields });
		await m.Contact.insertMany([
			contact("vip1@dana.example.com", { tags: ["vip", "club"], subscribedAt: new Date(Date.now() - 2 * DAY_MS) }),
			contact("vip2@dana.example.com", { tags: ["vip"], subscribedAt: new Date(Date.now() - 400 * DAY_MS) }),
			contact("gone@dana.example.com", { tags: ["former"], status: "unsubscribed", subscribedAt: new Date(Date.now() - 2 * DAY_MS) }),
		]);
		const segmentId = await newSegment(dana);
		const id = await draft(dana, "<p>Hi</p>");

		const { status, body } = await callApi("POST", `/api/v1/campaigns/${id}/sections/count`, { key: dana.key, body: { all: true } });
		assert.equal(status, 200, JSON.stringify(body));
		assert.deepEqual(body, {
			readers: 2,
			groups: [
				{ group: "tag:vip", name: "vip", readers: 2 },
				{ group: "tag:club", name: "club", readers: 1 },
				{ group: "tag:former", name: "former", readers: 0 },
				{ group: `segment:${segmentId}`, name: "New", readers: 1 },
			],
		});
		assert.deepEqual(await as(dana, () => m.campaigns.countAllSectionReaders(id)), body, "the dashboard's menu reads the same");
		const everyone = await callApi("POST", `/api/v1/campaigns/${id}/sections/count`, { key: dana.key, body: { groups: [] } });
		assert.deepEqual(everyone.body, { readers: 2, groups: [] }, "no groups counts everyone, for the menu's button");

		const eve = await customer("sections-eve@example.com");
		const theirs = await callApi("POST", `/api/v1/campaigns/${id}/sections/count`, { key: eve.key, body: { all: true } });
		assert.equal(theirs.status, 404, JSON.stringify(theirs.body));
	});
});
