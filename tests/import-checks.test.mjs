import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { checkImportRows } from "../lib/contact-import.js";
import { normalizeEmail as normalizeCsvEmail } from "../lib/csv-import.js";
import { getEmailSuggestion } from "../lib/email-typos.js";
import { getDropReason, getSignupEmailProblem } from "../lib/import-checks.js";
import { normalizeEmail } from "../lib/validation.js";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { domainsWithoutMail } from "./stubs/mail-domains.mjs";

test("an address takes a dot-atom, no doubled dots, and a domain ending of letters", () => {
	for (const email of ["jane.doe+news@acme.co.uk", "o'brien@acme.ie", "jane@xn--80ak6aa92e.com", "jane@acme.xn--p1ai", "jane@closed-shop.example"]) {
		assert.equal(normalizeEmail(email), email, email);
	}
	for (const email of ["jane..doe@acme.com", ".jane@acme.com", "jane.@acme.com", "jane@acme..com", "jane@acme.c0m", "jane@acme.123", "jane@acme.c", "jane@-acme.com"]) {
		assert.equal(normalizeEmail(email), null, email);
	}
	assert.equal(normalizeCsvEmail(" Jane <JANE@acme.com> "), "jane@acme.com", "CSV cells go through the same rules");
	assert.equal(normalizeCsvEmail("jane..doe@acme.com"), null);
});

test("misspelled provider domains and endings no domain has get the address they were meant to be", () => {
	assert.equal(getEmailSuggestion("jane.doe@gmial.com"), "jane.doe@gmail.com");
	assert.equal(getEmailSuggestion("jane@hotmial.com"), "jane@hotmail.com");
	assert.equal(getEmailSuggestion("jane@yaho.com"), "jane@yahoo.com");
	assert.equal(getEmailSuggestion("jane.doe@gmail.co"), "jane.doe@gmail.com");
	assert.equal(getEmailSuggestion("jane.doe@gmial.con"), "jane.doe@gmail.com", "both at once");
	assert.equal(getEmailSuggestion("jane@acme.con"), "jane@acme.com");
	assert.equal(getEmailSuggestion("jane@acme.ogr"), "jane@acme.org");
	for (const email of ["jane.doe@gmail.com", "jane@acme.co", "jane@mail.com", "jane@email.com", "jane@ymail.com", "jane@gmx.com", "jane@cloud.com", "jane@wahoo.com", "jane@acme.om"]) {
		assert.equal(getEmailSuggestion(email), null, `${email} is a real domain`);
	}
});

test("misspellings and spam trap addresses are dropped from imports and refused on signups; role addresses only from imports", () => {
	assert.equal(getDropReason("jane.doe@gmial.com"), "typo");
	for (const email of ["spamtrap@acme.com", "spam-trap.2@acme.com", "honeypot@acme.com", "the.honey_pot@acme.com"]) assert.equal(getDropReason(email), "trap", email);
	assert.equal(getDropReason("jane.honeycutt@acme.com"), null);

	assert.equal(getSignupEmailProblem("jane.doe@gmial.com"), "Did you mean jane.doe@gmail.com?");
	assert.equal(getSignupEmailProblem("spamtrap@acme.com"), "This address can't be added");
	assert.equal(getSignupEmailProblem("info@acme.com"), null, "people sign up with these themselves");
	assert.equal(getSignupEmailProblem("jane@mailinator.com"), null);
	assert.equal(getSignupEmailProblem("jane@acme.com"), null);
});

test("role addresses and throwaway inboxes are dropped, people are kept", () => {
	assert.equal(getDropReason("info@acme.com"), "role");
	assert.equal(getDropReason("support+eu@acme.com"), "role");
	assert.equal(getDropReason("no-reply@acme.com"), "role");
	assert.equal(getDropReason("jane@mailinator.com"), "disposable");
	assert.equal(getDropReason("jane@eu.yopmail.com"), "disposable", "subdomains of a listed domain");
	assert.equal(getDropReason("jane@acme.com"), null);
	assert.equal(getDropReason("information@acme.com"), null);
	assert.equal(getDropReason("jane@notmailinator.com"), null);
});

test("rows are checked once each, and past unsubscribes always go in", () => {
	const { contacts, dropped } = checkImportRows([
		{ email: "jane@acme.com", status: "active" },
		{ email: "JANE@acme.com", status: "active" },
		{ email: "not-an-email", status: "active" },
		{ email: "sales@acme.com", status: "active" },
		{ email: "sales@other.com", status: "unsubscribed" },
		{ email: "x@10minutemail.com", status: "dormant" },
		{ email: "ken@gmial.com", status: "active" },
		{ email: "spamtrap@acme.com", status: "active" },
		{ email: "len@hotmial.com", status: "unsubscribed" },
	]);
	assert.deepEqual(contacts.map(({ email }) => email), ["jane@acme.com", "sales@other.com", "len@hotmial.com"]);
	assert.deepEqual(dropped, { invalid: 1, typo: 1, trap: 1, role: 1, disposable: 1, duplicate: 1, suppressed: 0, undeliverable: 0, noMail: 0 });
});

describe("contact imports", () => {
	let app;
	let m;
	let user;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			archive: await import("../app/archive/actions.js"),
			jobs: await import("../lib/import-jobs.js"),
			Account: (await import("../models/Account.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			ContactImport: (await import("../models/ContactImport.js")).default,
			Suppression: (await import("../models/Suppression.js")).default,
		};
		user = await signIn("importer@example.com");
		await activate(user);
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Importer", slug: "importer", postalAddress: "1 Main St" }))));
		user.newsletterId = url.split("/").at(-1);
	});

	after(() => app?.stop());

	test("an import needs the customer's word that these people agreed", async () => {
		const rows = [{ email: "reader@example.org", status: "active" }];
		for (const consent of [undefined, false, "true"]) {
			assert.deepEqual(await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, rows, consent })), {
				error: "Confirm that these people agreed to receive your emails",
			});
		}
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, email: "reader@example.org" }), 0);
		assert.equal(await m.ContactImport.countDocuments({ accountId: user.accountId }), 0);
	});

	test("dropped rows are counted by reason, and chunks add up in one import", async () => {
		await m.Suppression.create({ accountId: user.accountId, email: "bounced@example.org", reason: "bounce" });
		const first = await as(user, () =>
			m.contacts.importContacts({
				newsletterId: user.newsletterId,
				consent: true,
				duplicates: 2,
				rows: [
					{ email: "ann@example.org", status: "active" },
					{ email: "ann@example.org", status: "active" },
					{ email: "admin@example.org", status: "active" },
					{ email: "bob@guerrillamail.com", status: "active" },
					{ email: "bounced@example.org", status: "active" },
					{ email: "broken", status: "active" },
				],
			})
		);
		assert.equal(first.created, 1);
		assert.deepEqual(first.dropped, { invalid: 1, typo: 0, trap: 0, role: 1, disposable: 1, duplicate: 3, suppressed: 1, undeliverable: 0, noMail: 0 });

		const second = await as(user, () =>
			m.contacts.importContacts({
				newsletterId: user.newsletterId,
				consent: true,
				importId: first.importId,
				rows: [
					{ email: "ann@example.org", status: "active" },
					{ email: "cat@example.org", status: "active" },
				],
			})
		);
		// The answer counts the whole import so far.
		assert.deepEqual({ created: second.created, existing: second.existing, importId: second.importId }, { created: 2, existing: 1, importId: first.importId });

		const stored = await m.ContactImport.findOne({ accountId: user.accountId, _id: first.importId }).lean();
		assert.equal(stored.consent, true);
		assert.equal(stored.consentText, "These people agreed to receive my emails");
		assert.ok(stored.consentAt instanceof Date);
		assert.equal(stored.userId.toString(), user.userId.toString());
		assert.deepEqual({ rows: stored.rows, created: stored.created, existing: stored.existing }, { rows: 8, created: 2, existing: 1 });
		assert.deepEqual(stored.dropped, { invalid: 1, typo: 0, trap: 0, role: 1, disposable: 1, duplicate: 3, suppressed: 1, undeliverable: 0, noMail: 0 });

		const cat = await m.Contact.findOne({ accountId: user.accountId, email: "cat@example.org" }).lean();
		assert.equal(cat.importId.toString(), first.importId);
		assert.equal(await m.Contact.exists({ accountId: user.accountId, email: "admin@example.org" }), null);
		assert.equal(await m.Contact.exists({ accountId: user.accountId, email: "bounced@example.org" }), null);
	});

	test("an import id from another account or newsletter is refused", async () => {
		const other = await signIn("other-importer@example.com");
		await activate(other);
		const url = await as(other, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Other", slug: "other-importer", postalAddress: "1 Main St" }))));
		const { importId } = await as(user, () =>
			m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: [{ email: "dan@example.org", status: "active" }] })
		);
		const answer = await as(other, () =>
			m.contacts.importContacts({ newsletterId: url.split("/").at(-1), consent: true, importId, rows: [{ email: "eve@example.org", status: "active" }] })
		);
		assert.deepEqual(answer, { error: "Import not found" });
	});

	test("the same checks run without the dashboard, for the API and MCP", async () => {
		const account = await m.Account.findById(user.accountId).lean();
		const { contactImport } = await m.jobs.startImport({ account, newsletterId: user.newsletterId, consent: true, source: "api" });
		const { job } = await m.jobs.addImportRows({
			account,
			importId: String(contactImport._id),
			rows: [
				{ email: "help@example.org", status: "active" },
				{ email: "fay@example.org", status: "active" },
			],
		});
		const result = m.jobs.toImportView(job);
		assert.equal(result.status, "done");
		assert.equal(result.created, 1);
		assert.equal(result.dropped.role, 1);
		assert.equal((await m.ContactImport.findOne({ accountId: user.accountId, _id: result.importId }).lean()).source, "api");
	});

	test("addresses on domains that can't receive email are left out; past unsubscribes there still go in", async () => {
		domainsWithoutMail.add("closed-shop.example");
		const result = await as(user, () =>
			m.contacts.importContacts({
				newsletterId: user.newsletterId,
				consent: true,
				rows: [
					{ email: "gus@closed-shop.example", status: "active" },
					{ email: "hal@closed-shop.example", status: "unsubscribed" },
					{ email: "ida@example.org", status: "active" },
				],
			})
		);
		assert.equal(result.created, 2);
		assert.equal(result.dropped.noMail, 1);
		assert.equal(await m.Contact.exists({ accountId: user.accountId, email: "gus@closed-shop.example" }), null);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "hal@closed-shop.example" }).lean()).status, "unsubscribed");
		assert.equal((await m.ContactImport.findOne({ accountId: user.accountId, _id: result.importId }).lean()).dropped.noMail, 1);
	});

	test("signups through the API, MCP and the archive's form refuse misspellings with a suggestion, traps and domains without email", async () => {
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Signups", slug: "signup-checks", postalAddress: "1 Main St", archiveEnabled: "on" })))
		);
		const newsletter = url.split("/").at(-1);
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })));
		domainsWithoutMail.add("no-mail.example");

		const signup = async (email) => {
			const response = await callApi("POST", "/api/v1/contacts", { key, body: { newsletter: "signup-checks", email } });
			await flushAfter();
			return response;
		};
		for (const [email, message] of [
			["jane.doe@gmial.com", "Did you mean jane.doe@gmail.com?"],
			["Jane@Hotmial.com", "Did you mean jane@hotmail.com?"],
			["spamtrap@acme.com", "This address can't be added"],
			["jo@no-mail.example", "This email's domain can't receive email"],
			["jane..doe@acme.com", "email is invalid"],
		]) {
			const response = await signup(email);
			assert.equal(response.status, 400, email);
			assert.deepEqual(response.body.error, { code: "validation_failed", message }, email);
		}
		assert.equal((await signup("jane.doe@gmail.com")).status, 201);
		assert.equal((await signup("info@acme.com")).status, 201, "a role address someone signs up with");

		const formResult = await anonymous(() => m.archive.subscribe(null, form({ newsletter: "signup-checks", email: "kim@yaho.com" })));
		assert.deepEqual(formResult, { error: "Did you mean kim@yahoo.com?" });
		assert.equal((await anonymous(() => m.archive.subscribe(null, form({ newsletter: "signup-checks", email: "kim@yahoo.com" })))).ok, true);

		const emails = (await m.Contact.find({ accountId: user.accountId, newsletterId: newsletter }).lean()).map(({ email }) => email).sort();
		assert.deepEqual(emails, ["info@acme.com", "jane.doe@gmail.com", "kim@yahoo.com"]);
	});
});
