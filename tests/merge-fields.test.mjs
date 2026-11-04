import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { contactFieldValues } from "../lib/contact-fields.js";
import { toPreviewFrame } from "../lib/email-preview.js";
import {
	fillForReader,
	fillMergeTags,
	findBrokenMergeTags,
	findMergeTags,
	findTagsWithoutFallback,
	formatMergeValue,
	withMergeFallbacks,
	withoutMergeTags,
} from "../lib/merge-tags.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { renderEmail } from "../lib/render-email.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { activate, addAuthor, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

// The account's own fields as merge tags, {{key}} and {{key|fallback}} (lib/merge-tags.js): each reader's value by its
// type, escaped in HTML, the fallback without one, the same in sends and in previews, and only the sending account's.
const FIELDS = [
	{ key: "plan", label: "Plan", type: "text" },
	{ key: "seats", label: "Seats", type: "number" },
	{ key: "birthday", label: "Birthday", type: "date" },
];
const NEWSLETTER = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "hello@example.net", postalAddress: "1 Main St, Paris" };
const CAMPAIGN = {
	format: "rich",
	subject: "{{first_name|Friend}}, your {{plan|free}} plan",
	previewText: "{{seats|No}} seats, renewing {{ birthday | soon }}",
	html: "<p>Hi {{first_name|there}}: {{PLAN}} plan, {{seats}} seats, born {{birthday|on a day we don't know}}. {{unknown|x}} {{company}}</p>",
};

function bodyOf(html) {
	return /<td class="body">([\s\S]*?)<\/td><\/tr>/.exec(html)?.[1];
}

function preheaderOf(html) {
	return /<div [^>]*data-preheader>([\s\S]*?)<\/div>/.exec(html)?.[1];
}

describe("field merge tags", () => {
	test("each type prints in a form people read", () => {
		assert.equal(formatMergeValue("text", "  Pro "), "Pro");
		assert.equal(formatMergeValue("number", 1250), "1,250");
		assert.equal(formatMergeValue("number", 4.5), "4.5");
		assert.equal(formatMergeValue("number", -1234567.891), "-1,234,567.891");
		assert.equal(formatMergeValue("date", new Date("1991-04-12T00:00:00.000Z")), "April 12, 1991", "as stored");
		assert.equal(formatMergeValue("date", "1991-04-12"), "April 12, 1991", "as the API gives it");
		assert.equal(formatMergeValue("date", "2026-01-01"), "January 1, 2026", "the day it's stored for, whatever the time zone");
		for (const empty of [null, undefined, ""]) assert.equal(formatMergeValue("text", empty), "");
		assert.equal(formatMergeValue("date", "not a date"), "");
		assert.equal(formatMergeValue("number", "many"), "");
	});

	test("a reader's values fill their tags, escaped in HTML, and readers without one get the fallback or nothing", () => {
		const email = { subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText, html: CAMPAIGN.html, text: "{{plan}} / {{seats}}" };
		const filled = fillForReader(email, { firstName: "Jo", fields: { plan: '<b>Pro</b> & "Max"', seats: 1250, birthday: "1991-04-12" } }, FIELDS);
		assert.equal(filled.subject, 'Jo, your <b>Pro</b> & "Max" plan', "a subject is text");
		assert.equal(filled.previewText, "1,250 seats, renewing April 12, 1991");
		assert.equal(
			filled.html,
			"<p>Hi Jo: &lt;b&gt;Pro&lt;/b&gt; &amp; &quot;Max&quot; plan, 1,250 seats, born April 12, 1991. {{unknown|x}} {{company}}</p>"
		);
		assert.equal(filled.text, '<b>Pro</b> & "Max" / 1,250');

		const without = fillForReader(email, { firstName: "", fields: { plan: "  ", seats: null } }, FIELDS);
		assert.equal(without.subject, "Friend, your free plan");
		assert.equal(without.previewText, "No seats, renewing soon");
		assert.equal(without.html, "<p>Hi there:  plan,  seats, born on a day we don&#39;t know. {{unknown|x}} {{company}}</p>");
		assert.equal(
			fillForReader({ subject: "{{plan|x}}" }, { fields: { plan: "Pro\r\nBcc: x@example.com" } }, FIELDS).subject,
			"Pro Bcc: x@example.com",
			"a subject stays on one line"
		);
		assert.equal(fillMergeTags("<p>{{plan|<i>free</i> &amp; more}}</p>", { contactFields: FIELDS, isHtml: true }), "<p>&lt;i&gt;free&lt;/i&gt; &amp; more</p>");
	});

	test("only the account's own fields are tags: a value without its field and anything else stay as written", () => {
		const values = { plan: "Pro", company: "Acme" };
		assert.equal(fillMergeTags("{{plan}} {{company}} {{first_name}}", { firstName: "Jo", values }), "{{plan}} {{company}} Jo", "no fields, no field tags");
		assert.equal(fillMergeTags("{{plan}} {{company|-}}", { values, contactFields: FIELDS }), "Pro {{company|-}}", "a deleted field's value stays hidden");
		assert.equal(
			fillMergeTags("{{constructor|none}} {{tostring}}", { values: {}, contactFields: [{ key: "constructor", type: "text" }] }),
			"none {{tostring}}",
			"a key named like a property every object has"
		);
		assert.deepEqual(findBrokenMergeTags(["{{plan|free}} {{ SEATS }}", "{{birthday}} {{first_name}}"], FIELDS), []);
		assert.deepEqual(findBrokenMergeTags(["{{plan}} {{company}}", "{{FNAME}} {{ subscriber.name }}"], FIELDS), [
			"{{company}}",
			"{{FNAME}}",
			"{{ subscriber.name }}",
		]);
		assert.deepEqual(findBrokenMergeTags(["{{plan}}"]), ["{{plan}}"], "another account's field is no tag here");
	});

	test("public pages print each tag's fallback, and a page's address drops every tag", () => {
		assert.equal(withMergeFallbacks("Your {{plan|free}} plan, {{seats}} seats", { contactFields: FIELDS }), "Your free plan,  seats");
		assert.equal(withMergeFallbacks("<p>{{plan|<i>free</i>}}</p>", { isHtml: true, contactFields: FIELDS }), "<p>&lt;i&gt;free&lt;/i&gt;</p>");
		assert.equal(withMergeFallbacks("Using {{user}} in templates", { contactFields: FIELDS }), "Using {{user}} in templates", "text about templates stays");
		assert.equal(withoutMergeTags("{{first_name|Friend}}, your {{plan|free}} plan {{other}}"), "Friend, your free plan ");
	});

	test("the editor draws the account's tags only, each with its fallback", () => {
		const text = "Hi {{first_name|there}}, {{Plan}} {{nope}} {{seats|0}} {{ birthday | soon }}";
		assert.deepEqual(
			findMergeTags(text, FIELDS).map(({ index, length, key, fallback }) => [text.slice(index, index + length), key, fallback]),
			[
				["{{first_name|there}}", "first_name", "there"],
				["{{Plan}}", "plan", ""],
				["{{seats|0}}", "seats", "0"],
				["{{ birthday | soon }}", "birthday", "soon"],
			]
		);
	});

	test("the review step takes the account's tags, still points out any other, and counts the subject with fallbacks", () => {
		const rendered = { html: "<p>{{unsubscribe_url}}</p>", bytes: 100 };
		const base = { previewText: "Hi {{seats|no}}", testSentAt: new Date(), body: "<p>{{birthday|soon}} {{PLAN|free}}</p>" };
		const checks = (campaign, contactFields) =>
			getPresendChecks({ campaign: { ...base, ...campaign }, newsletter: { postalAddress: "1 Main St" }, rendered, contactFields, isSendingEnabled: true })
				.checks;
		assert.equal(checks({ subject: "Your {{plan|free}} plan" }, FIELDS).some(({ id }) => id === "merge-tags"), false);
		const broken = checks({ subject: "Your {{plan|free}} plan, {{FNAME}}" }, FIELDS).find(({ id }) => id === "merge-tags");
		assert.equal(broken.isWarning, true);
		assert.equal(broken.message, "{{FNAME}} goes out as written: only {{first_name}} and your contact fields are filled in");
		const withoutFields = checks({ subject: "Your {{plan|free}} plan" }, []).find(({ id }) => id === "merge-tags");
		assert.match(withoutFields.message, /^\{\{plan\|free\}\} goes out as written/);
		const subject = `${"x".repeat(60)} {{plan|free}}`;
		assert.equal(checks({ subject }, FIELDS).find(({ id }) => id === "subject-length").detail, "65", "the fallback's length, not the tag's");
	});

	test("a name or field without a fallback leaves a gap, which the review step points out after tags that go out as written", () => {
		const fields = [...FIELDS, { key: "tier", label: "VIP tier", type: "text" }];
		assert.deepEqual(findTagsWithoutFallback(["Hi {{first_name}}, {{ Plan }} {{plan|}} {{seats|0}} {{nope}}", "<p>{{first_name}} {{tier}}</p>"], fields), [
			{ tag: "{{first_name}}", name: "first name" },
			{ tag: "{{ Plan }}", name: "plan" },
			{ tag: "{{tier}}", name: "VIP tier" },
		]);
		assert.deepEqual(findTagsWithoutFallback(["{{plan}}"]), [], "another account's field goes out as written instead");

		const rendered = { html: "<p>{{unsubscribe_url}}</p>", bytes: 100 };
		const checks = (campaign) =>
			getPresendChecks({
				campaign: { subject: "Your plan", previewText: "Hi", testSentAt: new Date(), body: "<p>Hi</p>", ...campaign },
				newsletter: { postalAddress: "1 Main St" },
				rendered,
				contactFields: FIELDS,
				isSendingEnabled: true,
			}).checks.find(({ id }) => id === "merge-tags");
		const gap = checks({ subject: "Your {{plan}} plan" });
		assert.deepEqual([gap.isWarning, gap.message, gap.words, gap.field, gap.detail], [
			true,
			"{{plan}} leaves a gap for readers with no plan: add | and a word inside the braces",
			"{{plan}}",
			"subject",
			null,
		]);
		const both = checks({ body: "<p>Hi {{first_name}}, {{FNAME}}</p>" });
		assert.deepEqual([both.message, both.field, both.detail], [
			"{{FNAME}} goes out as written: only {{first_name}} and your contact fields are filled in",
			"content",
			"2",
		]);
		assert.equal(checks({ body: "<p>Hi {{first_name|}}</p>" }), undefined, "a | alone leaves the gap on purpose");
	});

	test("a recipient's email and the dashboard's preview fill the same values the same way", () => {
		const frame = toPreviewFrame(renderEmail({ ...CAMPAIGN, newsletter: NEWSLETTER }).html);
		const readers = [
			{ firstName: "Jo", fields: { plan: "Pro & co", seats: 1250, birthday: new Date("1991-04-12T00:00:00.000Z") } },
			{ firstName: "", fields: {} },
			{ firstName: "Ana", fields: { plan: '<img src=x onerror="alert(1)">', seats: 0.5 } },
		];
		for (const reader of readers) {
			const contact = { _id: "64f1a2b3c4d5e6f7a8b9c0d1", email: "jo@example.com", ...reader };
			const sent = buildRecipientEmail({ campaign: CAMPAIGN, newsletter: NEWSLETTER, contact, contactFields: FIELDS });
			// The preview's picker gets the values as the API lists them, dates as YYYY-MM-DD.
			const listed = { firstName: reader.firstName, fields: contactFieldValues(reader, FIELDS) };
			const shown = fillForReader({ subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText, html: frame }, listed, FIELDS);
			assert.equal(shown.subject, sent.subject, reader.firstName);
			assert.equal(bodyOf(shown.html), bodyOf(sent.html), reader.firstName);
			assert.equal(preheaderOf(shown.html), preheaderOf(sent.html), reader.firstName);
			assert.ok(!bodyOf(sent.html).includes("<img src=x"), reader.firstName);
		}
	});
});

describe("field tags in sends, tests and previews", () => {
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
			Contact: (await import("../models/Contact.js")).default,
		};
	});

	after(() => app?.stop());

	async function customer(email, fields) {
		const user = await signIn(email);
		await activate(user);
		const slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(
				m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" }))
			)
		);
		user.newsletterId = url.split("/").at(-1);
		await addAuthor(user);
		for (const field of fields) assert.ok((await as(user, () => m.contacts.createContactField(field))).field, field.label);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
		return user;
	}

	async function draft(user, values) {
		const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		const id = url.split("/").at(-1);
		assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, values)), { ok: true });
		return id;
	}

	// Each email the send's jobs gave the provider, by address.
	async function send(user, id) {
		const before = sesEmails.length;
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		while (processed < published.length) {
			const { url: jobUrl, body: job } = published[processed++];
			if (jobUrl.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(jobUrl, { method: "POST", body: job }));
		}
		return new Map(sesEmails.slice(before).map((email) => [email.to, email]));
	}

	test("each contact gets their own values, as the preview and preview_campaign show them, and another account's fields print nothing", async () => {
		const alice = await customer("fields-alice@example.com", [
			{ label: "Plan", type: "text" },
			{ label: "Seats", type: "number" },
			{ label: "Birthday", type: "date" },
		]);
		const bob = await customer("fields-bob@example.com", []);
		const contact = (owner, email, fields, firstName) => ({
			accountId: owner.accountId,
			newsletterId: owner.newsletterId,
			email,
			status: "active",
			...(firstName && { firstName }),
			fields,
			subscribedAt: new Date(),
		});
		await m.Contact.insertMany([
			contact(alice, "jo@fields.example.com", { plan: "Pro & co", seats: 1250, birthday: new Date("1991-04-12T00:00:00.000Z") }, "Jo"),
			contact(alice, "nameless@fields.example.com", {}),
			contact(alice, "fields-alice@example.com", { plan: "Team" }),
			// A value under a key only Alice's account has a field for.
			contact(bob, "sam@fields.example.com", { plan: "Hidden" }, "Sam"),
		]);
		const values = { subject: "{{first_name|Friend}}, your {{plan|free}} plan", previewText: "{{seats|No}} seats", body: "<p>Born {{birthday|someday}}, {{plan}}.</p>" };
		const aliceIssue = await draft(alice, values);
		const bobIssue = await draft(bob, values);

		const preview = await callApi("GET", `/api/v1/campaigns/${aliceIssue}/preview?contact=jo@fields.example.com`, { key: alice.key });
		assert.equal(preview.status, 200, JSON.stringify(preview.body));
		assert.deepEqual(preview.body.contact.fields, { plan: "Pro & co", seats: 1250, birthday: "1991-04-12" });
		assert.equal(preview.body.subject, "Jo, your Pro & co plan");
		assert.equal(preview.body.previewText, "1,250 seats");
		assert.ok(preview.body.html.includes("<p>Born April 12, 1991, Pro &amp; co.</p>"), preview.body.html);
		const sample = await callApi("GET", `/api/v1/campaigns/${aliceIssue}/preview`, { key: alice.key });
		assert.deepEqual([sample.body.subject, sample.body.previewText], ["Jane, your free plan", "No seats"], "the sample reader has no field values");
		const [picked] = (await as(alice, () => m.campaigns.findPreviewContacts(alice.newsletterId, "jo@"))).contacts;
		assert.deepEqual(picked.fields, { plan: "Pro & co", seats: 1250, birthday: "1991-04-12" }, "the dashboard's picker gets the same values");

		assert.deepEqual(await as(alice, () => m.campaigns.sendTestCampaign(aliceIssue)), { ok: true });
		assert.equal(sesEmails.at(-1).subject, "[Test] Jane, your Team plan", "the test address's own values, as one of the contacts");

		const sent = await send(alice, aliceIssue);
		const jo = sent.get("jo@fields.example.com");
		assert.equal(jo.subject, preview.body.subject, "sent as previewed");
		assert.ok(jo.html.includes("<p>Born April 12, 1991, Pro &amp; co.</p>"), jo.html);
		assert.ok(jo.text.includes("Born April 12, 1991, Pro & co."), jo.text);
		const nameless = sent.get("nameless@fields.example.com");
		assert.equal(nameless.subject, "Friend, your free plan");
		assert.ok(nameless.html.includes("<p>Born someday, .</p>"), nameless.html);

		const sam = (await send(bob, bobIssue)).get("sam@fields.example.com");
		assert.equal(sam.subject, "Sam, your {{plan|free}} plan", "Bob's account has no such field, whatever Alice's has");
		assert.ok(sam.html.includes("{{plan}}") && !sam.html.includes("Hidden"), sam.html);
		const bobPreview = await callApi("GET", `/api/v1/campaigns/${bobIssue}/preview?contact=sam@fields.example.com`, { key: bob.key });
		assert.deepEqual(bobPreview.body.contact.fields, {});
		assert.ok(!bobPreview.body.html.includes("Hidden"));
	});
});
