import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { sent } from "./stubs/ses.mjs";

// A newsletter's design, saved from the Design page or through update_newsletter's theme, and the emails that follow it.
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
	};
});

after(() => app?.stop());

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	const slug = email.split("@")[0];
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris" }))));
	user.newsletterId = url.split("/").at(-1);
	return user;
}

async function storedTheme(user) {
	const newsletter = await mongoose.connection.db.collection("newsletters").findOne({ _id: new mongoose.Types.ObjectId(user.newsletterId) });
	return newsletter.theme;
}

async function sendTest(user) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
	assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	return sent.at(-1);
}

describe("where emails sit", () => {
	test("is saved from the Design page and the API, and the emails sent sit there", async () => {
		const user = await customer("align-notes@example.com");
		const saved = await as(user, () => m.newsletters.saveTheme(user.newsletterId, { preset: "mailcheap", emailAlign: "left" }));
		assert.equal(saved.theme.emailAlign, "left");
		assert.deepEqual(await storedTheme(user), { preset: "mailcheap", emailAlign: "left" });
		assert.match((await sendTest(user)).html, /<tr><td align="left" style="padding:32px 20px;">/);

		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const patch = (theme) => callApi("PATCH", `/api/v1/newsletters/${user.newsletterId}`, { key, body: { theme } });
		assert.equal((await patch({ emailAlign: "right" })).status, 400);
		const centered = await patch({ emailAlign: "center" });
		assert.equal(centered.status, 200);
		assert.equal(centered.body.theme.emailAlign, "center");
		assert.deepEqual(centered.body.theme.customized, []);
		assert.deepEqual(await storedTheme(user), { preset: "mailcheap" }, "the preset's own is no change");
		assert.match((await sendTest(user)).html, /<tr><td align="center" style="padding:32px 20px;">/);

		const themes = await callApi("GET", "/api/v1/themes", { key });
		assert.deepEqual(themes.body.emailAlign, ["left", "center"]);
		assert.ok(themes.body.presets.every((preset) => preset.emailAlign === "center"));
	});

	test("only its own account changes it", async () => {
		const owner = await customer("align-owner@example.com");
		const stranger = await customer("align-stranger@example.com");
		assert.ok((await as(stranger, () => m.newsletters.saveTheme(owner.newsletterId, { emailAlign: "left" }))).error);
		assert.deepEqual(await storedTheme(owner), { preset: "mailcheap" });
	});
});
