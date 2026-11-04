import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, anonymous, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";

// Olivia's first newsletter has Mia on its team, her second has nobody. Two people on one of the first's drafts never
// write over each other's saves and see where the other is; the second's drafts work as they always did.
let app;
let m;
let owner;
let mia;
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

async function createCampaign(user, newsletterId) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)));
	return url.split("/").at(-1);
}

function findCampaign(id) {
	return m.Campaign.findOne({ accountId: owner.accountId, _id: id }).lean();
}

function save(user, id, values) {
	return as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "Hi", body: "<p>Hello</p>", ...values }));
}

function presence(user, id, body, { method = "POST", site = "same-origin" } = {}) {
	const request = new Request(`http://localhost:3000/api/campaigns/${id}/presence`, {
		method,
		headers: { "content-type": "application/json", "sec-fetch-site": site },
		...(method === "POST" && { body: JSON.stringify(body) }),
	});
	return as(user, () => m.presenceRoute[method](request, { params: Promise.resolve({ id }) }));
}

async function others(user, id, body = {}) {
	const response = await presence(user, id, body);
	assert.equal(response.status, 200);
	return response.json();
}

const page = (id) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		team: await import("../app/(app)/newsletters/team/actions.js"),
		join: await import("../app/join/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		presenceRoute: await import("../app/api/campaigns/[id]/presence/route.js"),
		campaignPage: (await import("../app/(app)/campaigns/[id]/page.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
	};

	owner = await signIn("olivia@example.com");
	await activate(owner);
	mia = await signIn("mia@example.com");
	olly = await signIn("olly@example.com");
	await activate(olly);

	ids.first = await createNewsletter(owner, { name: "Field notes", slug: "field-notes" });
	ids.second = await createNewsletter(owner, { name: "Second letter", slug: "second-letter" });
	ids.teamDraft = await createCampaign(owner, ids.first);
	ids.soloDraft = await createCampaign(owner, ids.second);
	ids.ollyDraft = await createCampaign(olly, await createNewsletter(olly, { name: "Olly letters", slug: "olly-letters" }));

	await as(owner, () => m.team.inviteTeamMember(null, form({ newsletterId: ids.first, name: "Mia Rossi", email: "mia@example.com", role: "member" })));
	const token = /\/join\/([A-Za-z0-9_-]{43})/.exec(platformEmails.findLast(({ to }) => to.includes("mia@example.com")).text)[1];
	assert.equal(await as(mia, () => catchRedirect(m.join.joinTeam(null, form({ token })))), "/");
	owner.jar.set("newsletter", ids.first);
});

after(() => app?.stop());

describe("saving a team's draft", () => {
	test("each change to the subject, preview text or content is a revision, and a save from an older one changes nothing", async () => {
		const start = await as(owner, () => m.campaigns.loadDraft(ids.teamDraft));
		assert.deepEqual(start, { subject: "", previewText: "", content: "", format: "rich", revision: 0 });

		assert.deepEqual(await save(mia, ids.teamDraft, { subject: "Mia's", body: "<p>Mia</p>", revision: 0 }), { ok: true, revision: 1 });
		assert.deepEqual(await save(owner, ids.teamDraft, { subject: "Olivia's", body: "<p>Olivia</p>", revision: 0 }), { conflict: true });
		const stored = await findCampaign(ids.teamDraft);
		assert.equal(stored.subject, "Mia's", "her save stays");
		assert.equal(stored.html, "<p>Mia</p>");

		const latest = await as(owner, () => m.campaigns.loadDraft(ids.teamDraft));
		assert.deepEqual(latest, { subject: "Mia's", previewText: "Hi", content: "<p>Mia</p>", format: "rich", revision: 1 });
		assert.deepEqual(await save(owner, ids.teamDraft, { subject: "Both", body: "<p>Mia</p><p>Olivia</p>", revision: 1 }), { ok: true, revision: 2 });
	});

	test("without a revision, as on a newsletter without a team, a save goes through as it always did", async () => {
		assert.deepEqual(await save(owner, ids.soloDraft, { subject: "Solo" }), { ok: true });
		assert.deepEqual(await save(owner, ids.soloDraft, { subject: "Solo again" }), { ok: true });
		assert.equal((await findCampaign(ids.soloDraft)).revision, 2, "counted all the same");
	});

	test("a page opened before someone joined the team saves without a revision: it reloads first, and writes over nobody", async () => {
		const before = await findCampaign(ids.teamDraft);
		assert.deepEqual(await save(owner, ids.teamDraft, { subject: "From an old page" }), {
			error: "Someone joined this newsletter's team: reload the page to keep writing with them",
		});
		assert.deepEqual(await save(mia, ids.teamDraft, { subject: "From an old page" }), {
			error: "Someone joined this newsletter's team: reload the page to keep writing with them",
		});
		const after = await findCampaign(ids.teamDraft);
		assert.equal(after.subject, before.subject);
		assert.equal(after.revision, before.revision);
		assert.equal((await as(owner, () => m.campaigns.setCampaignPublishTo(ids.teamDraft, "both"))).error, undefined, "where it goes needs none");
	});

	test("the API answers revision_conflict for a change from an older revision, and gives the revision to start from", async () => {
		const { key } = await as(owner, () => m.apiKeys.createApiKey(null, form({ name: "Olivia's", level: "full" })));
		const current = await callApi("GET", `/api/v1/campaigns/${ids.teamDraft}`, { key });
		assert.equal(current.body.revision, 2);
		const stale = await callApi("PATCH", `/api/v1/campaigns/${ids.teamDraft}`, { key, body: { subject: "From the API", revision: 1 } });
		assert.equal(stale.status, 409);
		assert.equal(stale.body.error.code, "revision_conflict");
		const fresh = await callApi("PATCH", `/api/v1/campaigns/${ids.teamDraft}`, { key, body: { subject: "From the API", revision: 2 } });
		assert.equal(fresh.status, 200);
		assert.equal(fresh.body.revision, 3);
		const segmentOnly = await callApi("PATCH", `/api/v1/campaigns/${ids.teamDraft}`, { key, body: { publishTo: "both" } });
		assert.equal(segmentOnly.body.revision, 3, "where it goes isn't the draft's words");
		const blind = await callApi("PATCH", `/api/v1/campaigns/${ids.teamDraft}`, { key, body: { previewText: "Hi" } });
		assert.equal(blind.status, 200, "the API changes it from no revision, as documented");
		assert.equal(blind.body.revision, 4);
	});

	test("the draft's page turns it on for a team's drafts only", async () => {
		const teamDraft = await as(owner, () => m.campaignPage(page(ids.teamDraft)));
		assert.deepEqual(teamDraft.props.collaboration, { revision: 4 });
		const forMia = await as(mia, () => m.campaignPage(page(ids.teamDraft)));
		assert.deepEqual(forMia.props.collaboration, { revision: 4 });
		owner.jar.set("newsletter", ids.second);
		const solo = await as(owner, () => m.campaignPage(page(ids.soloDraft)));
		assert.equal(solo.props.collaboration, null);
		owner.jar.set("newsletter", ids.first);
	});
});

describe("who's on a team's draft", () => {
	test("each sees the others where they are, by name and picture, never by address", async () => {
		assert.deepEqual(await others(owner, ids.teamDraft, { cursor: { block: 2, fx: 0.5, fy: 0.25 }, caret: "subject" }), { others: [], revision: 4 });
		const seen = await others(mia, ids.teamDraft, { cursor: { fx: 0.2, y: 40 }, caret: 3 });
		assert.equal(seen.others.length, 1);
		const [olivia] = seen.others;
		assert.equal(olivia.name, "olivia", "without a name, their address's first part");
		assert.deepEqual(olivia.cursor, { block: 2, fx: 0.5, fy: 0.25 });
		assert.equal(olivia.caret, "subject");
		assert.match(olivia.gravatarHash, /^[0-9a-f]{64}$/);
		assert.doesNotMatch(JSON.stringify(seen), /@/, "no address");

		const [them] = (await others(owner, ids.teamDraft)).others;
		assert.equal(them.name, "Mia Rossi");
		assert.deepEqual(them.cursor, { fx: 0.2, y: 40 });
		assert.equal(them.caret, 3);
	});

	test("what a browser says is kept to the shapes it can take", async () => {
		await others(mia, ids.teamDraft, { cursor: { block: "1", fx: 7, fy: Number.NaN }, caret: "body", name: "Someone else", id: "x" });
		const [them] = (await others(owner, ids.teamDraft)).others;
		assert.deepEqual(them.cursor, null);
		assert.equal(them.caret, null);
		assert.equal(them.name, "Mia Rossi");

		await others(mia, ids.teamDraft, { cursor: { block: 1, fx: 7, fy: -2 }, caret: 99999 });
		const [moved] = (await others(owner, ids.teamDraft)).others;
		assert.deepEqual(moved.cursor, { block: 1, fx: 1, fy: 0 }, "in range");
		assert.equal(moved.caret, null);
	});

	test("leaving shows at once", async () => {
		assert.equal((await presence(mia, ids.teamDraft, null, { method: "DELETE" })).status, 204);
		assert.deepEqual((await others(owner, ids.teamDraft)).others, []);
	});

	test("only those who can open a team's draft are on it", async () => {
		assert.equal((await presence(owner, ids.soloDraft, {})).status, 404, "a newsletter without a team");
		assert.equal((await presence(mia, ids.soloDraft, {})).status, 404, "a newsletter not shared with her");
		assert.equal((await presence(olly, ids.teamDraft, {})).status, 404, "someone else's");
		assert.equal((await presence(owner, ids.ollyDraft, {})).status, 404);
		assert.equal((await presence(owner, "not-an-id", {})).status, 404);
		assert.equal((await presence(owner, ids.teamDraft, {}, { site: "cross-site" })).status, 403, "another site's page");
		const signedOut = await anonymous(() =>
			m.presenceRoute.POST(new Request(`http://localhost:3000/api/campaigns/${ids.teamDraft}/presence`, { method: "POST", body: "{}" }), {
				params: Promise.resolve({ id: ids.teamDraft }),
			})
		);
		assert.equal(signedOut.status, 401);

		await m.Campaign.updateOne({ accountId: owner.accountId, _id: ids.teamDraft }, { $set: { status: "sent" } });
		assert.equal((await presence(mia, ids.teamDraft, {})).status, 404, "a sent issue");
		await m.Campaign.updateOne({ accountId: owner.accountId, _id: ids.teamDraft }, { $set: { status: "draft" } });
	});
});
