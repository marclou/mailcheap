import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, as, callApi, catchRedirect, form, mockStripe, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// The dashboard counts the API's hourly limits per account on what costs something each call: test emails and
// sends, imports, uploads, domains and Stripe. Each account counts on its own, and its API keys count against it too.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		registry: await import("../lib/actions/registry.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		billing: await import("../app/(account)/billing/actions.js"),
		uploadsRoute: await import("../app/api/uploads/route.js"),
		Contact: (await import("../models/Contact.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Message: (await import("../models/Message.js")).default,
	};
});

after(() => app?.stop());

// A paying account with a newsletter that can send, and a welcome email saved but off.
async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	const slug = email.split("@")[0];
	const settings = { name: slug, slug, postalAddress: "1 Main St, Paris", welcomeSubject: "Welcome", welcomeMarkdown: "Glad you're here." };
	const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form(settings))));
	user.newsletterId = url.split("/").at(-1);
	return user;
}

async function draft(user) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: "<p>Hello</p>" }));
	return id;
}

async function repeat(times, run) {
	for (let index = 0; index < times; index++) await run(index);
}

test("the dashboard counts the hourly limits of what costs something each call", () => {
	const limited = m.registry.ACTIONS.filter(({ rateLimit }) => rateLimit);
	assert.deepEqual(
		limited
			.filter(({ limitDashboard }) => limitDashboard)
			.map(({ name }) => name)
			.sort(),
		[
			"add_domain",
			"change_plan",
			"check_domain",
			"check_newsletter_slug",
			"import_contacts",
			"open_billing_portal",
			"resume_campaign",
			"schedule_campaign",
			"send_campaign",
			"send_campaign_to_more",
			"send_test_email",
			"send_welcome_test_email",
			"upload_image",
		]
	);
	assert.deepEqual(
		limited
			.filter(({ limitDashboard }) => !limitDashboard)
			.map(({ name }) => name)
			.sort(),
		[
			"count_segment",
			"create_api_key",
			"create_campaign",
			"create_contact_field",
			"create_segment",
			"delete_contact",
			"duplicate_campaign",
			"export_contacts",
			"preview_campaign_cleanup",
			"tag_contacts",
			"untag_contacts",
		],
		"drafts, segments, fields, tags, keys, deletes, exports and counts stay inside MailCheap"
	);
	const imports = m.registry.getAction("import_contacts");
	assert.equal(imports.limitDashboard({}), true, "a file's first chunk counts");
	assert.equal(imports.limitDashboard({ importId: "6650f1c2e9b1d4a012345678" }), false, "the chunks after it don't");
});

describe("test emails", () => {
	test("only the signed-in owner gets them: 30 of a campaign and 20 of the welcome email an hour per account", async () => {
		const user = await customer("tester@example.com");
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const id = await draft(user);
		await repeat(30, async (index) => assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true }, String(index)));
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { error: "You can send a test email 30 times an hour. Try again later." });
		await repeat(20, async (index) => assert.deepEqual(await as(user, () => m.newsletters.sendWelcomeTest(user.newsletterId)), { ok: true }, String(index)));
		assert.deepEqual(await as(user, () => m.newsletters.sendWelcomeTest(user.newsletterId)), {
			error: "You can send a test of the welcome email 20 times an hour. Try again later.",
		});
		assert.deepEqual(await m.Message.distinct("email", { accountId: user.accountId, kind: "test" }), ["tester@example.com"]);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: "test" }), 50);

		const viaKey = await callApi("POST", `/api/v1/campaigns/${id}/test`, { key });
		assert.deepEqual(
			[viaKey.status, viaKey.body.error],
			[429, { code: "rate_limited", message: "Too many send_test_email calls on this account, try again later" }],
			"an API key gets what the account has left"
		);
		const other = await customer("other-tester@example.com");
		const otherId = await draft(other);
		assert.deepEqual(await as(other, () => m.campaigns.sendTestCampaign(otherId)), { ok: true }, "and so does each account");
	});
});

describe("contacts", () => {
	test("a file is one import however many chunks it takes: 120 imports an hour per account, and one under way finishes", async () => {
		const user = await customer("importer@example.com");
		const importChunk = (email, importId) =>
			as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, importId, rows: [{ email }] }));
		const { importId } = await importChunk("first@example.org");
		await repeat(125, async (index) => assert.equal((await importChunk(`chunk${index}@example.org`, importId)).importId, importId, String(index)));
		await repeat(119, async (index) => assert.ok((await importChunk(`file${index}@example.org`)).importId, String(index)));
		assert.deepEqual(await importChunk("one-more@example.org"), { error: "You can import contacts 120 times an hour. Try again later." });
		assert.equal((await importChunk("last-chunk@example.org", importId)).importId, importId);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 1 + 125 + 119 + 1);
	});

	test("contacts added by hand, who get the welcome email: 600 an hour per account", async () => {
		const user = await customer("by-hand@example.com");
		const add = (email) => as(user, () => m.contacts.addContact(null, form({ newsletterId: user.newsletterId, email, consent: "on" })));
		await repeat(600, async (index) => assert.equal((await add(`hand${index}@example.org`)).status, "active", String(index)));
		assert.deepEqual(await add("one-more@example.org"), { error: "You can add 600 contacts an hour. Try again later." });
		await flushAfter();
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), 600);
	});
});

describe("images, domains and billing", () => {
	test("the editor uploads 60 images an hour per account, and the 61st answers 429 with what its toast says", async () => {
		const user = await customer("uploader@example.com");
		const upload = () =>
			as(user, () =>
				m.uploadsRoute.POST(
					new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { "content-type": "image/png", "x-file-name": "cover" }, body: PNG })
				)
			);
		await repeat(60, async (index) => assert.equal((await upload()).status, 200, String(index)));
		const limited = await upload();
		assert.equal(limited.status, 429);
		assert.deepEqual(await limited.json(), { error: "You can upload an image 60 times an hour. Try again later.", code: "rate_limited" });
	});

	test("10 domains added and 60 checks an hour per account", async () => {
		const user = await customer("domains-limit@example.com");
		await repeat(10, async (index) => {
			const domain = `limit${index}.dev`;
			assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain }))), { ok: true, domain });
		});
		assert.deepEqual(await as(user, () => m.domains.addDomainAction(null, form({ domain: "limit10.dev" }))), {
			error: "You can add a domain 10 times an hour. Try again later.",
		});
		const id = String((await m.Domain.findOne({ accountId: user.accountId }).lean())._id);
		await repeat(60, async (index) => assert.equal((await as(user, () => m.domains.checkDomainAction(id))).ok, true, String(index)));
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(id)), {
			error: "You can check a domain's DNS records 60 times an hour. Try again later.",
		});
	});

	test("past 30 billing portal links an hour, the billing page says so instead of blaming Stripe", async () => {
		const user = await customer("billing-limit@example.com");
		const portal = { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/bps_1" };
		mockStripe(({ method, path }) =>
			method === "POST" && path === "/v1/billing_portal/sessions"
				? portal
				: { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } }
		);
		await repeat(30, async (index) => assert.equal(await as(user, () => catchRedirect(m.billing.openBillingPortal())), portal.url, String(index)));
		assert.equal(await as(user, () => catchRedirect(m.billing.openBillingPortal())), "/billing?error=rate_limited");
	});
});
