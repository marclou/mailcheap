import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	SIGNUP_FORM_RATE_LIMITS,
	getEmbedCode,
	getFramePolicy,
	getSignupFormHeading,
	getSignupFormProblem,
	isAllowedHost,
	normalizeDomain,
	normalizeDomains,
	toSignupFormSettings,
} from "../lib/signup-form.js";
import { renderFormPage } from "../lib/signup-form-page.js";
import { activate, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { setBotIdVerdict } from "./stubs/botid-server.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// The signup form owners paste on their own sites (lib/signup-form.js): the code it gives, its settings, the endpoint
// that takes signups from any site (app/api/embed/[id]/route.js), its frame and the page the plain form lands on.

const NEWSLETTER_ID = "64f1a2b3c4d5e6f7a8b9c0b1";

test("a site's address is kept as its domain, which covers its subdomains", () => {
	assert.equal(normalizeDomain("https://www.Example.com/blog?x=1"), "example.com");
	assert.equal(normalizeDomain("*.example.com"), "example.com");
	assert.equal(normalizeDomain("blog.example.org:8080"), "blog.example.org");
	assert.equal(normalizeDomain("localhost"), "localhost");
	assert.equal(normalizeDomain("not a site"), null);
	assert.equal(normalizeDomain("javascript:alert(1)"), null);
	assert.deepEqual(normalizeDomains(["example.com", "https://example.com", "nope nope", "Blog.dev"]), ["example.com", "blog.dev"]);

	assert.equal(isAllowedHost(null, []), true, "without a list, any site");
	for (const host of ["example.com", "www.example.com", "news.example.com"]) assert.equal(isAllowedHost(host, ["example.com"]), true, host);
	for (const host of ["badexample.com", "example.com.evil.io", null]) assert.equal(isAllowedHost(host, ["example.com"]), false, String(host));
});

test("the form's settings fall back to their defaults and refuse what doesn't fit", () => {
	assert.deepEqual(toSignupFormSettings(undefined), {
		enabled: false,
		layout: "inline",
		headline: null,
		subheadline: null,
		askFirstName: false,
		buttonText: "Subscribe",
		placeholder: "you@example.com",
		allowedDomains: [],
	});
	const settings = (changes) => toSignupFormSettings({ enabled: true, ...changes });
	assert.equal(getSignupFormProblem(settings({ buttonText: "x".repeat(31) })), "Keep the button under 30 characters");
	assert.equal(getSignupFormProblem(settings({ layout: "popup" })), null, "an unknown layout falls back to inline");
	assert.equal(getSignupFormProblem(settings({ allowedDomains: ["not a site"] })), "not a site isn't a site's address. Use one like example.com");
	assert.match(getSignupFormProblem(settings({ allowedDomains: Array.from({ length: 11 }, (_, i) => `site${i}.com`) })), /^List 10 sites at most/);
	assert.equal(getSignupFormProblem(settings({ allowedDomains: ["example.com"] })), null);
});

test("the code to paste points at the server, escapes the owner's text and hides the bots' field", () => {
	const settings = toSignupFormSettings({ buttonText: '"><script>alert(1)</script>', placeholder: "Your <email>" });
	const { script, html } = getEmbedCode({ appUrl: "https://mailcheap.test", newsletterId: NEWSLETTER_ID, settings, theme: {} });
	assert.equal(script, `<script src="https://mailcheap.test/embed.js" data-form="${NEWSLETTER_ID}" async></script>`);
	assert.ok(html.startsWith(`<form action="https://mailcheap.test/api/embed/${NEWSLETTER_ID}" method="post"`));
	assert.ok(html.includes('name="website" tabindex="-1"'), "the field only bots fill in");
	assert.ok(!html.includes("<script>") && html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
	assert.ok(html.includes('placeholder="Your &lt;email&gt;"'));
});

test("with a list of sites there's no plain form to paste: only the framed one can prove which site it's on", () => {
	const settings = toSignupFormSettings({ allowedDomains: ["example.com"] });
	const { script, html } = getEmbedCode({ appUrl: "https://mailcheap.test", newsletterId: NEWSLETTER_ID, settings, theme: {} });
	assert.ok(script.includes(`data-form="${NEWSLETTER_ID}"`));
	assert.equal(html, null);
});

test("the frame proves a browser sent its form only where BotID runs, and never in the preview", () => {
	const newsletter = { name: "Field notes", theme: {} };
	const endpoint = `/api/embed/${NEWSLETTER_ID}`;
	const page = (options) => renderFormPage({ newsletter, settings: toSignupFormSettings({}), endpoint, token: "t", ...options });
	const checked = page({ botId: true });
	assert.ok(checked.includes('<script type="module">import{initBotId}from"/embed/botid";'));
	assert.ok(checked.includes(`initBotId({protect:[{path:"${endpoint}",method:"POST"}]})`));
	assert.ok(!page({}).includes("initBotId"));
	assert.ok(!page({ botId: true, isPreview: true }).includes("initBotId"));
});

test("the card's headline follows the newsletter until its owner writes one, and an empty one shows nothing", () => {
	const newsletter = { name: "Field notes", description: "One idea a week.", theme: {} };
	const settings = (signupForm) => toSignupFormSettings(signupForm);
	assert.deepEqual(getSignupFormHeading(settings({}), newsletter), { headline: "Field notes", subheadline: "One idea a week." });
	assert.deepEqual(getSignupFormHeading(settings({ headline: " Join 2,000 readers ", subheadline: "" }), newsletter), {
		headline: "Join 2,000 readers",
		subheadline: "",
	});
	assert.equal(getSignupFormProblem(settings({ headline: "x".repeat(81) })), "Keep the headline under 80 characters");

	const html = (signupForm) =>
		getEmbedCode({ appUrl: "https://mailcheap.test", newsletterId: NEWSLETTER_ID, settings: settings(signupForm), theme: {}, newsletter }).html;
	assert.ok(!html({}).includes("Field notes"), "inline: the form alone");
	const card = html({ layout: "card", headline: "<b>Join</b>" });
	assert.ok(card.startsWith("<div ") && card.endsWith("</div>"));
	assert.ok(card.includes(">&lt;b&gt;Join&lt;/b&gt;</p>") && card.includes(">One idea a week.</p>"));
	assert.ok(!html({ layout: "card", headline: "", subheadline: "" }).includes("<p "), "nothing above the form");
	assert.ok(html({ askFirstName: true }).includes('name="first_name"'));
	assert.ok(!html({}).includes("first_name"));

	const page = (signupForm) => renderFormPage({ newsletter, settings: settings(signupForm), endpoint: "#", isPreview: true });
	assert.ok(page({ layout: "card", headline: "Join us" }).includes('<h1 class="mc-title">Join us</h1><p class="mc-description mc-muted">One idea a week.</p>'));
	assert.ok(!page({ layout: "card", headline: "", subheadline: "" }).includes("<h1"));
	assert.ok(page({ layout: "card", askFirstName: true }).includes('name="first_name"'));
});

test("with a list of sites, the browser keeps the frame off every other site", () => {
	assert.equal(getFramePolicy([]), null);
	const policy = getFramePolicy(["example.com", "blog.dev"]);
	assert.ok(policy.startsWith("frame-ancestors example.com *.example.com blog.dev *.blog.dev;"));
	assert.ok(policy.includes("form-action 'self'") && policy.includes("script-src-attr 'none'") && policy.includes("object-src 'none'"));
});

describe("signups from forms on other sites", () => {
	let app;
	let m;
	let nextIp = 0;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			endpoint: await import("../app/api/embed/[id]/route.js"),
			frame: await import("../app/embed/[id]/route.js"),
			done: await import("../app/embed/[id]/done/route.js"),
			botid: await import("../app/embed/botid/route.js"),
			tokens: await import("../lib/signup-form-token.js"),
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
	});

	after(() => {
		setBotIdVerdict("human");
		return app?.stop();
	});

	// A paying customer with a newsletter and the form on. fields: the newsletter's other settings.
	async function customer(email, { signupForm = {}, ...fields } = {}) {
		const user = await signIn(email);
		await activate(user);
		const slug = email.split("@")[0];
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", ...fields })))
		);
		user.newsletterId = url.split("/").at(-1);
		const saved = await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { enabled: true, ...signupForm }));
		assert.equal(saved.ok, true, saved.error);
		return user;
	}

	function visitor() {
		return `198.18.0.${++nextIp}`;
	}

	// What a page's browser sends: the framed form posts JSON with its token, the plain form posts fields from the site.
	function post(id, body, { json = true, ip = visitor(), headers = {} } = {}) {
		const request = new Request(`http://localhost:3000/api/embed/${id}`, {
			method: "POST",
			headers: {
				"x-forwarded-for": ip,
				...(json
					? { "content-type": "application/json", accept: "application/json" }
					: { "content-type": "application/x-www-form-urlencoded" }),
				...headers,
			},
			body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
		});
		return m.endpoint.POST(request, { params: Promise.resolve({ id }) });
	}

	// A token from a frame that loaded on the page at origin a few seconds ago.
	function token(id, origin, secondsAgo = 5) {
		return m.tokens.createFormToken({ newsletterId: id, origin }, Date.now() - secondsAgo * 1000);
	}

	function readDone(response) {
		assert.equal(response.status, 303);
		const location = new URL(response.headers.get("location"));
		return { path: location.pathname, done: m.tokens.readDoneToken(location.searchParams.get("s")) };
	}

	const findContact = (user, email) => m.Contact.findOne({ accountId: user.accountId, newsletterId: user.newsletterId, email }).lean();

	test("the plain form lands on its page, and the contact keeps the site it came from", async () => {
		const user = await customer("embed-plain@example.com");
		const response = await post(user.newsletterId, { email: "Reader@Example.org", website: "" }, {
			json: false,
			headers: { origin: "https://reader-blog.example", referer: "https://reader-blog.example/" },
		});
		const { path, done } = readDone(response);
		assert.equal(path, `/embed/${user.newsletterId}/done`);
		assert.deepEqual([done.result, done.back], ["subscribed", "https://reader-blog.example/"]);
		const contact = await findContact(user, "reader@example.org");
		assert.deepEqual([contact.status, contact.source, contact.sourceDomain], ["active", "embed", "reader-blog.example"]);

		const page = await m.done.GET(new Request(response.headers.get("location")), { params: Promise.resolve({ id: user.newsletterId }) });
		const html = await page.text();
		assert.ok(html.includes("You&#39;re in") || html.includes("You're in"));
		assert.ok(html.includes("Back to reader-blog.example"));
	});

	test("the framed form answers in JSON, follows confirmed opt-in and sends the confirmation email", async () => {
		const user = await customer("embed-framed@example.com", { requireConfirmation: "on" });
		const response = await post(user.newsletterId, { email: "framed@example.org", token: token(user.newsletterId, "https://site.example") });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("access-control-allow-origin"), "*");
		const body = await response.json();
		assert.deepEqual([body.ok, body.pending], [true, true]);
		await flushAfter();
		const contact = await findContact(user, "framed@example.org");
		assert.deepEqual([contact.status, contact.sourceDomain], ["pending", "site.example"]);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: "confirmation", contactId: contact._id }), 1);
	});

	test("the welcome email goes out to a new contact without confirmed opt-in", async () => {
		const user = await customer("embed-welcome@example.com", {
			welcomeEnabled: "on",
			welcomeSubject: "Welcome",
			welcomeMarkdown: "Thanks for joining.",
		});
		const response = await post(user.newsletterId, { email: "welcomed@example.org", token: token(user.newsletterId, "https://site.example") });
		assert.equal((await response.json()).pending, false);
		await flushAfter();
		const contact = await findContact(user, "welcomed@example.org");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: "welcome", contactId: contact._id }), 1);
	});

	test("a form that asks for a first name saves it on the new contact, and one that doesn't ignores it", async () => {
		const user = await customer("embed-name@example.com", { signupForm: { askFirstName: true } });
		const named = await post(user.newsletterId, { email: "named@example.org", first_name: "  Ada \n", token: token(user.newsletterId, "https://site.example") });
		assert.equal(named.status, 200);
		assert.equal((await findContact(user, "named@example.org")).firstName, "Ada");

		const other = await customer("embed-unnamed@example.com");
		await post(other.newsletterId, { email: "unnamed@example.org", first_name: "Bob", token: token(other.newsletterId, "https://site.example") });
		assert.equal((await findContact(other, "unnamed@example.org")).firstName, undefined);
	});

	test("someone who unsubscribed confirms by email before they're back, even with confirmed opt-in off", async () => {
		const user = await customer("embed-returning@example.com");
		await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "left@example.org", status: "unsubscribed" });
		const body = await (await post(user.newsletterId, { email: "left@example.org", token: token(user.newsletterId, "https://site.example") })).json();
		assert.equal(body.pending, true);
		assert.equal((await findContact(user, "left@example.org")).status, "pending");
	});

	test("bots get nowhere: the hidden field, a form posted at once, an old or another form's token, and no Origin", async () => {
		const user = await customer("embed-bots@example.com");
		const id = user.newsletterId;
		assert.deepEqual(await (await post(id, { email: "trap@example.org", website: "https://spam.example" })).json(), {
			ok: true,
			pending: false,
			inbox: null,
		});
		const tooFast = await post(id, { email: "fast@example.org", token: token(id, "https://site.example", 0) });
		assert.deepEqual([tooFast.status, (await tooFast.json()).error], [400, "One second, then try again."]);
		const expired = await post(id, { email: "old@example.org", token: token(id, "https://site.example", 25 * 3600) });
		assert.equal(expired.status, 400);
		const otherForm = await post(id, { email: "other@example.org", token: token(NEWSLETTER_ID, "https://site.example") });
		assert.equal(otherForm.status, 400);
		const scripted = await post(id, { email: "curl@example.org" });
		assert.equal(scripted.status, 400, "no token and no Origin: not a browser");
		const saved = await m.Contact.find({ accountId: user.accountId }).distinct("email");
		assert.deepEqual(saved, []);
	});

	test("a list of sites keeps the form to them, in the frame and at the endpoint", async () => {
		const user = await customer("embed-sites@example.com", { signupForm: { allowedDomains: ["https://www.Example.com/"] } });
		const id = user.newsletterId;
		const framed = (origin) => post(id, { email: `${new URL(origin).hostname}@example.org`, token: token(id, origin) });
		assert.equal((await framed("https://blog.example.com")).status, 200);
		assert.equal((await framed("https://other.io")).status, 403);

		const load = (referer) =>
			m.frame.GET(new Request(`http://localhost:3000/embed/${id}`, { headers: referer ? { referer } : {} }), { params: Promise.resolve({ id }) });
		const onSite = await load("https://example.com/");
		assert.equal(onSite.status, 200);
		assert.equal(onSite.headers.get("content-security-policy").split(";")[0], "frame-ancestors example.com *.example.com");
		assert.ok((await onSite.text()).includes('name="token"'));
		assert.equal((await load("https://other.io/")).status, 403);
		assert.equal((await load(null)).status, 403, "a page that hides its address can't prove it's one of them");
	});

	test("with a list of sites, a script can't pass for one of them: the plain form is off and the framed one needs a browser", async (t) => {
		t.mock.method(console, "warn", () => {});
		const user = await customer("embed-forged@example.com", { signupForm: { allowedDomains: ["example.com"] } });
		const id = user.newsletterId;
		// A script names a listed site in the Origin no browser elsewhere would send.
		const forged = await post(id, { email: "forged@example.org" }, { headers: { origin: "https://example.com", referer: "https://example.com/" } });
		assert.deepEqual([forged.status, (await forged.json()).error], [403, "This form doesn't take signups on this site"]);
		await flushAfter();
		const alerts = platformEmails.filter(({ subject }) => subject === "[MailCheap] HTML signup form refused");
		assert.deepEqual(alerts.at(-1)?.to, ["embed-forged@example.com"], "its owner learns the plain form is off");

		// Or it loads the frame with a listed site as its referrer for a token, which only a browser can then use.
		const scripted = token(id, "https://example.com");
		await withEnv({ VERCEL: "1" }, async () => {
			setBotIdVerdict("bot");
			const refused = await post(id, { email: "scripted@example.org", token: scripted });
			assert.deepEqual([refused.status, (await refused.json()).error], [403, "Couldn't sign you up. Try again from the form."]);
			setBotIdVerdict("human");
			assert.equal((await post(id, { email: "person@example.org", token: scripted })).status, 200);
		});
		assert.deepEqual(await m.Contact.find({ accountId: user.accountId }).distinct("email"), ["person@example.org"]);
	});

	test("on Vercel, the frame loads BotID's browser code from MailCheap's own host", async () => {
		const user = await customer("embed-botid@example.com");
		const id = user.newsletterId;
		const load = async () =>
			(
				await m.frame.GET(new Request(`http://localhost:3000/embed/${id}`, { headers: { referer: "https://site.example/" } }), {
					params: Promise.resolve({ id }),
				})
			).text();
		assert.ok(!(await load()).includes("initBotId"), "a self-hosted server has no BotID");
		assert.equal((await m.botid.GET()).status, 404);
		await withEnv({ VERCEL: "1" }, async () => {
			assert.ok((await load()).includes(`initBotId({protect:[{path:"/api/embed/${id}",method:"POST"}]})`));
			const code = await m.botid.GET();
			assert.equal(code.headers.get("content-type"), "text/javascript; charset=utf-8");
			assert.match(await code.text(), /export\{\w+ as initBotId/);
		});
	});

	test("past its limit, a newsletter's form refuses signups until they slow down, and its owner hears once", async (t) => {
		t.mock.method(console, "warn", () => {});
		const user = await customer("embed-flood@example.com");
		const id = user.newsletterId;
		const { perNewsletterPlain } = SIGNUP_FORM_RATE_LIMITS;
		const plain = (email) => post(id, { email }, { headers: { origin: "https://site.example" } });
		for (let index = 0; index < perNewsletterPlain.limit; index++) assert.equal((await plain(`plain-${index}@example.org`)).status, 200);
		const emailsBefore = platformEmails.length;
		for (const email of ["flood-one@example.org", "flood-two@example.org"]) {
			const refused = await plain(email);
			assert.deepEqual([refused.status, (await refused.json()).error], [429, "This form is busy. Try again in a few minutes."]);
			await flushAfter();
		}
		const alerts = platformEmails.slice(emailsBefore).filter(({ subject }) => subject === "[MailCheap] Signup form paused");
		assert.equal(alerts.length, 1);
		assert.match(alerts[0].text, /Over 20 signups to embed-flood from its HTML form in 10 minutes, so it refuses new ones/);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId }), perNewsletterPlain.limit, "nobody the flood typed joins");

		// The framed form, which proves a browser sent it, keeps its own, larger share.
		assert.equal((await post(id, { email: "reader@example.org", token: token(id, "https://site.example") })).status, 200);
	});

	test("visitors and addresses get a few signups at a time, whichever newsletters ask", async () => {
		const user = await customer("embed-limits@example.com");
		const second = await customer("embed-limits-two@example.com");
		const ip = visitor();
		const { perIp, perEmail } = SIGNUP_FORM_RATE_LIMITS;
		const framed = (id, email, from = ip) => post(id, { email, token: token(id, "https://site.example") }, { ip: from });
		for (let index = 0; index < perIp.limit; index++) assert.equal((await framed(user.newsletterId, `ip-${index}@example.org`)).status, 200);
		assert.equal((await framed(user.newsletterId, "one-too-many@example.org")).status, 429);

		const statuses = [];
		for (let index = 0; index <= perEmail.limit; index++) {
			const id = index % 2 ? second.newsletterId : user.newsletterId;
			statuses.push((await framed(id, "popular@example.org", visitor())).status);
		}
		assert.deepEqual(statuses, [...Array(perEmail.limit).fill(200), 429]);
	});

	test("a form that's off, or an account without a plan, takes no signups", async () => {
		const user = await customer("embed-off@example.com", { signupForm: { enabled: false } });
		const off = await post(user.newsletterId, { email: "nobody@example.org", token: token(user.newsletterId, "https://site.example") });
		assert.deepEqual([off.status, (await off.json()).error], [404, "This form isn't taking signups"]);
		const frame = await m.frame.GET(new Request(`http://localhost:3000/embed/${user.newsletterId}`), {
			params: Promise.resolve({ id: user.newsletterId }),
		});
		assert.equal(frame.status, 404);
		assert.equal((await post("not-an-id", { email: "x@example.org" }, { headers: { origin: "https://a.example" } })).status, 404);
	});

	test("scripts on other sites can ask first, and get the form's settings and code from the API and MCP", async () => {
		const preflight = m.endpoint.OPTIONS();
		assert.equal(preflight.status, 204);
		assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");

		const user = await customer("embed-api@example.com", { signupForm: { buttonText: "Join", allowedDomains: ["example.com"] } });
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const { status, body } = await callApi("GET", `/api/v1/newsletters/${user.newsletterId}/signup-form`, { key });
		assert.equal(status, 200);
		assert.deepEqual([body.enabled, body.buttonText, body.allowedDomains], [true, "Join", ["example.com"]]);
		assert.equal(body.endpoint, `http://localhost:3000/api/embed/${user.newsletterId}`);
		assert.ok(body.script.includes(`data-form="${user.newsletterId}"`));
		assert.equal(body.html, null, "with sites listed, only the script works");
		await callApi("PATCH", `/api/v1/newsletters/${user.newsletterId}`, { key, body: { signupForm: { allowedDomains: [] } } });
		const anySite = await callApi("GET", `/api/v1/newsletters/${user.newsletterId}/signup-form`, { key });
		assert.ok(anySite.body.html.includes(">Join</button>"));

		const refused = await callApi("PATCH", `/api/v1/newsletters/${user.newsletterId}`, { key, body: { signupForm: { allowedDomains: ["not a site"] } } });
		assert.equal(refused.status, 400);
		assert.match(refused.body.error.message, /not a site isn't a site's address/);
	});

	test("the done page only says what the form did, and nothing for a link someone changed", async () => {
		const user = await customer("embed-done@example.com");
		const open = (s) =>
			m.done.GET(new Request(`http://localhost:3000/embed/${user.newsletterId}/done?s=${encodeURIComponent(s)}`), {
				params: Promise.resolve({ id: user.newsletterId }),
			});
		const pending = m.tokens.createDoneToken({ result: "pending", back: "https://site.example/" });
		assert.ok((await (await open(pending)).text()).includes("Check your inbox"));
		const changed = await (await open(`${pending.slice(0, -2)}xx`)).text();
		assert.ok(changed.includes("That didn&#39;t work") || changed.includes("That didn't work"));
		assert.ok(!changed.includes("Back to"));
	});

	test("the dashboard refuses the form's settings it can't keep", async () => {
		const user = await customer("embed-settings@example.com");
		const refused = await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { allowedDomains: ["nope nope"] }));
		assert.match(refused.error, /isn't a site's address/);
		const saved = await as(user, () =>
			m.newsletters.saveSignupForm(user.newsletterId, { enabled: true, layout: "card", allowedDomains: ["https://www.Blog.dev/x", "blog.dev"] })
		);
		assert.deepEqual([saved.signupForm.layout, saved.signupForm.allowedDomains], ["card", ["blog.dev"]]);

		const titled = await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { headline: "Join us", subheadline: "", askFirstName: true }));
		assert.deepEqual(
			[titled.signupForm.headline, titled.signupForm.subheadline, titled.signupForm.askFirstName, titled.signupForm.allowedDomains],
			["Join us", "", true, ["blog.dev"]]
		);
		const reset = await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { headline: null }));
		assert.deepEqual([reset.signupForm.headline, reset.signupForm.subheadline], [null, ""], "null follows the newsletter's name again");
		const tooLong = await as(user, () => m.newsletters.saveSignupForm(user.newsletterId, { headline: "x".repeat(81) }));
		assert.ok(tooLong.error);
	});
});
