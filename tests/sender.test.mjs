import assert from "node:assert/strict";
import { test } from "node:test";
import { getDomainSetup, getDomainSummary } from "../lib/domain-records.js";
import {
	getDomainProblem,
	getFromEmailSaveProblem,
	getOwnDomainLocalPart,
	getSharedAddress,
	getSharedSendingDomain,
	isSharedSenderReady,
	normalizeDomainInput,
	normalizeHostInput,
	resolveFrom,
	withActiveProvider,
} from "../lib/sender-rules.js";

const SHARED = "mailcheapmail.com";
const ready = { domain: "field-notes.mailcheapmail.com", provider: "ses", verified: true };
const newsletter = { slug: "field-notes", fromEmail: "hello@field-notes.mailcheapmail.com", sharedSender: ready };
const domains = [
	{ domain: "example.com", verified: true },
	{ domain: "pending.example.org", verified: false },
];

test("the shared address is hello@ on the newsletter's own subdomain, and replies go to the customer", () => {
	assert.equal(getSharedSendingDomain("field-notes", SHARED), "field-notes.mailcheapmail.com");
	assert.equal(getSharedAddress("field-notes", SHARED), "hello@field-notes.mailcheapmail.com");
	assert.equal(getSharedAddress("field-notes", null), null);
	assert.deepEqual(resolveFrom({ newsletter, domains: [], ownerEmail: "jane@example.com", sharedDomain: SHARED, providerId: "ses" }), {
		identity: "field-notes.mailcheapmail.com",
		replyTo: "jane@example.com",
		isShared: true,
	});
	assert.equal(
		resolveFrom({ newsletter: { ...newsletter, replyTo: "hi@jane.dev" }, ownerEmail: "jane@example.com", sharedDomain: SHARED, providerId: "ses" }).replyTo,
		"hi@jane.dev"
	);
	for (const fromEmail of ["hello@other-slug.mailcheapmail.com", "jane@field-notes.mailcheapmail.com", "field-notes@mailcheapmail.com"]) {
		assert.match(
			resolveFrom({ newsletter: { ...newsletter, fromEmail }, ownerEmail: "jane@example.com", sharedDomain: SHARED, providerId: "ses" }).problem,
			/The shared address for this newsletter is hello@field-notes.mailcheapmail.com/,
			fromEmail
		);
	}
});

test("replies go to the newsletter's default author, then to its reply-to from before authors, then to the owner", () => {
	const replyTo = (fields) => resolveFrom({ ownerEmail: "jane@example.com", sharedDomain: SHARED, providerId: "ses", domains, ...fields }).replyTo;
	const withReplyTo = { ...newsletter, replyTo: "desk@example.com" };
	assert.equal(replyTo({ newsletter: withReplyTo, authorEmail: "ada@example.com" }), "ada@example.com");
	assert.equal(replyTo({ newsletter: withReplyTo }), "desk@example.com");
	assert.equal(replyTo({ newsletter: { ...withReplyTo, fromEmail: "hi@example.com" }, authorEmail: "ada@example.com" }), "ada@example.com", "an own domain too");
	assert.equal(replyTo({ newsletter: { ...newsletter, fromEmail: "hi@example.com" } }), undefined, "else to the from address");
	assert.match(
		resolveFrom({ newsletter, ownerEmail: null, sharedDomain: SHARED, providerId: "ses" }).problem,
		/Add an author to the newsletter/,
		"the shared address needs someone to get the replies"
	);
});

test("the shared address sends once its subdomain is verified at the active provider", () => {
	const from = (sharedSender, providerId = "ses") => resolveFrom({ newsletter: { ...newsletter, sharedSender }, ownerEmail: "jane@example.com", sharedDomain: SHARED, providerId });
	assert.match(from(undefined).problem, /hello@field-notes.mailcheapmail.com is still being set up/);
	assert.match(from({ ...ready, verified: false }).problem, /still being set up/);
	assert.match(from({ ...ready, domain: "old-slug.mailcheapmail.com" }).problem, /still being set up/, "the old slug's subdomain");
	assert.match(from(ready, "postshiba").problem, /still being set up/, "set up at the other provider");
	assert.equal(isSharedSenderReady({ ...newsletter, sharedSender: { ...ready, provider: "postshiba" } }, { sharedDomain: SHARED, providerId: "postshiba" }), true);
});

test("an own domain sends once the account added and verified it", () => {
	const from = (fromEmail) => resolveFrom({ newsletter: { ...newsletter, fromEmail }, domains, ownerEmail: "jane@example.com", sharedDomain: SHARED });
	assert.deepEqual(from("hi@example.com"), { identity: "example.com", replyTo: undefined, isShared: false });
	assert.match(from("hi@pending.example.org").problem, /isn't verified yet/);
	assert.match(from("hi@stranger.com").problem, /isn't one of your domains/);
	assert.match(from("hi@sub.example.com").problem, /isn't one of your domains/, "subdomains are their own identity");
	assert.match(from("").problem, /Add a from email/);
});

test("a domain counts as verified at the provider it was added at", () => {
	assert.equal(withActiveProvider({ domain: "example.com", verified: true }, "ses").verified, true, "from before the switch: SES");
	assert.equal(withActiveProvider({ domain: "example.com", verified: true }, "postshiba").verified, false);
	assert.equal(withActiveProvider({ domain: "example.com", verified: true, provider: "postshiba" }, "postshiba").verified, true);
	assert.equal(withActiveProvider({ domain: "example.com", verified: false, provider: "postshiba" }, "postshiba").verified, false);
});

test("saving a newsletter takes the shared address or a domain the account added", () => {
	const problem = (fromEmail) => getFromEmailSaveProblem({ fromEmail, slug: "field-notes", domains, sharedDomain: SHARED });
	assert.equal(problem("hello@field-notes.mailcheapmail.com"), null);
	assert.equal(problem("hi@example.com"), null);
	assert.equal(problem("hi@pending.example.org"), null, "unverified is fine to save; sends wait");
	assert.match(problem("hello@someone-else.mailcheapmail.com"), /Use hello@field-notes.mailcheapmail.com/);
	assert.match(problem("field-notes@mailcheapmail.com"), /Use hello@field-notes.mailcheapmail.com/, "the old format");
	assert.match(problem("hi@stranger.com"), /Add stranger.com on the Domains page first, or use hello@field-notes.mailcheapmail.com/);
	assert.match(getFromEmailSaveProblem({ fromEmail: "hi@stranger.com", slug: "x", domains: [], sharedDomain: null }), /Domains page first$/);
});

test("customers can't claim MailCheap's domains", () => {
	const options = { sharedDomain: SHARED, appHost: "mailcheap.ai" };
	assert.equal(getDomainProblem("example.com", options), null);
	assert.equal(getDomainProblem("news.example.co.uk", options), null);
	for (const domain of ["mailcheapmail.com", "x.mailcheapmail.com", "mailcheap.ai", "app.mailcheap.ai", "amazonses.com", "postshiba.com", "foo.vercel.app"]) {
		assert.match(getDomainProblem(domain, options), /can't be added/, domain);
	}
	for (const domain of ["example", "-bad.com", "a..b.com", "exa mple.com"]) assert.match(getDomainProblem(domain, options), /Enter a domain/, domain);
});

test("with the app's own domain shared, <slug>.mailcheap.ai is the shared address and the rest of mailcheap.ai stays MailCheap's", () => {
	const sharedDomain = "mailcheap.ai";
	const options = { sharedDomain, appHost: "mailcheap.ai" };
	for (const domain of ["mailcheap.ai", "r.mailcheap.ai", "weekly.mailcheap.ai", "news.weekly.mailcheap.ai"]) {
		assert.match(getDomainProblem(domain, options), /can't be added/, domain);
	}
	assert.equal(getDomainProblem("example.com", options), null);

	const save = (fromEmail) => getFromEmailSaveProblem({ fromEmail, slug: "weekly", domains: [], sharedDomain });
	assert.equal(save("hello@weekly.mailcheap.ai"), null);
	for (const fromEmail of ["hello@mailcheap.ai", "hello@r.mailcheap.ai", "hello@www.mailcheap.ai", "hello@other.mailcheap.ai"]) {
		assert.match(save(fromEmail), /^Use hello@weekly.mailcheap.ai, the shared address/, fromEmail);
	}

	const ready = { domain: "weekly.mailcheap.ai", provider: "postshiba", verified: true };
	const from = (fromEmail) => resolveFrom({ newsletter: { slug: "weekly", fromEmail, sharedSender: ready }, ownerEmail: "jane@example.com", sharedDomain, providerId: "postshiba" });
	assert.deepEqual(from("hello@weekly.mailcheap.ai"), { identity: "weekly.mailcheap.ai", replyTo: "jane@example.com", isShared: true });
	assert.match(from("hello@r.mailcheap.ai").problem, /The shared address for this newsletter is hello@weekly.mailcheap.ai/, "never MailCheap's own sender");
	assert.equal(getOwnDomainLocalPart("hello@weekly.mailcheap.ai", sharedDomain), "hi");
});

test("pasted domains lose their scheme, path and trailing dot", () => {
	assert.equal(normalizeHostInput(" https://Example.com/path?x=1 "), "example.com");
	assert.equal(normalizeHostInput("news.example.com."), "news.example.com");
	assert.equal(normalizeHostInput(undefined), "");
});

test("a sending domain can be pasted as an address at it or a link to it", () => {
	for (const [input, domain, message = input] of [
		["example.com", "example.com"],
		[" Example.COM. ", "example.com"],
		["jane@example.com", "example.com"],
		["Jane Doe <Jane@Example.com>", "example.com"],
		["mailto:jane@example.com?subject=Hi", "example.com"],
		["https://www.example.com/about?ref=x#team", "example.com"],
		["http://example.com:8080/", "example.com"],
		["https://jane@news.example.co.uk/", "news.example.co.uk"],
		["https://example.com/@jane", "example.com", "an @ in the path isn't an address"],
		["mail.example.com", "mail.example.com", "a sending subdomain stays"],
	]) {
		assert.equal(normalizeDomainInput(input), domain, message);
	}
	assert.equal(normalizeDomainInput("jane@"), "");
	assert.equal(normalizeDomainInput(undefined), "");
});

test("on a domain of its own, a newsletter keeps the name before its @, and hi after the shared address", () => {
	assert.equal(getOwnDomainLocalPart("hello@field-notes.mailcheapmail.com", SHARED), "hi");
	assert.equal(getOwnDomainLocalPart("Jane@Example.com", SHARED), "jane");
	assert.equal(getOwnDomainLocalPart("", SHARED), "hi");
	assert.equal(getOwnDomainLocalPart(undefined, null), "hi");
});

test("the domains page lists every record with its status in words, and a verified domain is ready", () => {
	const domain = {
		domain: "example.com",
		mailFromDomain: "bounce.example.com",
		archiveHost: "news.example.com",
		dkimStatus: "SUCCESS",
		mailFromStatus: "PENDING",
		verified: true,
		records: [
			{ purpose: "dkim", type: "CNAME", name: "a._domainkey.example.com", value: "a.dkim.amazonses.com" },
			{ purpose: "mail-from", type: "MX", name: "bounce.example.com", value: "10 feedback-smtp.us-east-1.amazonses.com" },
		],
	};
	const setup = getDomainSetup(domain);
	assert.deepEqual(setup.map(({ key }) => key), ["dkim", "mail-from", "dmarc"], "the website has a domain of its own, in its settings");
	const steps = Object.fromEntries(setup.map((step) => [step.key, step]));
	assert.equal(steps.dkim.status.label, "Found");
	assert.equal(steps["mail-from"].status.label, "Waiting for DNS");
	assert.deepEqual(steps.dmarc.records, [{ type: "TXT", name: "_dmarc.example.com", host: "_dmarc", value: "v=DMARC1; p=none;" }]);
	assert.deepEqual(getDomainSummary(domain), { label: "Ready", tone: "good" });
	assert.equal(getDomainSummary({ ...domain, verified: false }).label, "Waiting for DNS");
	assert.equal(getDomainSummary({ ...domain, verified: false, dkimStatus: "FAILED" }).label, "Records not found");
});
