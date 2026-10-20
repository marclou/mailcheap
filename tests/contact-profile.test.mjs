import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderIssueBody } from "../lib/archive-content.js";
import {
	checkFieldDefinition,
	cleanFirstName,
	cleanTag,
	cleanTags,
	contactFieldValues,
	fieldKeyFromLabel,
	parseTagList,
	readFieldValue,
	readFieldValues,
} from "../lib/contact-fields.js";
import { getContactWrites } from "../lib/contact-import.js";
import { getCsvHeader, toCsvRow } from "../lib/contacts-csv.js";
import { guessFieldType, mapColumns, normalizeImportRow, sanitizeImportRow, suggestProfileColumns } from "../lib/csv-import.js";
import { fillMergeTags, fillSampleName, fillSubject, findBrokenMergeTags, firstNameTag, withMergeFallbacks } from "../lib/merge-tags.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { checkSegmentRules, compileSegment, describeSegment } from "../lib/segments.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const FIELDS = [
	{ key: "company", label: "Company", type: "text" },
	{ key: "seats", label: "Seats", type: "number" },
	{ key: "birthday", label: "Birthday", type: "date" },
];

describe("first-name merge tags", () => {
	test("a reader's first name goes in, escaped in HTML, and readers without one get the fallback", () => {
		assert.equal(fillMergeTags("Hi {{first_name|there}},", { firstName: "Jane" }), "Hi Jane,");
		assert.equal(fillMergeTags("Hi {{first_name|there}},", { firstName: "  " }), "Hi there,");
		assert.equal(fillMergeTags("Hi {{ first_name }}!", { firstName: "" }), "Hi !", "no fallback prints nothing");
		assert.equal(fillMergeTags("{{FIRST_NAME|you}}", { firstName: "Ana" }), "Ana", "any case");
		assert.equal(
			fillMergeTags("<p>Hi {{first_name|there}}</p>", { firstName: '<img src=x onerror="alert(1)">', isHtml: true }),
			"<p>Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>"
		);
		assert.equal(fillSubject("Hi {{first_name|there}}", "Jane\r\nBcc: x@example.com"), "Hi Jane Bcc: x@example.com", "a subject stays on one line");
		assert.equal(withMergeFallbacks("Hi {{first_name|friend}} and {{first_name}}"), "Hi friend and ");
		assert.equal(fillSampleName("Hi {{first_name|there}}"), "Hi Jane");
		assert.equal(firstNameTag(), "{{first_name|there}}");
	});

	test("anything else in double braces is pointed out, since it would go out as written", () => {
		assert.deepEqual(findBrokenMergeTags("Hi {{first_name|there}}", "<p>{{ first_name }}</p>"), []);
		assert.deepEqual(findBrokenMergeTags("Hi {{firstname}}", "<p>{{<strong>first_name</strong>}}</p>", "{{ subscriber.name }}", "{{firstname}}"), [
			"{{firstname}}",
			"{{<strong>first_name</strong>}}",
			"{{ subscriber.name }}",
		]);
	});

	test("each recipient's email greets them, in the subject, the HTML and the text, and test contacts without a name get the fallback", () => {
		const newsletter = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "jane@example.net", postalAddress: "1 Main St, Paris" };
		const campaign = { format: "rich", subject: "{{first_name|Friend}}, issue 12", previewText: "For {{first_name|you}}", html: "<p>Hi {{first_name|there}},</p>" };
		const named = buildRecipientEmail({ campaign, newsletter, contact: { _id: "64f1a2b3c4d5e6f7a8b9c0d1", email: "jo@example.com", firstName: "Jo & Co" } });
		assert.equal(named.subject, "Jo & Co, issue 12");
		assert.ok(named.html.includes("Hi Jo &amp; Co,"), "escaped in HTML");
		assert.ok(named.html.includes("For Jo &amp; Co"), "the preview text too");
		assert.ok(named.text.includes("Hi Jo & Co,"));
		assert.ok(!named.html.includes("{{"));

		const nameless = buildRecipientEmail({ campaign, newsletter, contact: { _id: "64f1a2b3c4d5e6f7a8b9c0d3", email: "x@example.com" } });
		assert.equal(nameless.subject, "Friend, issue 12");
		assert.ok(nameless.html.includes("Hi there,"));
	});

	test("the archive never shows a reader's name: tags print their fallback", () => {
		const { html } = renderIssueBody({ format: "rich", html: "<p>Hi {{first_name|there}}, {{first_name}}!</p>" });
		assert.ok(html.includes("Hi there, !"), html);
		const markdown = renderIssueBody({ format: "markdown", markdown: "Hi {{first_name|reader}}" });
		assert.ok(markdown.html.includes("Hi reader"));
	});

	test("the review step counts the subject as inboxes show it and flags broken tags", () => {
		const rendered = { html: "<p>{{unsubscribe_url}}</p>", bytes: 100 };
		const base = { previewText: "Hi", testSentAt: new Date(), body: "<p>Hi</p>" };
		const long = "x".repeat(55);
		const { checks } = getPresendChecks({
			campaign: { ...base, subject: `${long} {{first_name|there}}` },
			newsletter: { postalAddress: "1 Main St" },
			rendered,
			isSendingEnabled: true,
		});
		assert.equal(checks.find(({ id }) => id === "subject-length").isOk, true, "61 characters with the fallback");
		assert.equal(checks.some(({ id }) => id === "merge-tags"), false);

		const broken = getPresendChecks({
			campaign: { ...base, subject: "Hi {{FNAME}}" },
			newsletter: { postalAddress: "1 Main St" },
			rendered,
			isSendingEnabled: true,
		}).checks.find(({ id }) => id === "merge-tags");
		assert.equal(broken.isWarning, true);
		assert.match(broken.message, /\{\{FNAME\}\} goes out as written/);
	});
});

describe("contact fields and tags", () => {
	test("tags are lowercase, without commas, unique and limited", () => {
		assert.equal(cleanTag("  VIP  "), "vip");
		assert.equal(cleanTag("a,b"), "a b");
		assert.equal(cleanTag("x".repeat(41)), null);
		assert.equal(cleanTag("   "), null);
		assert.deepEqual(cleanTags(["VIP", "vip", " Podcast ", "", null]), ["vip", "podcast"]);
		assert.deepEqual(parseTagList('vip, "Customer"; podcast|Beta'), ["vip", "customer", "podcast", "beta"]);
		assert.equal(cleanFirstName("  Jane\u0000\n Doe "), "Jane Doe");
	});

	test("a field's key comes from its name, and reserved names, duplicates and the limit are refused", () => {
		assert.equal(fieldKeyFromLabel("Company size"), "company_size");
		assert.equal(fieldKeyFromLabel("Café"), "cafe");
		assert.equal(fieldKeyFromLabel("2nd city"), "f_2nd_city");
		assert.deepEqual(checkFieldDefinition({ label: "Company", type: "text" }), { field: { key: "company", label: "Company", type: "text" } });
		assert.match(checkFieldDefinition({ label: "Email", type: "text" }).problem, /already a contact property/);
		assert.match(checkFieldDefinition({ label: "Company", type: "text" }, FIELDS).problem, /already a field/);
		assert.match(checkFieldDefinition({ label: "Age", type: "color" }).problem, /type must be one of/);
		assert.match(checkFieldDefinition({ label: "!!!", type: "text" }).problem, /letters or digits/);
		const twenty = Array.from({ length: 20 }, (_, index) => ({ key: `f${index}`, label: `F${index}`, type: "text" }));
		assert.match(checkFieldDefinition({ label: "One more", type: "text" }, twenty).problem, /20 fields at most/);
	});

	test("values are read for their type, unknown keys are refused, and output skips empty ones", () => {
		assert.deepEqual(readFieldValue("number", "1,200"), { value: 1200 });
		assert.deepEqual(readFieldValue("number", "many"), { problem: "a number" });
		assert.equal(readFieldValue("date", "2026-02-30").problem, "a date, YYYY-MM-DD");
		assert.equal(readFieldValue("date", "2026-10-18").value.toISOString(), "2026-10-18T00:00:00.000Z");
		assert.deepEqual(readFieldValue("text", " "), { value: null });
		assert.match(readFieldValues({ colour: "red" }, FIELDS).problem, /fields\.colour: no such field \(the account has company, seats, birthday\)/);
		assert.match(readFieldValues({ seats: "lots" }, FIELDS).problem, /fields\.seats needs a number/);
		assert.deepEqual(readFieldValues({ company: "Acme", seats: null }, FIELDS), { values: { company: "Acme", seats: null } });
		const contact = { fields: { company: "Acme", birthday: new Date("1990-05-04T00:00:00Z"), seats: null, gone: "x" } };
		assert.deepEqual(contactFieldValues(contact, FIELDS), { company: "Acme", birthday: "1990-05-04" }, "a deleted field's value shows nowhere");
	});

	test("segments pick contacts by tag, first name and the account's own fields", () => {
		const checked = checkSegmentRules(
			{
				conditions: [
					{ field: "tag", op: "has", value: " VIP " },
					{ field: "first_name", op: "is_set" },
					{ field: "fields.company", op: "contains", value: "acme" },
					{ field: "fields.seats", op: "at_least", value: "10" },
					{ field: "fields.birthday", op: "before", value: "2000-01-01" },
				],
			},
			{ fields: FIELDS }
		);
		assert.ok(checked.rules, checked.problem);
		assert.deepEqual(checked.rules.conditions.slice(0, 2), [
			{ field: "tag", op: "has", value: "vip" },
			{ field: "first_name", op: "is_set" },
		]);
		const filter = compileSegment(checked.rules);
		assert.deepEqual(filter.$and.slice(0, 4), [
			{ tags: "vip" },
			{ firstName: { $nin: [null, ""] } },
			{ "fields.company": { $regex: "acme", $options: "i" } },
			{ "fields.seats": { $gte: 10 } },
		]);
		assert.deepEqual(compileSegment({ match: "all", conditions: [{ field: "tag", op: "has_not", value: "vip" }] }), { tags: { $ne: "vip" } });
		assert.equal(
			describeSegment(checked.rules, FIELDS),
			'Tagged "vip", first name known, company contains "acme", seats at least 10 and birthday before Jan 1, 2000'
		);
		assert.match(checkSegmentRules({ conditions: [{ field: "fields.colour", op: "is", value: "red" }] }, { fields: FIELDS }).problem, /no such field/);
		assert.match(checkSegmentRules({ conditions: [{ field: "fields.seats", op: "contains", value: "1" }] }, { fields: FIELDS }).problem, /takes at_least/);
	});
});

describe("importing and exporting profiles", () => {
	test("the import suggests a first name and tags, maps the account's fields, and reads each row into the contact", () => {
		const headers = ["Email Address", "First Name", "Last Name", "TAGS", "Company", "Seats"];
		assert.deepEqual(suggestProfileColumns(headers, FIELDS), [
			{ column: "First Name", target: "first_name" },
			{ column: "Last Name", target: "skip" },
			{ column: "TAGS", target: "tags" },
			{ column: "Company", target: "field:company" },
			{ column: "Seats", target: "field:seats" },
		]);
		assert.equal(suggestProfileColumns(["email", "Name"])[0].target, "first_name", "a whole name gives its first word");

		const columns = mapColumns(headers);
		const profile = { firstName: "First Name", tags: "TAGS", fields: [{ column: "Seats", key: "seats", type: "number" }] };
		const row = normalizeImportRow({ "Email Address": "JO@example.com", "First Name": "Jo", TAGS: '"Customer","VIP"', Seats: "12" }, columns, { profile });
		assert.equal(row.firstName, "Jo");
		assert.deepEqual(row.tags, ["customer", "vip"]);
		assert.deepEqual(row.fields, { seats: 12 });
		const fullName = normalizeImportRow({ email: "a@example.com", Name: "Ana Lima" }, mapColumns(["email", "Name"]), { profile: { firstName: "Name" } });
		assert.equal(fullName.firstName, "Ana");

		const sanitized = sanitizeImportRow({ email: "a@example.com", status: "active", firstName: " Ana ", tags: "a, B", fields: { seats: "x", company: "Acme", nope: 1 } }, FIELDS);
		assert.deepEqual([sanitized.firstName, sanitized.tags, sanitized.fields], ["Ana", ["a", "b"], { company: "Acme" }], "values that don't fit, and unknown keys, are left out");

		assert.equal(guessFieldType(["1", "2,000", ""]), "number");
		assert.equal(guessFieldType(["2026-10-18", "2025-01-02"]), "date");
		assert.equal(guessFieldType(["Acme", "12"]), "text");
	});

	test("an imported first name and fields replace the contact's, and tags are added to its own", () => {
		const [write] = getContactWrites({
			accountId: "a",
			newsletterId: "n",
			source: "import",
			contacts: [{ email: "jo@example.com", status: "active", firstName: "Jo", tags: ["vip"], fields: { company: "Acme" } }],
		});
		assert.deepEqual(write.updateOne.update.$set, { firstName: "Jo", "fields.company": "Acme" });
		assert.deepEqual(write.updateOne.update.$addToSet, { tags: { $each: ["vip"] } });
	});

	test("the export has the first name, the tags and a column per field, and a name can't start a formula", () => {
		assert.ok(getCsvHeader(FIELDS).startsWith("email,first_name,status,newsletter,source,tags,"));
		assert.ok(getCsvHeader(FIELDS).trim().endsWith(",company,seats,birthday"));
		const row = toCsvRow(
			{ email: "jo@example.com", firstName: "=HYPERLINK()", status: "active", tags: ["vip", "beta"], fields: { company: "Acme", birthday: new Date("1990-05-04T00:00:00Z") } },
			new Map(),
			FIELDS
		);
		assert.ok(row.startsWith("jo@example.com,'=HYPERLINK(),active,,,\"vip, beta\","), row);
		assert.ok(row.trim().endsWith(",Acme,,1990-05-04"), row);
	});
});

describe("first names, tags and fields through the API", () => {
	let app;
	let m;

	async function api(key, method, path, body) {
		const response = await callApi(method, `/api/v1${path}`, { key, body });
		if (response.status < 300) {
			const segments = new URL(path, "http://x").pathname.split("/").filter(Boolean).map(decodeURIComponent);
			const { action } = m.rest.matchRoute(method, segments);
			const checked = action.output.safeParse(response.body);
			assert.ok(checked.success, `${action.name} answered outside its schema: ${checked.error?.message}`);
		}
		return response;
	}

	async function customer(email) {
		const user = await signIn(email);
		await activate(user);
		user.slug = email.split("@")[0].replace(/[^a-z0-9]/g, "-");
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
		);
		user.newsletterId = url.split("/").at(-1);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Full", level: "full" })))).key;
		return user;
	}

	before(async () => {
		app = await startTestApp();
		m = {
			rest: await import("../lib/api/rest.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			Contact: (await import("../models/Contact.js")).default,
		};
	});

	after(() => app?.stop());

	test("fields are made, contacts carry a first name, tags and values, and a second signup only fills in what's missing", async () => {
		const user = await customer("profile-api@example.com");
		assert.equal((await api(user.key, "POST", "/contacts/fields", { label: "Company", type: "text" })).status, 201);
		await api(user.key, "POST", "/contacts/fields", { label: "Seats", type: "number" });
		assert.equal((await api(user.key, "POST", "/contacts/fields", { label: "company", type: "text" })).body.error.code, "conflict");
		assert.deepEqual(
			(await api(user.key, "GET", "/contacts/fields")).body.fields.map(({ key }) => key),
			["company", "seats"]
		);

		const added = await api(user.key, "POST", "/contacts", {
			email: "jo@example.com",
			firstName: " Jo ",
			tags: ["VIP", "podcast"],
			fields: { company: "Acme", seats: "12" },
		});
		assert.equal(added.status, 201, JSON.stringify(added.body));
		assert.equal(added.body.firstName, undefined, "a signup's answer never shows a contact's details: signup keys sit in public pages");
		const jo = (await api(user.key, "GET", "/contacts/jo@example.com")).body;
		assert.deepEqual([jo.firstName, jo.tags, jo.fields], ["Jo", ["vip", "podcast"], { company: "Acme", seats: 12 }]);
		assert.equal((await api(user.key, "POST", "/contacts", { email: "x@example.com", fields: { colour: "red" } })).body.error.code, "validation_failed");

		await api(user.key, "POST", "/contacts", { email: "jo@example.com", firstName: "Joanna", tags: ["beta"], fields: { company: "Other" } });
		const again = (await api(user.key, "GET", "/contacts/jo@example.com")).body;
		assert.deepEqual([again.firstName, again.tags, again.fields.company], ["Jo", ["vip", "podcast", "beta"], "Acme"]);

		const updated = await api(user.key, "PATCH", "/contacts/jo@example.com/details", { firstName: "", tags: ["beta"], fields: { seats: null } });
		assert.deepEqual([updated.body.firstName, updated.body.tags, updated.body.fields], [null, ["beta"], { company: "Acme" }]);
	});

	test("tags go on and off a list of contacts or everyone a filter picks, list by tag, and pick segments", async () => {
		const user = await customer("profile-tags@example.com");
		const contact = (fields) => ({ accountId: user.accountId, newsletterId: user.newsletterId, status: "active", subscribedAt: new Date(), ...fields });
		await m.Contact.insertMany([
			contact({ email: "a@example.com", firstName: "Ana" }),
			contact({ email: "b@example.com", tags: ["vip"] }),
			contact({ email: "c@example.org" }),
			contact({ email: "d@example.org", status: "unsubscribed" }),
		]);

		const tagged = await api(user.key, "POST", "/contacts/tag", { contacts: ["a@example.com", "b@example.com"], tags: ["vip"] });
		assert.deepEqual(tagged.body, { matched: 2, changed: 1 });
		const byFilter = await api(user.key, "POST", "/contacts/tag", { newsletter: user.newsletterId, filter: { search: "c@", status: "active" }, tags: ["org"] });
		assert.deepEqual(byFilter.body, { matched: 1, changed: 1 });
		assert.equal((await api(user.key, "POST", "/contacts/tag", { filter: { status: "active" }, tags: ["x"] })).body.error.code, "validation_failed", "a filter needs the newsletter");
		assert.equal((await api(user.key, "POST", "/contacts/tag", { tags: ["x"] })).body.error.code, "validation_failed");

		assert.deepEqual((await api(user.key, "GET", `/contacts/tags?newsletter=${user.newsletterId}`)).body.tags, [
			{ name: "vip", contacts: 2 },
			{ name: "org", contacts: 1 },
		]);
		assert.deepEqual(
			(await api(user.key, "GET", "/contacts?tag=VIP")).body.contacts.map(({ email }) => email).sort(),
			["a@example.com", "b@example.com"]
		);

		const count = (conditions) => api(user.key, "POST", "/segments/count", { newsletter: user.newsletterId, conditions });
		assert.equal((await count([{ field: "tag", op: "has", value: "vip" }])).body.contacts, 2);
		assert.equal((await count([{ field: "tag", op: "has_not", value: "vip" }])).body.contacts, 1);
		assert.equal((await count([{ field: "first_name", op: "is_set" }])).body.contacts, 1);

		const untagged = await api(user.key, "POST", "/contacts/untag", { newsletter: user.newsletterId, filter: { tag: "vip" }, tags: ["vip"] });
		assert.deepEqual(untagged.body, { matched: 2, changed: 2 });
		const left = await m.Contact.findOne({ email: "b@example.com", accountId: user.accountId }).lean();
		assert.equal(left.tags, undefined, "an emptied list is removed");
	});

	test("a field a segment uses can't be deleted; deleted, its values stay on contacts and come back with it", async () => {
		const user = await customer("profile-fields@example.com");
		await api(user.key, "POST", "/contacts/fields", { label: "Plan", type: "text" });
		await api(user.key, "POST", "/contacts", { email: "p@example.com", fields: { plan: "pro" } });
		const segment = await api(user.key, "POST", "/segments", {
			newsletter: user.newsletterId,
			name: "Pro",
			conditions: [{ field: "fields.plan", op: "is", value: "PRO" }],
		});
		assert.equal(segment.status, 201, JSON.stringify(segment.body));
		assert.equal(segment.body.contacts, 1, "text compares without case");
		assert.equal(segment.body.description, 'Plan is "pro"');

		assert.equal((await api(user.key, "DELETE", "/contacts/fields/plan")).body.error.code, "conflict");
		await api(user.key, "DELETE", `/segments/${segment.body.id}`);
		assert.equal((await api(user.key, "DELETE", "/contacts/fields/plan")).status, 200);
		assert.deepEqual((await api(user.key, "GET", "/contacts/p@example.com")).body.fields, {});
		await api(user.key, "POST", "/contacts/fields", { label: "Plan", type: "text" });
		assert.deepEqual((await api(user.key, "GET", "/contacts/p@example.com")).body.fields, { plan: "pro" });
	});
});
