import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSenderPath } from "../lib/newsletters.js";
import {
	activate,
	addLiveWebsiteDomain,
	addVerifiedDomain,
	as,
	callApi,
	catchRedirect,
	form,
	jsonRequest,
	platformEmails,
	signIn,
	startTestApp,
	withEnv,
} from "./helpers/app.mjs";
import { cnames, txts } from "./stubs/dns-check.mjs";
import { published } from "./stubs/qstash.mjs";
import { calls, sent, state } from "./stubs/ses.mjs";
import { dnsRecords } from "./stubs/dns-broker.mjs";

// From addresses, SES tenants and domains, through the real actions with SES, DNS and Vercel in memory.
let app;
let m;
let processed = 0;

async function runJobs() {
	while (processed < published.length) {
		const { url, body } = published[processed++];
		if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
	}
}

async function createNewsletter(user, slug, fields = {}) {
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on", ...fields })))
	);
	user.newsletterId = url.split("/").at(-1);
	return m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
}

function saveFrom(user, slug, fromEmail) {
	return as(user, () =>
		m.newsletters.saveNewsletter(null, form({ id: user.newsletterId, name: slug, slug, fromEmail, postalAddress: "1 Main St, Paris", archiveEnabled: "on" }))
	);
}

function switchTo(user, domain, localPart) {
	return as(user, () => m.domains.switchToDomainAction(null, form({ newsletterId: user.newsletterId, domainId: String(domain._id), localPart })));
}

async function draft(user) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: '<p>Hello <a href="https://example.org">link</a></p>' }));
	return id;
}

async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	await createNewsletter(user, slug);
	return user;
}

// The Domains page as React renders it on the server: its own components called, client components left with their props.
const PAGE_COMPONENTS = ["CardDomain", "ListDnsSteps", "TableDnsRecords"];

function renderPage(node) {
	if (Array.isArray(node)) return node.map(renderPage);
	if (!node || typeof node !== "object") return node;
	if (PAGE_COMPONENTS.includes(node.type?.name)) return renderPage(node.type(node.props));
	return { ...node, props: { ...node.props, children: renderPage(node.props?.children) } };
}

function findAll(node, match) {
	if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
	if (!node || typeof node !== "object") return [];
	return [...(match(node) ? [node] : []), ...findAll(node.props?.children, match)];
}

function textOf(node) {
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (node === null || node === undefined || typeof node === "boolean") return "";
	return typeof node === "object" ? textOf(node.props?.children) : String(node);
}

// Each record row as shown, and what each of its Copy buttons copies.
function readRecordRows(card) {
	return findAll(card, (node) => node.type === "tr" && findAll(node, ({ type }) => type === "td").length > 0).map((row) =>
		findAll(row, ({ type }) => type === "td").map((cell) => {
			const [copy] = findAll(cell, ({ type }) => type === m.ButtonCopy);
			return copy ? { shown: textOf(cell), copied: copy.props.value } : textOf(cell);
		})
	);
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		domains: await import("../app/(app)/domains/actions.js"),
		domainsPage: await import("../app/(app)/domains/page.js"),
		ButtonCopy: (await import("../components/ButtonCopy.jsx")).default,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
		billing: await import("../lib/billing.js"),
		hostRouting: await import("../lib/host-routing.js"),
		Account: (await import("../models/Account.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Domain: (await import("../models/Domain.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("SES tenants", () => {
	test("a plan starting creates the account's tenant once, with its configuration set", async () => {
		const user = await signIn("tenant@example.com");
		const subscription = {
			id: "sub_tenant",
			status: "active",
			customer: "cus_tenant",
			items: { data: [{ price: { lookup_key: "starter_month" }, current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
		};
		const account = await m.Account.findById(user.accountId).lean();
		await m.billing.applySubscription(account, subscription);
		await m.billing.applySubscription(await m.Account.findById(user.accountId).lean(), subscription);

		const name = `mc-${user.accountId}`;
		const { ses } = await m.Account.findById(user.accountId).lean();
		assert.equal(ses.tenantName, name);
		assert.equal(ses.configurationSet, name);
		assert.ok(ses.provisionedAt && ses.tenantArn.includes(`tenant/${name}/`));
		assert.equal(calls.filter((call) => call.name === "createTenant" && call.args.name === name).length, 1, "only once");
		assert.deepEqual(state.tenants.get(name), { accountId: user.accountId, policy: "standard", suppression: "TENANT" });
		assert.deepEqual([...state.associations.get(name)], [`configuration-set/${name}`], "no shared domain: each newsletter gets its own subdomain");
	});

	test("a failed setup doesn't stop the plan, and the first send finishes it", async () => {
		const user = await signIn("tenant-retry@example.com");
		state.failNext = { name: "createTenant", error: new Error("Throttled"), times: 2 };
		await m.billing.applySubscription(await m.Account.findById(user.accountId).lean(), {
			id: "sub_retry",
			status: "active",
			customer: "cus_retry",
			items: { data: [{ price: { lookup_key: "starter_month" } }] },
		});
		const account = await m.Account.findById(user.accountId).lean();
		assert.equal(account.subscriptionStatus, "active");
		assert.equal(account.ses?.provisionedAt, undefined);

		await createNewsletter(user, "retry-news");
		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		assert.equal(sent.at(-1).tenantName, `mc-${user.accountId}`);
	});

	test("an account's first domain sets up its tenant, then joins it once SES has the identity", async () => {
		const user = await signIn("first-domain@example.com");
		await activate(user);
		const name = `mc-${user.accountId}`;
		assert.equal(state.tenants.has(name), false, "no tenant yet, as on a self-hosted server");

		await addVerifiedDomain(user, "first-domain.example.com");
		const { ses } = await m.Account.findById(user.accountId).lean();
		assert.ok(ses.provisionedAt);
		assert.deepEqual([...state.associations.get(name)].sort(), [`configuration-set/${name}`, "identity/first-domain.example.com"]);
		assert.ok(await m.Domain.exists({ accountId: user.accountId, domain: "first-domain.example.com" }));
	});
});

describe("from addresses", () => {
	test("newsletters default to the shared address on their own subdomain, set up with its DNS records; replies go to the owner", async () => {
		const user = await customer("shared@example.com", "shared-news");
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.equal(newsletter.fromEmail, "hello@shared-news.mailcheapmail.com");
		const subdomain = "shared-news.mailcheapmail.com";
		assert.deepEqual(
			calls.findLast((call) => call.name === "createDomainIdentity").args,
			{ domain: subdomain, configurationSet: `mc-${user.accountId}`, mailFromDomain: `bounce.${subdomain}` }
		);
		assert.ok(state.associations.get(`mc-${user.accountId}`).has(`identity/${subdomain}`), "in the account's own tenant");
		const published = newsletter.sharedSender.dnsRecordIds.map((id) => dnsRecords.get(id));
		assert.deepEqual(
			published.map(({ slug, type, name, value }) => [slug, type, name, value]),
			[
				["shared-news", "CNAME", `tok1._domainkey.${subdomain}`, "tok1.dkim.amazonses.com"],
				["shared-news", "CNAME", `tok2._domainkey.${subdomain}`, "tok2.dkim.amazonses.com"],
				["shared-news", "CNAME", `tok3._domainkey.${subdomain}`, "tok3.dkim.amazonses.com"],
				["shared-news", "MX", `bounce.${subdomain}`, "10 feedback-smtp.us-east-1.amazonses.com"],
				["shared-news", "TXT", `bounce.${subdomain}`, "v=spf1 include:amazonses.com ~all"],
				["shared-news", "CNAME", subdomain, "cname.mailcheap.ai"],
			]
		);
		assert.deepEqual([newsletter.sharedSender.domain, newsletter.sharedSender.provider], [subdomain, "ses"]);

		const id = await draft(user);
		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		const email = sent.at(-1);
		assert.equal(email.from, "hello@shared-news.mailcheapmail.com");
		assert.equal(email.replyTo, "shared@example.com");
		assert.equal(email.tenantName, `mc-${user.accountId}`);
		assert.equal(email.configurationSet, `mc-${user.accountId}`);
		assert.match(email.html, /https:\/\/shared-news\.mailcheapmail\.com\/c\//, "tracked links on the shared subdomain");
		assert.match(email.headers["List-Unsubscribe"], /^<https:\/\/shared-news\.mailcheapmail\.com\/api\/unsubscribe\?token=/);
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender.verified, true, "SES found the records");
	});

	test("the shared address follows the slug, its old subdomain goes, and it can't be another newsletter's", async () => {
		const user = await customer("slug-follow@example.com", "first-slug");
		const first = (await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender;
		assert.equal((await saveFrom(user, "second-slug", "hello@first-slug.mailcheapmail.com")).ok, true);
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.equal(newsletter.fromEmail, "hello@second-slug.mailcheapmail.com");
		assert.equal(newsletter.sharedSender.domain, "second-slug.mailcheapmail.com");
		assert.equal(state.identities.has("first-slug.mailcheapmail.com"), false, "the old subdomain is free for anyone");
		assert.equal(state.associations.get(`mc-${user.accountId}`).has("identity/first-slug.mailcheapmail.com"), false);
		assert.ok(first.dnsRecordIds.every((recordId) => !dnsRecords.has(recordId)), "and so are its DNS records");
		assert.ok(state.identities.has("second-slug.mailcheapmail.com"));

		const other = await customer("slug-taker@example.com", "first-slug");
		assert.equal((await m.Newsletter.findOne({ accountId: other.accountId }).lean()).sharedSender.domain, "first-slug.mailcheapmail.com");
		assert.ok(state.associations.get(`mc-${other.accountId}`).has("identity/first-slug.mailcheapmail.com"), "in the new owner's tenant");
		assert.equal((await saveFrom(user, "second-slug", "hello@first-slug.mailcheapmail.com")).ok, true);
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).fromEmail, "hello@second-slug.mailcheapmail.com", "rewritten to its own");
	});

	test("before the provider's keys are in, the shared address waits without an alert; once they are, a failure alerts the admins", async () => {
		const alerts = () => platformEmails.filter(({ subject }) => subject === "[MailCheap] Shared address not set up").length;
		const before = { alerts: alerts(), calls: calls.length };
		const user = await withEnv({ SES_ACCESS_KEY_ID: "", SES_SECRET_ACCESS_KEY: "" }, () => customer("no-provider@example.com", "no-provider"));
		const waiting = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.equal(waiting.fromEmail, "hello@no-provider.mailcheapmail.com", "saved with its shared address");
		assert.equal(waiting.sharedSender, undefined);
		assert.equal(calls.slice(before.calls).some(({ name }) => name === "createDomainIdentity"), false, "nothing tried at SES");
		assert.equal(alerts(), before.alerts, "no alert");

		assert.equal((await saveFrom(user, "no-provider", "hello@no-provider.mailcheapmail.com")).ok, true);
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).sharedSender.domain, "no-provider.mailcheapmail.com", "set up once the keys are in");

		state.failNext = { name: "createDomainIdentity", error: new Error("SES didn't answer") };
		const error = console.error;
		console.error = () => {};
		try {
			await customer("ses-down@example.com", "ses-down");
		} finally {
			console.error = error;
		}
		assert.equal(alerts(), before.alerts + 1);
	});

	test("a domain the account didn't add is refused at save and at delivery", async () => {
		const user = await customer("stranger@example.com", "stranger-news");
		assert.match((await saveFrom(user, "stranger-news", "hi@example.com")).error, /Add example.com on the Domains page first/);

		const id = await draft(user);
		await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: [{ email: "reader@example.org", status: "active" }] }));
		assert.deepEqual(await as(user, () => m.campaigns.sendCampaign(id, {})), { ok: true });
		// Changed behind the dashboard's back: the send itself refuses it.
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { fromEmail: "ceo@bigbank.com" } });
		const before = sent.length;
		await runJobs();
		assert.equal(sent.length, before, "nothing went out");
		const campaign = await m.Campaign.findOne({ accountId: user.accountId, _id: id }).lean();
		assert.equal(campaign.status, "paused");
		assert.match(campaign.pauseReason, /bigbank.com isn't one of your domains/);
	});
});

describe("own domains", () => {
	test("adding a domain creates its identity in the tenant, with DKIM and a return path; the website stays where it is", async () => {
		const user = await customer("owner@example.com", "owner-news");
		const result = await as(user, () => m.domains.addDomainAction(null, form({ domain: "https://Owner-Mail.com/" })));
		assert.deepEqual(result, { ok: true, domain: "owner-mail.com" });

		const domain = await m.Domain.findOne({ accountId: user.accountId }).lean();
		assert.equal(domain.mailFromDomain, "bounce.owner-mail.com");
		assert.equal(domain.verified, false);
		assert.equal(domain.records.filter(({ purpose }) => purpose === "dkim").length, 3);
		assert.deepEqual(
			calls.findLast((call) => call.name === "createDomainIdentity").args,
			{ domain: "owner-mail.com", configurationSet: `mc-${user.accountId}`, mailFromDomain: "bounce.owner-mail.com" }
		);
		assert.equal(state.identities.get("owner-mail.com").keyLength, "RSA_2048_BIT");
		assert.ok(state.associations.get(`mc-${user.accountId}`).has("identity/owner-mail.com"));

		// Saved before verification, but nothing sends from it until the records are in.
		assert.deepEqual((await saveFrom(user, "owner-news", "hi@owner-mail.com")).error, undefined);
		const id = await draft(user);
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /owner-mail.com isn't verified yet/);

		state.identities.get("owner-mail.com").verified = true;
		cnames.set("news.owner-mail.com", ["cname.mailcheap.ai"]);
		assert.deepEqual(await as(user, () => m.domains.checkDomainAction(String(domain._id))), { ok: true, verified: true });
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).archiveHost, undefined, "a CNAME to MailCheap moves nothing");

		assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
		const email = sent.at(-1);
		assert.equal(email.from, "hi@owner-mail.com");
		assert.equal(email.tenantName, `mc-${user.accountId}`);
		assert.match(email.html, /https:\/\/owner-news\.mailcheapmail\.com\/c\//);
		assert.match(email.headers["List-Unsubscribe"], /^<https:\/\/owner-news\.mailcheapmail\.com\/api\/unsubscribe/);
	});

	test("an address or a link pasted as the domain adds the domain alone, from the dashboard and the API", async () => {
		const user = await customer("paste@example.com", "paste-news");
		const pasted = await as(user, () => m.domains.addDomainAction(null, form({ domain: "Jane Doe <jane@Pasted-Mail.com>" })));
		assert.deepEqual(pasted, { ok: true, domain: "pasted-mail.com" });
		assert.ok(state.identities.has("pasted-mail.com"), "added at the provider under the domain alone");

		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const linked = await callApi("POST", "/api/v1/domains", { key, body: { domain: "https://www.linked-mail.com/about", archiveHost: "letters.linked-mail.com" } });
		assert.equal(linked.status, 201, "an archiveHost from before is ignored");
		assert.equal(linked.body.domain, "linked-mail.com");
		assert.equal("archiveHost" in linked.body, false);
		const plain = await callApi("POST", "/api/v1/domains", { key, body: { domain: "plain-mail.com" } });
		assert.deepEqual([plain.status, plain.body.domain], [201, "plain-mail.com"], "a plain domain, as before");
	});

	test("the Domains page shows each record's host without the zone and copies what it shows; the API keeps the full name", async () => {
		const user = await customer("hosts-page@example.com", "hosts-page");
		await addVerifiedDomain(user, "apex-hosts.com");
		await addVerifiedDomain(user, "mail.sub-hosts.co.uk");
		const cards = findAll(renderPage(await as(user, () => m.domainsPage.default())), ({ type }) => type === "section");
		assert.equal(cards.length, 2);

		for (const card of cards) {
			for (const table of findAll(card, ({ type }) => type === "table")) {
				assert.deepEqual(findAll(table, ({ type }) => type === "th").map(textOf), ["Type", "Host", "Value"]);
			}
			for (const cell of readRecordRows(card).flat().filter((cell) => typeof cell === "object")) {
				assert.equal(cell.copied, cell.shown, "each Copy button copies what its cell shows");
			}
		}
		const shown = (card) => readRecordRows(card).map(([type, host, value]) => [type, host.shown, value.shown]);
		assert.deepEqual(shown(cards[0]), [
			["CNAME", "tok1._domainkey", "tok1.dkim.amazonses.com"],
			["CNAME", "tok2._domainkey", "tok2.dkim.amazonses.com"],
			["CNAME", "tok3._domainkey", "tok3.dkim.amazonses.com"],
			["MX", "bounce", "10 feedback-smtp.us-east-1.amazonses.com"],
			["TXT", "bounce", "v=spf1 include:amazonses.com ~all"],
			["TXT", "_dmarc", "v=DMARC1; p=none;"],
		]);
		assert.deepEqual(
			shown(cards[1]).map(([, host]) => host),
			["tok1._domainkey.mail", "tok2._domainkey.mail", "tok3._domainkey.mail", "bounce.mail", "bounce.mail", "_dmarc.mail"],
			"a subdomain of a co.uk domain: the zone is sub-hosts.co.uk"
		);
		assert.ok(textOf(cards[0]).includes("If your DNS provider asks for the full name, use tok1._domainkey.apex-hosts.com"));
		assert.ok(textOf(cards[1]).includes("If your DNS provider asks for the full name, use tok1._domainkey.mail.sub-hosts.co.uk"));

		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const { body } = await callApi("GET", "/api/v1/domains", { key });
		const records = body.domains.find(({ domain }) => domain === "mail.sub-hosts.co.uk").setup.flatMap(({ records }) => records);
		assert.deepEqual(records.find(({ type }) => type === "MX"), {
			type: "MX",
			name: "bounce.mail.sub-hosts.co.uk",
			host: "bounce.mail",
			value: "10 feedback-smtp.us-east-1.amazonses.com",
		});
	});

	test("the Domains page folds a domain's records under one line once every one of them is found", async () => {
		const user = await customer("folded-records@example.com", "folded-records");
		txts.set("_dmarc.folded-records.com", [["v=DMARC1; p=none;"]]);
		await addVerifiedDomain(user, "folded-records.com");
		await addVerifiedDomain(user, "open-records.com");
		const cards = findAll(renderPage(await as(user, () => m.domainsPage.default())), ({ type }) => type === "section");
		const card = (domain) => cards.find((section) => textOf(section).startsWith(domain));

		const [folded] = findAll(card("folded-records.com"), ({ type }) => type === "details");
		assert.ok(folded, "every record found");
		assert.equal(folded.props.open, undefined, "closed until it's opened");
		assert.match(textOf(findAll(folded, ({ type }) => type === "summary")), /^DNS records/);
		assert.equal(findAll(folded, ({ type }) => type === "table").length, 3, "each record is still there, with its Copy buttons");

		const open = card("open-records.com");
		assert.equal(findAll(open, ({ type }) => type === "details").length, 0, "without DMARC, its records stay out");
		assert.equal(findAll(open, ({ type }) => type === "table").length, 3);
	});

	test("the Domains page switches the newsletter to a verified domain, with the same checks as its settings", async () => {
		const user = await customer("switch@example.com", "switch-news");
		const domain = await addVerifiedDomain(user, "switch-mail.com");
		assert.deepEqual(await switchTo(user, domain, "not valid"), { error: "From email is invalid" });
		assert.deepEqual(await switchTo(user, domain, " Jane "), { ok: true, fromEmail: "jane@switch-mail.com" });
		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId }).lean();
		assert.deepEqual([newsletter.fromEmail, newsletter.archiveHost], ["jane@switch-mail.com", undefined], "its website has a domain of its own");
	});

	test("the Domains page links to the sender settings of a newsletter on the shared address only once a domain is verified", async () => {
		const user = await customer("shared-card@example.com", "shared-card");
		const pageHtml = async () => renderToStaticMarkup(createElement(m.TooltipProvider, null, await as(user, () => m.domainsPage.default())));
		const senderLink = /next=%2Fnewsletters%2Fsender/;
		const card = /shared-card still sends from the shared address/;

		const empty = await pageHtml();
		assert.match(empty, /hello@shared-card\.mailcheapmail\.com/, "the shared address and how it's doing");
		assert.doesNotMatch(empty, senderLink, "nothing pulls away from adding a domain");

		await as(user, () => m.domains.addDomainAction(null, form({ domain: "shared-card.dev" })));
		const pending = await pageHtml();
		assert.doesNotMatch(pending, senderLink, "nor while its records are missing");
		assert.doesNotMatch(pending, card);

		const domain = await addVerifiedDomain(user, "shared-card.com");
		const verified = await pageHtml();
		assert.match(verified, card);
		assert.ok(verified.includes(`href="${getSenderPath({ newsletterId: user.newsletterId, domainId: String(domain._id) })}"`), "with the verified domain picked");
		assert.doesNotMatch(verified, /hello@shared-card\.mailcheapmail\.com/, "the card takes its row's place");

		await switchTo(user, domain, "hi");
		const switched = await pageHtml();
		assert.doesNotMatch(switched, card);
		assert.match(switched, /Not in use/);
	});

	test("a domain still being verified, or another account's, can't be switched to", async () => {
		const user = await customer("switch-pending@example.com", "switch-pending");
		await as(user, () => m.domains.addDomainAction(null, form({ domain: "pending-mail.com" })));
		const pending = await m.Domain.findOne({ accountId: user.accountId, domain: "pending-mail.com" }).lean();
		assert.deepEqual(await switchTo(user, pending, "hi"), { error: "pending-mail.com isn't verified yet" });
		assert.equal((await m.Newsletter.findOne({ accountId: user.accountId }).lean()).fromEmail, "hello@switch-pending.mailcheapmail.com");

		const other = await customer("switch-other@example.com", "switch-other");
		const theirs = await addVerifiedDomain(other, "their-mail.com");
		assert.deepEqual(await switchTo(user, theirs, "hi"), { error: "Domain not found" });
	});

	test("a domain belongs to one account: a second one is refused", async () => {
		const first = await customer("first-owner@example.com", "first-owner");
		const second = await customer("second-owner@example.com", "second-owner");
		await addVerifiedDomain(first, "taken.com");
		const result = await as(second, () => m.domains.addDomainAction(null, form({ domain: "taken.com" })));
		assert.deepEqual(result, { error: "taken.com is used by another MailCheap account" });
		assert.match((await saveFrom(second, "second-owner", "hi@taken.com")).error, /Add taken.com on the Domains page first/);
		assert.equal(await m.Domain.countDocuments({ accountId: second.accountId }), 0);
		assert.deepEqual(await as(first, () => m.domains.addDomainAction(null, form({ domain: "taken.com" }))), { error: "taken.com is already added" });
	});

	test("another account's domain can't be checked or removed", async () => {
		const owner = await customer("guarded@example.com", "guarded");
		const attacker = await customer("attacker@example.com", "attacker");
		const domain = await addVerifiedDomain(owner, "guarded.com");
		assert.deepEqual(await as(attacker, () => m.domains.checkDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.deepEqual(await as(attacker, () => m.domains.removeDomainAction(String(domain._id))), { error: "Domain not found" });
		assert.ok(await m.Domain.exists({ accountId: owner.accountId, _id: domain._id }));
	});

	test("a domain with a campaign on its way can't be removed; afterwards it goes everywhere", async () => {
		const user = await customer("remove@example.com", "remove-news");
		const domain = await addVerifiedDomain(user, "leaving.com");
		await saveFrom(user, "remove-news", "hi@leaving.com");
		const id = await draft(user);
		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) } });
		assert.match((await as(user, () => m.domains.removeDomainAction(String(domain._id)))).error, /A campaign is sending or scheduled from leaving.com/);

		await m.Campaign.updateOne({ accountId: user.accountId, _id: id }, { $set: { status: "draft" }, $unset: { scheduledAt: 1 } });
		assert.deepEqual(await as(user, () => m.domains.removeDomainAction(String(domain._id))), { ok: true, removed: "leaving.com" });
		assert.equal(state.identities.has("leaving.com"), false);
		assert.equal(state.associations.get(`mc-${user.accountId}`).has("identity/leaving.com"), false);
		assert.match((await as(user, () => m.campaigns.sendTestCampaign(id))).error, /leaving.com isn't one of your domains/);
	});
});

describe("hosts", () => {
	test("each host resolves to its newsletter; the app host and unknown hosts don't", async () => {
		const user = await customer("hosts@example.com", "hosts-news");
		assert.deepEqual(await addLiveWebsiteDomain(user, "letters.hosts.dev"), { ok: true, live: true });
		const resolve = m.hostRouting.resolveArchiveHost;
		assert.deepEqual(await resolve("hosts-news.mailcheapmail.com"), { isArchiveHost: true, slug: "hosts-news" });
		assert.deepEqual(await resolve("Letters.Hosts.dev:443"), { isArchiveHost: true, slug: "hosts-news" });
		assert.deepEqual(await resolve("unknown.example.net"), { isArchiveHost: true, slug: null });
		assert.deepEqual(await resolve("localhost:3000"), { isArchiveHost: false, slug: null });
		assert.deepEqual(await resolve("mailcheap-git-main.vercel.app"), { isArchiveHost: false, slug: null });

		// Unsubscribe and tracking keep working after the plan ends.
		await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
		assert.deepEqual(await resolve("hosts-news.mailcheapmail.com"), { isArchiveHost: true, slug: "hosts-news" });
	});
});
