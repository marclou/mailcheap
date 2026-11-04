import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MAX_TEST_RECIPIENTS, describeTestRecipients, readTestRecipients } from "../lib/test-email-rules.js";
import { activate, addAuthor, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { state as ses, sent as sesEmails } from "./stubs/ses.mjs";

// Test emails (lib/test-recipients.js): to the sender's own address or the ones they saved, or up to 5 they type, read
// as one of the newsletter's contacts when they pick one. The account's own people get them freely; anyone else gets a
// few, and never someone who left the newsletter.
describe("the test email form", () => {
	test("reads addresses separated by commas, spaces or semicolons, once each, 5 at most", () => {
		assert.deepEqual(readTestRecipients(" Me@Example.com, you@example.com;me@example.com\nthem@example.com "), {
			emails: ["me@example.com", "you@example.com", "them@example.com"],
		});
		assert.deepEqual(readTestRecipients(" , "), { error: "Add the address the test goes to" });
		assert.deepEqual(readTestRecipients("me@example.com, nope"), { error: "nope isn't an email address" });
		const many = Array.from({ length: MAX_TEST_RECIPIENTS + 1 }, (_, index) => `reader${index}@example.com`).join(",");
		assert.deepEqual(readTestRecipients(many), { error: `A test goes to ${MAX_TEST_RECIPIENTS} addresses at most` });
	});

	test("says where it went", () => {
		assert.equal(describeTestRecipients(["a@example.com"]), "a@example.com");
		assert.equal(describeTestRecipients(["a@example.com", "b@example.com"]), "a@example.com and b@example.com");
		assert.equal(describeTestRecipients(["a@example.com", "b@example.com", "c@example.com"]), "a@example.com and 2 others");
	});
});

describe("sending tests", () => {
	let app;
	let m;
	let owner;
	let campaignId;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			team: await import("../app/(app)/newsletters/team/actions.js"),
			join: await import("../app/join/actions.js"),
			Account: (await import("../models/Account.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
			TeamMember: (await import("../models/TeamMember.js")).default,
		};
		owner = await customer("olivia@example.com");
		await m.Contact.insertMany([
			contact(owner, "lena@example.org", { firstName: "Lena", tags: ["vip"] }),
			contact(owner, "plain@example.org"),
			contact(owner, "gone@example.org", { status: "unsubscribed" }),
			contact(owner, "olivia@example.com", { status: "unsubscribed" }),
		]);
		campaignId = await draft(owner, {
			subject: "{{first_name|Friend}}, the news",
			body: '<p>For all</p><section data-section="" data-show="tag:vip" data-where="email"><p>VIP only</p></section><p>Bye</p>',
		});
	});

	after(() => app?.stop());

	async function customer(email, newsletter = {}) {
		const user = await signIn(email);
		await activate(user);
		const slug = email.split("@")[0];
		const fields = { name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris", ...newsletter };
		user.newsletterId = (await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(fields))))).split("/").at(-1);
		await addAuthor(user);
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
		return user;
	}

	function contact(user, email, values = {}) {
		return { accountId: user.accountId, newsletterId: user.newsletterId, email, status: "active", subscribedAt: new Date(), ...values };
	}

	async function draft(user, values) {
		const id = (await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)))).split("/").at(-1);
		const { revision } = await as(user, () => m.campaigns.loadDraft(id));
		const saved = await as(user, () => m.campaigns.saveCampaign(id, { previewText: "This week", ...values, revision }));
		assert.equal(saved.ok, true, JSON.stringify(saved));
		return id;
	}

	// Each email a test sent, in order.
	async function sendTest(user, values, id = campaignId) {
		const before = sesEmails.length;
		const result = await as(user, () => m.campaigns.sendTestCampaign(id, values));
		return { result, emails: sesEmails.slice(before) };
	}

	async function joinTeam(user, newsletterId, role) {
		const invited = await as(owner, () => m.team.inviteTeamMember(null, form({ newsletterId, name: "Teammate", email: user.email, role })));
		assert.equal(invited.ok, true, JSON.stringify(invited));
		const token = /\/join\/([A-Za-z0-9_-]{43})/.exec(platformEmails.findLast(({ to }) => to.includes(user.email)).text)[1];
		assert.equal(await as(user, () => catchRedirect(m.join.joinTeam(null, form({ token })))), "/");
	}

	test("goes to the sender's own address, or to each address they type, and saving them makes them the default", async () => {
		const own = await sendTest(owner);
		assert.deepEqual(own.result, { ok: true });
		assert.deepEqual(
			own.emails.map(({ to, subject }) => [to, subject]),
			[["olivia@example.com", "[Test] Jane, the news"]],
			"their own address, which unsubscribing as a contact doesn't stop, read as the sample reader"
		);
		const prefilled = await sendTest(owner, { to: ["olivia@example.com"], contact: null, saveAsDefault: false });
		assert.deepEqual(prefilled.result, { ok: true }, "as the dialog sends it, without a contact");
		assert.deepEqual(prefilled.emails.map(({ to }) => to), ["olivia@example.com"]);

		const typed = await sendTest(owner, { to: ["editor@example.org", "Proof@Example.org"], saveAsDefault: true });
		assert.deepEqual(typed.result, { ok: true });
		assert.deepEqual(typed.emails.map(({ to }) => to), ["editor@example.org", "proof@example.org"]);
		assert.deepEqual((await m.Account.findById(owner.accountId).lean()).testRecipients, ["editor@example.org", "proof@example.org"]);

		const api = await callApi("POST", `/api/v1/campaigns/${campaignId}/test`, { key: owner.key });
		assert.equal(api.status, 200, JSON.stringify(api.body));
		assert.equal(api.body.sentTo, "editor@example.org, proof@example.org", "an API key without addresses uses them too");
		assert.equal(sesEmails.at(-1).to, "proof@example.org");
		const message = await m.Message.findOne({ accountId: owner.accountId, _id: api.body.messageId }).lean();
		assert.deepEqual([message.kind, message.email], ["test", "editor@example.org"], "the first address's email");
	});

	test("refuses more than 5 addresses, or one that isn't an address, before anything goes out", async () => {
		const before = sesEmails.length;
		const six = Array.from({ length: MAX_TEST_RECIPIENTS + 1 }, (_, index) => `reader${index}@example.org`);
		const tooMany = await callApi("POST", `/api/v1/campaigns/${campaignId}/test`, { key: owner.key, body: { to: six } });
		assert.deepEqual([tooMany.status, tooMany.body.error.code], [400, "validation_failed"]);
		const invalid = await callApi("POST", `/api/v1/campaigns/${campaignId}/test`, { key: owner.key, body: { to: ["not-an-email"] } });
		assert.deepEqual([invalid.status, invalid.body.error.message], [400, 'to: "not-an-email" isn\'t an email address']);
		assert.equal(sesEmails.length, before);
	});

	test("read as a contact, it has their first name and sections, and they don't get it", async () => {
		const lena = await m.Contact.findOne({ accountId: owner.accountId, email: "lena@example.org" }).lean();
		const asLena = await sendTest(owner, { to: ["olivia@example.com"], contact: String(lena._id) });
		assert.deepEqual(asLena.result, { ok: true });
		assert.equal(asLena.emails.length, 1);
		assert.equal(asLena.emails[0].subject, "[Test] Lena, the news");
		assert.ok(asLena.emails[0].html.includes("VIP only"), "her tag's section");

		const asPlain = await callApi("POST", `/api/v1/campaigns/${campaignId}/test`, {
			key: owner.key,
			body: { to: ["olivia@example.com"], contact: "Plain@Example.org" },
		});
		assert.equal(asPlain.status, 200, JSON.stringify(asPlain.body));
		assert.equal(sesEmails.at(-1).subject, "[Test] Friend, the news", "by address too, with the fallback for a contact without a name");
		assert.ok(!sesEmails.at(-1).html.includes("VIP only"), "only the sections they get");

		const everyone = await sendTest(owner, { to: ["olivia@example.com"] });
		assert.ok(everyone.emails[0].html.includes("VIP only"), "without a contact, every section an email can have");
		assert.equal(sesEmails.filter(({ to }) => to === "lena@example.org" || to === "plain@example.org").length, 0);

		const other = await customer("bob@example.com");
		await m.Contact.create(contact(other, "secret@example.org", { firstName: "Secret" }));
		assert.deepEqual(await as(owner, () => m.campaigns.sendTestCampaign(campaignId, { contact: "secret@example.org" })), {
			error: "Contact not found",
		});
		const found = await as(owner, () => m.campaigns.findPreviewContacts(owner.newsletterId, "lena"));
		assert.deepEqual(
			found.contacts.map(({ email, firstName }) => [email, firstName]),
			[["lena@example.org", "Lena"]],
			"the form finds the newsletter's active contacts as they're typed"
		);
	});

	test("the welcome email's test takes the same addresses and contact", async () => {
		const sender = await customer("wendy@example.com", { welcomeSubject: "Welcome, {{first_name|friend}}", welcomeContent: "Glad you're here." });
		await m.Contact.create(contact(sender, "max@example.org", { firstName: "Max" }));
		const before = sesEmails.length;
		const values = { to: ["editor@example.org", "wendy@example.com"], contact: "max@example.org", saveAsDefault: true };
		assert.deepEqual(await as(sender, () => m.newsletters.sendWelcomeTest(sender.newsletterId, values)), { ok: true });
		assert.deepEqual(
			sesEmails.slice(before).map(({ to, subject }) => [to, subject]),
			[
				["editor@example.org", "[Test] Welcome, Max"],
				["wendy@example.com", "[Test] Welcome, Max"],
			]
		);
		assert.deepEqual((await m.Account.findById(sender.accountId).lean()).testRecipients, ["editor@example.org", "wendy@example.com"]);
	});

	test("never reaches an address outside the team that left the newsletter, or that a signup would refuse", async () => {
		const before = sesEmails.length;
		assert.deepEqual(await as(owner, () => m.campaigns.sendTestCampaign(campaignId, { to: ["olivia@example.com", "gone@example.org"] })), {
			error: "gone@example.org: This address unsubscribed, bounced or complained before",
		});
		assert.match((await as(owner, () => m.campaigns.sendTestCampaign(campaignId, { to: ["friend@gmial.com"] }))).error, /^friend@gmial\.com: .*friend@gmail\.com/);
		assert.equal(sesEmails.length, before, "nobody, the team's addresses included");
	});

	test("an account's tests reach 20 addresses outside its team a day, and each of those gets 10 tests a day", async () => {
		const sender = await customer("cap@example.com");
		const id = await draft(sender, { subject: "Capped", body: "<p>Hi</p>" });
		for (let batch = 0; batch < 4; batch++) {
			const to = Array.from({ length: 5 }, (_, index) => `reader${batch * 5 + index}@example.org`);
			assert.deepEqual((await sendTest(sender, { to }, id)).result, { ok: true }, `batch ${batch}`);
		}
		assert.deepEqual((await sendTest(sender, { to: ["reader20@example.org"] }, id)).result, {
			error: "Your tests reach 20 addresses outside your team a day. Try again tomorrow.",
		});
		assert.deepEqual((await sendTest(sender, { to: ["cap@example.com"] }, id)).result, { ok: true }, "the team's addresses don't count");

		for (let count = 2; count <= 10; count++) {
			assert.deepEqual((await sendTest(sender, { to: ["reader0@example.org"] }, id)).result, { ok: true }, `test ${count}`);
		}
		const refused = { error: "reader0@example.org got enough test emails today. Try again tomorrow." };
		assert.deepEqual((await sendTest(sender, { to: ["reader0@example.org"] }, id)).result, refused);
		assert.deepEqual((await sendTest(owner, { to: ["reader0@example.org"] })).result, refused, "from every account together");
	});

	test("takes room in the plan's month before it goes out, for all its addresses or none", async () => {
		const sender = await customer("quota@example.com");
		const id = await draft(sender, { subject: "Counted", body: "<p>Hi</p>" });
		await m.Account.updateOne({ _id: sender.accountId }, { $set: { "limitOverrides.emailsPerMonth": 4, "usage.emailsSent": 1 } });
		const emailsSent = async () => (await m.Account.findById(sender.accountId).lean()).usage.emailsSent;
		const to = ["quota@example.com", "copy@example.org"];

		assert.deepEqual((await sendTest(sender, { to }, id)).result, { ok: true });
		assert.equal(await emailsSent(), 3);
		const refused = await sendTest(sender, { to }, id);
		assert.deepEqual(refused.result, { error: "This test needs 2 emails and your plan has 1 left this month. Upgrade to send.", code: "plan_limit_emails" });
		assert.deepEqual([refused.emails, await emailsSent()], [[], 3], "neither address, and the room it took is back");

		ses.failNext = { name: "sendSesEmail", error: new Error("Throttled") };
		const failed = await sendTest(sender, { to: ["quota@example.com"] }, id);
		assert.ok(failed.result.error, JSON.stringify(failed.result));
		assert.equal(await emailsSent(), 3, "an email that didn't go out doesn't count");
		assert.deepEqual((await sendTest(sender, { to: ["quota@example.com"] }, id)).result, { ok: true });
		assert.equal(await emailsSent(), 4);
	});

	test("a member sends tests to the newsletter's team only, and keeps a default of their own", async () => {
		const mia = await signIn("mia@example.com");
		const adam = await signIn("adam@example.com");
		const sam = await signIn("sam@example.com");
		const secondId = (
			await as(owner, () =>
				catchRedirect(
					m.newsletters.saveNewsletter(null, form({ name: "Second", slug: "second-letter", fromEmail: "hello@second-letter.mailcheapmail.com", postalAddress: "1 Main St, Paris" }))
				)
			)
		)
			.split("/")
			.at(-1);
		owner.jar.set("newsletter", owner.newsletterId);
		await joinTeam(mia, owner.newsletterId, "member");
		await joinTeam(adam, owner.newsletterId, "admin");
		await joinTeam(sam, secondId, "member");

		const own = await sendTest(mia);
		assert.deepEqual([own.result, own.emails.map(({ to }) => to)], [{ ok: true }, ["mia@example.com"]], "her own address, not the owner's default");
		const team = await sendTest(mia, { to: ["olivia@example.com", "adam@example.com"], saveAsDefault: true });
		assert.deepEqual(team.emails.map(({ to }) => to), ["olivia@example.com", "adam@example.com"]);
		const membership = await m.TeamMember.findOne({ accountId: owner.accountId, email: "mia@example.com" }).lean();
		assert.deepEqual(membership.testRecipients, ["olivia@example.com", "adam@example.com"]);
		assert.deepEqual((await m.Account.findById(owner.accountId).lean()).testRecipients, ["editor@example.org", "proof@example.org"], "the owner's stay theirs");
		assert.deepEqual((await sendTest(mia)).emails.map(({ to }) => to), ["olivia@example.com", "adam@example.com"]);

		for (const outsider of ["outsider@example.org", "sam@example.com"]) {
			assert.deepEqual(await as(mia, () => m.campaigns.sendTestCampaign(campaignId, { to: ["adam@example.com", outsider] })), {
				error: `Only the newsletter's admins send tests outside its team, and ${outsider} isn't on it`,
			});
		}
		assert.deepEqual(
			(await sendTest(adam, { to: ["outsider@example.org", "sam@example.com"] })).emails.map(({ to }) => to),
			["outsider@example.org", "sam@example.com"],
			"an admin sends anywhere"
		);
	});
});
