import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { activate, as, callApi, catchNotFound, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { domainsWithoutMail } from "./stubs/mail-domains.mjs";

// Olivia owns two newsletters and invites Mia as a member and Adam as an admin of the first one. They try everything the
// dashboard offers on it, and on the second one, which isn't shared with them.
let app;
let m;
let owner;
let mia;
let adam;
let olly;
const ids = {};

async function createNewsletter(user, { name, slug }) {
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(null, form({ name, slug, fromName: name, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" }))
		)
	);
	return url.split("/").at(-1);
}

async function createCampaign(user, newsletterId, subject) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)));
	const id = url.split("/").at(-1);
	// As the editor saves: from the draft's revision, which a team's drafts need.
	const { revision } = await as(user, () => m.campaigns.loadDraft(id));
	const saved = await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "Hi", body: "<p>Hello readers</p>", revision }));
	assert.deepEqual(saved, { ok: true, revision: revision + 1 });
	return id;
}

function invite(user, newsletterId, { name, email, role = "member" }) {
	return as(user, () => m.team.inviteTeamMember(null, form({ newsletterId, name, email, role })));
}

// The last invitation an address got, with the token its link carries.
function lastInvitation(email) {
	const sent = platformEmails.findLast(({ to }) => to.includes(email));
	return { ...sent, token: /\/join\/([A-Za-z0-9_-]{43})/.exec(sent?.text ?? "")?.[1] };
}

function join(user, token) {
	return as(user, () => m.join.joinTeam(null, form({ token })));
}

function findUser(email) {
	return mongoose.connection.db.collection("users").findOne({ email });
}

function findMember(newsletterId, email) {
	return m.TeamMember.findOne({ accountId: owner.accountId, newsletterId, email }).lean();
}

const page = (id) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		team: await import("../app/(app)/newsletters/team/actions.js"),
		join: await import("../app/join/actions.js"),
		signin: await import("../app/signin/actions.js"),
		selected: await import("../lib/selected-newsletter.js"),
		teamLib: await import("../lib/team.js"),
		campaignPage: (await import("../app/(app)/campaigns/[id]/page.js")).default,
		contactPage: (await import("../app/(app)/contacts/[id]/page.js")).default,
		settingsPage: (await import("../app/(app)/newsletters/page.js")).default,
		teamPage: (await import("../app/(app)/newsletters/team/page.js")).default,
		domainsPage: (await import("../app/(app)/domains/page.js")).default,
		TeamMember: (await import("../models/TeamMember.js")).default,
		Author: (await import("../models/Author.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
	};

	owner = await signIn("olivia@example.com");
	await activate(owner);
	mia = await signIn("mia@example.com");
	adam = await signIn("adam@example.com");
	olly = await signIn("olly@example.com");
	await activate(olly);

	ids.first = await createNewsletter(owner, { name: "Field <b>notes</b>", slug: "field-notes" });
	ids.second = await createNewsletter(owner, { name: "Second letter", slug: "second-letter" });
	await as(owner, () => m.contacts.importContacts({ newsletterId: ids.first, consent: true, rows: [{ email: "reader@example.org", status: "active" }] }));
	const secret = await as(owner, () =>
		m.contacts.importContacts({ newsletterId: ids.second, consent: true, rows: [{ email: "secret@example.org", status: "active" }] })
	);
	ids.secondImport = secret.importId;
	ids.firstCampaign = await createCampaign(owner, ids.first, "First issue");
	ids.secondCampaign = await createCampaign(owner, ids.second, "Second issue");
	ids.reader = String((await m.Contact.findOne({ accountId: owner.accountId, email: "reader@example.org" }).lean())._id);
	ids.secret = String((await m.Contact.findOne({ accountId: owner.accountId, email: "secret@example.org" }).lean())._id);
	ids.olly = await createNewsletter(olly, { name: "Olly letters", slug: "olly-letters" });
});

after(() => app?.stop());

describe("inviting", () => {
	test("the owner invites by name, address and role: an email with a link, the newsletter's name escaped, replies to the owner", async () => {
		assert.deepEqual(await invite(owner, ids.first, { name: "Mia", email: "Mia@Example.com" }), { ok: true, email: "mia@example.com" });
		const email = lastInvitation("mia@example.com");
		assert.equal(email.subject, "Join Field <b>notes</b> on MailCheap");
		assert.match(email.html, /Field &lt;b&gt;notes&lt;\/b&gt;/);
		assert.doesNotMatch(email.html, /<b>notes/);
		assert.match(email.text, /olivia@example\.com invited you to work on Field <b>notes<\/b> with them on MailCheap, as a member/);
		assert.equal(email.reply_to, "olivia@example.com");
		assert.ok(email.token, "the link carries a token");
		const stored = await findMember(ids.first, "mia@example.com");
		assert.equal(stored.role, "member");
		assert.notEqual(stored.tokenHash, email.token, "only its hash is kept");

		assert.deepEqual(await invite(owner, ids.first, { name: "Adam", email: "adam@example.com", role: "admin" }), { ok: true, email: "adam@example.com" });
	});

	test("addresses go through a signup's checks, and nobody invites themselves", async () => {
		domainsWithoutMail.add("nomail.example");
		const cases = [
			[{ name: "X", email: "not-an-email" }, /email is invalid/],
			[{ name: "Me", email: "olly@example.com" }, /your own address/],
			[{ name: "Typo", email: "friend@gmial.com" }, /Did you mean friend@gmail\.com/],
			[{ name: "Nowhere", email: "friend@nomail.example" }, /can't receive email/],
			[{ name: "Boss", email: "boss@example.com", role: "superadmin" }, /role/],
		];
		for (const [input, message] of cases) assert.match((await invite(olly, ids.olly, input)).error, message, input.email);
		domainsWithoutMail.delete("nomail.example");
	});

	test("one inbox gets 3 invitations a day, its aliases included, and sending again keeps one invitation", async () => {
		for (const email of ["busy.reader@gmail.com", "busyreader@gmail.com", "busy.reader+news@gmail.com"]) {
			assert.equal((await invite(olly, ids.olly, { name: "Busy", email })).ok, true, email);
		}
		assert.match((await invite(olly, ids.olly, { name: "Busy", email: "busyreader@googlemail.com" })).error, /enough invitations today/);
		const rows = await m.TeamMember.find({ accountId: olly.accountId }).lean();
		assert.equal(rows.length, 1, "the same inbox is one invitation, sent again");
		assert.equal(rows[0].email, "busy.reader+news@gmail.com", "with the address it went to last");
	});

	test("a newsletter's team has 5 people at most, invited and joined", async () => {
		for (const name of ["Ana", "Ben", "Cat"]) {
			assert.equal((await invite(owner, ids.first, { name, email: `${name.toLowerCase()}@example.net` })).ok, true, name);
		}
		assert.match((await invite(owner, ids.first, { name: "Dan", email: "dan@example.net" })).error, /5 people at most/);
		for (const email of ["ana@example.net", "ben@example.net", "cat@example.net"]) {
			const { _id } = await findMember(ids.first, email);
			assert.deepEqual(await as(owner, () => m.team.removeTeamMember(ids.first, String(_id))), { ok: true });
		}
	});

	test("on MailCheap Cloud, inviting needs a plan", async () => {
		const free = await signIn("free@example.com");
		const newsletterId = await createNewsletter(free, { name: "Free letter", slug: "free-letter" });
		const result = await invite(free, newsletterId, { name: "Pal", email: "pal@example.com" });
		assert.equal(result.code, "subscription_required");
		assert.equal(await m.TeamMember.countDocuments({ accountId: free.accountId }), 0);
	});

	test("a self-hosted server only invites the emails it lets in", async () => {
		const server = { MAILCHEAP_CLOUD: "false", ALLOWED_EMAILS: "olivia@example.com,@example.org", EMAIL_FROM: "MailCheap <hello@example.org>" };
		await withEnv(server, async () => {
			assert.match((await invite(owner, ids.second, { name: "Stranger", email: "stranger@example.com" })).error, /ALLOWED_EMAILS/);
		});
	});
});

describe("joining", () => {
	test("only someone signed in with the invited address joins, once, and the newsletter opens for them", async () => {
		const { token } = lastInvitation("mia@example.com");
		assert.match((await join(olly, token)).error, /This invitation is for mia@example\.com/);
		assert.equal(await as(mia, () => catchRedirect(m.join.joinTeam(null, form({ token })))), "/");
		assert.equal(mia.jar.get("newsletter"), ids.first);
		assert.match((await join(mia, token)).error, /isn't valid anymore/, "the token goes once used");
		assert.equal(await as(adam, () => catchRedirect(m.join.joinTeam(null, form({ token: lastInvitation("adam@example.com").token })))), "/");
		assert.equal((await findUser("mia@example.com")).name, "Mia", "without a name of their own, the one they were invited with");
	});

	test("signing in from the invitation's link takes the invited address only, and joins with the invited name", async () => {
		const pat = await signIn("pat@example.com");
		await activate(pat);
		const newsletterId = await createNewsletter(pat, { name: "Pat letters", slug: "pat-letters" });
		assert.equal((await invite(pat, newsletterId, { name: "Nina Patel", email: "nina@example.com", role: "admin" })).ok, true);
		const { token } = lastInvitation("nina@example.com");
		const nina = { email: "nina@example.com", jar: new Map(), ip: "198.51.100.200" };

		const elsewhere = await as(nina, () => m.signin.sendSigninCode(null, form({ email: "someone@example.com", invitation: token })));
		assert.equal(elsewhere.error, "Sign in with the address your invitation went to");
		assert.deepEqual(await as(nina, () => m.signin.sendSigninCode(null, form({ email: "nina@example.com", invitation: token }))), { email: "nina@example.com" });
		const code = platformEmails.findLast(({ to }) => to.includes("nina@example.com")).subject.slice(0, 6);
		const signedIn = await as(nina, () =>
			catchRedirect(m.signin.verifySigninCode(null, form({ email: "nina@example.com", code, next: `/join/${token}`, invitation: token })))
		);
		assert.equal(signedIn, "/", "the dashboard, without the Join step");
		assert.equal(nina.jar.get("newsletter"), newsletterId);
		assert.equal((await findUser("nina@example.com")).name, "Nina Patel");
		const member = await m.TeamMember.findOne({ accountId: pat.accountId, email: "nina@example.com" }).lean();
		assert.ok(member.joinedAt);
		assert.equal(member.tokenHash, undefined, "the link is used up");

		assert.equal((await invite(pat, newsletterId, { name: "Typed name", email: "named@example.com" })).ok, true);
		const namedToken = lastInvitation("named@example.com").token;
		const named = await signIn("named@example.com");
		await mongoose.connection.db.collection("users").updateOne({ email: "named@example.com" }, { $set: { name: "Their own" } });
		assert.equal(await as(named, () => catchRedirect(m.join.joinTeam(null, form({ token: namedToken })))), "/");
		assert.equal((await findUser("named@example.com")).name, "Their own", "a name they have stays");
	});

	test("an expired or canceled invitation can't be used", async () => {
		assert.equal((await invite(owner, ids.second, { name: "Late", email: "late@example.com" })).ok, true);
		const late = await signIn("late@example.com");
		await m.TeamMember.updateOne({ accountId: owner.accountId, email: "late@example.com" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
		assert.match((await join(late, lastInvitation("late@example.com").token)).error, /isn't valid anymore/);
		assert.match((await join(late, "x".repeat(43))).error, /isn't valid anymore/);
	});
});

describe("a member", () => {
	test("opens the newsletter in its owner's account, and only that one", async () => {
		const view = await as(mia, () => m.selected.getSelectedNewsletter());
		assert.equal(view.role, "member");
		assert.equal(String(view.selected._id), ids.first);
		assert.equal(String(view.account._id), String(owner.accountId));
		assert.equal(String(view.ownAccount._id), String(mia.accountId));
		assert.deepEqual(view.newsletters.map(({ slug }) => slug), ["field-notes"]);

		mia.jar.set("newsletter", ids.second);
		const forged = await as(mia, () => m.selected.getSelectedNewsletter());
		assert.equal(String(forged.selected._id), ids.first, "a cookie naming another newsletter opens theirs");
		assert.equal(await as(mia, () => m.selected.saveSelectedNewsletter(ids.second)), null);
		mia.jar.set("newsletter", ids.first);
	});

	test("writes drafts and adds contacts", async () => {
		ids.miaDraft = await createCampaign(mia, ids.first, "Mia's draft");
		const draft = await m.Campaign.findOne({ accountId: owner.accountId, _id: ids.miaDraft }).lean();
		assert.equal(String(draft.newsletterId), ids.first);
		const added = await as(mia, () => m.contacts.addContact(null, form({ newsletterId: ids.first, email: "fan@example.org", consent: "on" })));
		assert.equal(added.email, "fan@example.org");
		const fields = await as(mia, () => m.contacts.getContactOptions(ids.first));
		assert.ok(Array.isArray(fields.tags));
	});

	test("adds authors and picks who wrote a draft, but leaves editing and removing them to the admins", async () => {
		const added = await as(mia, () => m.campaigns.addCampaignAuthor(ids.miaDraft, ids.first, { name: "Mia", email: "mia@example.com" }));
		ids.miaAuthor = added.author.id;
		const author = await m.Author.findOne({ accountId: owner.accountId, _id: ids.miaAuthor }).lean();
		assert.deepEqual([String(author.newsletterId), author.name], [ids.first, "Mia"], "in the owner's account, for the shared newsletter");
		assert.equal(String((await m.Campaign.findOne({ accountId: owner.accountId, _id: ids.miaDraft }).lean()).authorId), ids.miaAuthor);
		assert.deepEqual(await as(mia, () => m.campaigns.setCampaignAuthor(ids.miaDraft, ids.miaAuthor)), { ok: true });

		for (const attempt of [() => m.campaigns.editAuthor(ids.miaAuthor, { name: "Mia B", email: "mia@example.com" }), () => m.campaigns.removeAuthor(ids.miaAuthor)]) {
			assert.match((await as(mia, attempt)).error, /^Only the newsletter's admins can /);
		}
		assert.deepEqual(await as(mia, () => m.campaigns.addCampaignAuthor(ids.secondCampaign, ids.second, { name: "Intruder", email: "intruder@example.com" })), {
			error: "Newsletter not found",
		});
		assert.equal(await m.Author.countDocuments({ accountId: owner.accountId, newsletterId: ids.second }), 0);
	});

	test("doesn't send, export, delete, change settings, invite or add fields", async () => {
		const refusals = {
			send: () => m.campaigns.sendCampaign(ids.firstCampaign),
			schedule: () => m.campaigns.scheduleCampaign(ids.firstCampaign, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }),
			export: () => m.contacts.exportContacts({ newsletterId: ids.first }),
			deleteContact: () => m.contacts.deleteContact(ids.reader),
			deleteSelected: () => m.contacts.deleteSelectedContacts({ newsletterId: ids.first, filters: {} }),
			status: () => m.contacts.setContactStatus(ids.reader, "dormant"),
			selectedStatus: () => m.contacts.setSelectedStatus({ newsletterId: ids.first, ids: [ids.reader] }, "dormant"),
			segment: () => m.contacts.segmentSelectedContacts({ newsletterId: ids.first, ids: [ids.reader] }, { name: "Picked", tag: "picked" }),
			settings: () => m.newsletters.saveNewsletter(null, form({ id: ids.first, section: "general", name: "Taken", slug: "field-notes" })),
			invite: () => m.team.inviteTeamMember(null, form({ newsletterId: ids.first, name: "Pal", email: "pal@example.com", role: "admin" })),
			field: () => m.contacts.createContactField({ label: "Company", type: "text" }),
		};
		for (const [name, attempt] of Object.entries(refusals)) {
			assert.match((await as(mia, attempt))?.error ?? "", /^Only the (newsletter's admins|account's owner) can /, name);
		}
		assert.equal((await m.Contact.findOne({ accountId: owner.accountId, _id: ids.reader }).lean()).status, "active");
		assert.equal(await m.Contact.countDocuments({ accountId: owner.accountId, newsletterId: ids.first }), 2, "the list keeps everyone");
	});

	test("tags the contacts they pick on the list, and only in the newsletter shared with them", async () => {
		assert.deepEqual(await as(mia, () => m.contacts.tagSelectedContacts({ newsletterId: ids.first, ids: [ids.reader, ids.secret] }, ["fan"])), {
			changed: 1,
			remaining: 0,
		});
		assert.deepEqual(await as(mia, () => m.contacts.untagSelectedContacts({ newsletterId: ids.first, filters: {} }, ["fan"])), { changed: 1, remaining: 0 });
		assert.deepEqual(await as(mia, () => m.contacts.tagSelectedContacts({ newsletterId: ids.second, ids: [ids.secret] }, ["fan"])), {
			error: "Newsletter not found",
		});
		assert.deepEqual((await m.Contact.findOne({ accountId: owner.accountId, _id: ids.secret }).lean()).tags ?? [], []);
	});

	test("never reaches the owner's other newsletter, by action or by page", async () => {
		const secondPage = { subject: "Hijacked", previewText: "", body: "<p>x</p>" };
		assert.equal((await as(mia, () => m.campaigns.saveCampaign(ids.secondCampaign, secondPage))).error, "Campaign not found");
		assert.deepEqual(await as(mia, () => m.campaigns.createCampaign(ids.second)), { error: "Newsletter not found" });
		assert.deepEqual(
			await as(mia, () => m.contacts.addContact(null, form({ newsletterId: ids.second, email: "intruder@example.org", consent: "on" }))),
			{ error: "Newsletter not found" }
		);
		assert.deepEqual(await as(mia, () => m.campaigns.findPreviewContacts(ids.second, "secret")), { error: "Newsletter not found" });
		const ownList = await as(mia, () => m.campaigns.findPreviewContacts(ids.first, ""));
		assert.ok(!ownList.contacts.some(({ email }) => email === "secret@example.org"));
		assert.equal((await as(mia, () => m.contacts.getLeftOut(ids.secondImport))).error, "Import not found");
		assert.equal((await as(mia, () => m.contacts.getImports(ids.second))).error, "Newsletter not found");
		assert.equal((await as(mia, () => m.contacts.updateContactDetails(ids.secret, { firstName: "Hacked" }))).error, "Contact not found");
		assert.equal((await m.Campaign.findOne({ accountId: owner.accountId, _id: ids.secondCampaign }).lean()).subject, "Second issue");

		assert.equal(await as(mia, () => catchNotFound(m.campaignPage(page(ids.secondCampaign)))), true);
		assert.equal(await as(mia, () => catchNotFound(m.contactPage(page(ids.secret)))), true);
		assert.equal(await as(mia, () => catchNotFound(m.campaignPage(page(ids.firstCampaign)))), false, "theirs opens");
		assert.equal(await as(mia, () => catchRedirect(m.settingsPage())), "/");
		assert.equal(await as(mia, () => catchRedirect(m.teamPage())), "/");
		assert.equal(await as(mia, () => catchRedirect(m.domainsPage())), "/");
	});

	test("edits drafts only: a scheduled issue goes out as an admin left it", async () => {
		await m.Campaign.updateOne(
			{ accountId: owner.accountId, _id: ids.miaDraft },
			{ $set: { status: "scheduled", scheduledAt: new Date(Date.now() + 86_400_000) } }
		);
		const edit = await as(mia, () => m.campaigns.saveCampaign(ids.miaDraft, { subject: "Changed", previewText: "", body: "<p>x</p>" }));
		assert.match(edit.error, /admins can change a campaign once it's scheduled/);
		assert.match((await as(mia, () => m.campaigns.discardCampaign(ids.miaDraft))).error, /admins/);
		assert.equal((await m.Campaign.findOne({ accountId: owner.accountId, _id: ids.miaDraft }).lean()).subject, "Mia's draft");
	});

	test("makes keys for their own account only, which never reach the newsletter shared with them", async () => {
		await activate(mia);
		const { key } = await as(mia, () => m.apiKeys.createApiKey(null, form({ name: "Mia's", level: "full" })));
		assert.equal(await m.ApiKey.countDocuments({ accountId: owner.accountId, name: "Mia's" }), 0, "never in the owner's account");
		assert.equal(await m.ApiKey.countDocuments({ accountId: mia.accountId, name: "Mia's" }), 1);
		const reached = await callApi("GET", "/api/v1/campaigns?newsletter=field-notes", { key });
		assert.deepEqual([reached.status, reached.body.error.message], [404, "Newsletter not found"]);
		const team = await callApi("GET", "/api/v1/newsletters/field-notes/team", { key });
		assert.equal(team.status, 404);
	});
});

describe("an admin", () => {
	test("changes the newsletter's settings and exports its contacts, but not the owner's notifications, another newsletter or the team", async () => {
		assert.equal((await as(adam, () => m.newsletters.saveNewsletter(null, form({ id: ids.first, section: "general", name: "Field notes", slug: "field-notes" })))).ok, true);
		assert.ok((await as(adam, () => m.contacts.exportContacts({ newsletterId: ids.first }))).url);
		assert.match((await as(adam, () => m.newsletters.saveNotifications(ids.first, { summary: "off" }))).error, /account's owner/);
		assert.equal(
			(await as(adam, () => m.newsletters.saveNewsletter(null, form({ id: ids.second, section: "general", name: "Taken", slug: "second-letter" })))).error,
			"Newsletter not found"
		);
		assert.match((await as(adam, () => m.team.inviteTeamMember(null, form({ newsletterId: ids.first, name: "Pal", email: "pal@example.com", role: "admin" })))).error, /account's owner/);
		assert.equal(await as(adam, () => catchRedirect(m.teamPage())), "/");
		assert.equal(await as(adam, () => catchNotFound(m.settingsPage())), false, "settings open");
	});

	test("edits and removes the newsletter's authors, once their scheduled issues are out of the way", async () => {
		const edited = await as(adam, () => m.campaigns.editAuthor(ids.miaAuthor, { name: "Mia Brown", email: "mia@example.com", showOnWeb: false }));
		assert.deepEqual([edited.author.name, edited.author.showOnWeb, edited.author.showInEmails], ["Mia Brown", false, true]);
		assert.match((await as(adam, () => m.campaigns.removeAuthor(ids.miaAuthor))).error, /is scheduled or in review/, "Mia's draft is scheduled");
		assert.deepEqual(await as(adam, () => m.campaigns.unscheduleCampaign(ids.miaDraft)), { ok: true });
		assert.deepEqual(await as(adam, () => m.campaigns.removeAuthor(ids.miaAuthor)), { ok: true });
		assert.ok((await m.Author.findOne({ accountId: owner.accountId, _id: ids.miaAuthor }).lean()).deletedAt);
	});
});

describe("the owner", () => {
	test("lists and manages the team through the API", async () => {
		const { key } = await as(owner, () => m.apiKeys.createApiKey(null, form({ name: "Olivia's", level: "full" })));
		const listed = await callApi("GET", "/api/v1/newsletters/field-notes/team", { key });
		assert.equal(listed.status, 200);
		assert.deepEqual(
			listed.body.members.map(({ email, role, status }) => [email, role, status]),
			[
				["mia@example.com", "member", "joined"],
				["adam@example.com", "admin", "joined"],
			]
		);
		const other = await callApi("GET", "/api/v1/newsletters/olly-letters/team", { key });
		assert.equal(other.status, 404, "another account's newsletter");
	});

	test("changes roles and removes people, whose access ends at their next click", async () => {
		const { _id } = await findMember(ids.first, "mia@example.com");
		assert.deepEqual(await as(owner, () => m.team.changeTeamRole(ids.first, String(_id), "admin")), { ok: true });
		assert.equal((await as(mia, () => m.selected.getSelectedNewsletter())).role, "admin");

		assert.deepEqual(await as(owner, () => m.team.removeTeamMember(ids.first, String(_id))), { ok: true });
		const view = await as(mia, () => m.selected.getSelectedNewsletter());
		assert.equal(view.newsletters.length, 0);
		assert.equal(String(view.account._id), String(mia.accountId), "back to their own account");
		assert.equal((await as(mia, () => m.campaigns.saveCampaign(ids.firstCampaign, { subject: "x", previewText: "", body: "<p>x</p>" }))).error, "Campaign not found");
	});

	test("a deleted user's memberships go with them", async () => {
		await m.teamLib.removeUserMemberships(adam.userId);
		const view = await as(adam, () => m.selected.getSelectedNewsletter());
		assert.equal(view.newsletters.length, 0);
		assert.ok((await findMember(ids.first, "adam@example.com")).removedAt);
	});
});
