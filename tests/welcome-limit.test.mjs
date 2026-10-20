import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createConfirmToken } from "../lib/confirmation.js";
import { formatDate } from "../lib/format.js";
import { activate, anonymous, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { runWithRequest } from "./stubs/next-headers.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// Welcome emails take room in the plan's month like campaign emails, whichever way a subscriber comes in: the
// confirm link, the archive's form, Add contact, the REST API and MCP. Confirmation emails always go out. Signup
// emails go out from the work after each response, which flushAfter() waits for.
const DAY_MS = 86_400_000;
const PAUSED_REASON = "This month's emails are used up";
let app;
let m;
let admin;
let nextId = 0;
let visitor = 0;

const isWelcomeNotice = ({ subject }) => subject.startsWith("[MailCheap] Welcome emails paused");

async function callTool(key, name, args = {}) {
	const request = new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method: "tools/call", params: { name, arguments: args } }),
	});
	const text = await (await anonymous(() => m.mcpRoute.POST(request))).text();
	return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).result;
}

// A paying account with room for `emails` emails a month.
async function customer(email, { emails, ...set } = {}) {
	const user = await signIn(email);
	await activate(user, { ...set, ...(emails !== undefined && { limitOverrides: { emailsPerMonth: emails } }) });
	return user;
}

// A newsletter on the shared address whose new subscribers get the welcome email, or the confirmation email instead.
async function addNewsletter(user, { requireConfirmation = false } = {}) {
	user.slug = user.email.split("@")[0].replace(/[^a-z0-9]/g, "-");
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({
					name: `${user.slug} news`,
					slug: user.slug,
					fromEmail: `hello@${user.slug}.mailcheapmail.com`,
					postalAddress: "1 Main St, Paris",
					archiveEnabled: "on",
					welcomeSubject: "Welcome aboard",
					welcomeMarkdown: "Thanks for joining.",
					...(requireConfirmation ? { requireConfirmation: "on" } : { welcomeEnabled: "on" }),
				})
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

function fromNewVisitor(run) {
	return runWithRequest({ headers: { "x-forwarded-for": `192.0.2.${++visitor}` } }, run);
}

const SIGNUPS = {
	"REST API": async (user, email) => {
		const response = await callApi("POST", "/api/v1/contacts", { key: user.key, body: { newsletter: user.slug, email } });
		assert.equal(response.status, 201, JSON.stringify(response.body));
	},
	MCP: async (user, email) => {
		const result = await callTool(user.key, "add_contact", { newsletter: user.slug, email });
		assert.equal(result.structuredContent?.created, true, JSON.stringify(result));
	},
	"Add contact": async (user, email) => {
		const added = await as(user, () => m.contacts.addContact(null, form({ newsletterId: user.newsletterId, email, consent: "on" })));
		assert.deepEqual(added, { email, status: "active" });
	},
	"archive form": async (user, email) => {
		assert.deepEqual(await fromNewVisitor(() => m.archive.subscribe(null, form({ newsletter: user.slug, email }))), { ok: true });
	},
	// Signed up while the newsletter asked to confirm; it no longer does, so confirming brings the welcome email.
	"confirm link": async (user, email) => {
		const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "pending" });
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
	},
};

// The welcome email's message for the new subscriber, once the signup's work is done.
async function signUp(path, user, email) {
	await SIGNUPS[path](user, email);
	await flushAfter();
	return m.Message.findOne({ accountId: user.accountId, kind: "welcome", email }).lean();
}

function setUsage(user, emailsSent) {
	return m.Account.updateOne({ _id: user.accountId }, { $set: { "usage.emailsSent": emailsSent } });
}

async function usage(user) {
	return (await m.Account.findById(user.accountId).lean()).usage;
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../app/archive/actions.js"),
		confirm: await import("../app/confirm/actions.js"),
		admin: await import("../app/admin/actions.js"),
		mcpRoute: await import("../app/mcp/route.js"),
		billing: await import("../lib/billing.js"),
		state: await import("../lib/account-state.js"),
		usage: await import("../lib/usage.js"),
		usagePeriod: await import("../lib/usage-period.js"),
		Account: (await import("../models/Account.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		siteExtensions: (await import("@/lib/site-extensions")).siteExtensions,
	};
	admin = await signIn("admin@example.com");
});

after(() => app?.stop());

describe("when welcome emails pause", () => {
	test("once the month's emails are used up on an active plan, until the month is over; never on a self-hosted server", async () => {
		const { areWelcomeEmailsPaused, getWelcomePauseNotice } = m.state;
		const { addMonths, startUsagePeriod } = m.usagePeriod;
		const start = new Date("2026-10-03T00:00:00Z");
		const now = new Date("2026-10-15T12:00:00Z");
		const account = { plan: "starter", subscriptionStatus: "active", usage: { ...startUsagePeriod({ start, end: addMonths(start, 12) }), emailsSent: 20_000 } };
		assert.equal(areWelcomeEmailsPaused(account, now), true, "Starter's 20,000 are used up");
		assert.equal(areWelcomeEmailsPaused({ ...account, usage: { ...account.usage, emailsSent: 19_999 } }, now), false);
		assert.equal(areWelcomeEmailsPaused({ ...account, limitOverrides: { emailsPerMonth: 30_000 } }, now), false, "an admin's numbers win");
		assert.equal(areWelcomeEmailsPaused(account, addMonths(start, 1)), false, "the next month starts over before it's stored");
		assert.equal(areWelcomeEmailsPaused({ ...account, subscriptionStatus: "canceled" }, now), false, "without a plan nothing sends anyway");
		assert.equal(await withEnv({ MAILCHEAP_CLOUD: "" }, () => areWelcomeEmailsPaused(account, now)), false);

		assert.deepEqual(getWelcomePauseNotice({ emailsLimit: 20_000, periodEnd: new Date("2026-11-03T12:00:00Z") }), {
			title: "Welcome emails paused: you've used this month's 20,000 emails",
			detail: "They resume when your emails reset on Nov 3, 2026, or as soon as you upgrade. Subscribers who join before then won't get one later.",
		});
	});
});

describe("every way in", () => {
	test("sends the welcome email while the month has room, then skips it: recorded, counted once, never past the limit", async () => {
		const paths = Object.keys(SIGNUPS);
		const user = await addNewsletter(await customer("every-way@example.com", { emails: paths.length }));
		const address = (prefix, path) => `${prefix}-${path.toLowerCase().replaceAll(" ", "-")}@example.org`;

		for (const path of paths) {
			const before = sesEmails.length;
			const welcome = await signUp(path, user, address("early", path));
			assert.equal(welcome?.status, "sent", path);
			assert.deepEqual(sesEmails.slice(before).map(({ to, subject }) => [to, subject]), [[address("early", path), "Welcome aboard"]], path);
		}
		assert.equal((await usage(user)).emailsSent, paths.length);

		const emailsBefore = platformEmails.length;
		for (const path of paths) {
			const before = sesEmails.length;
			const welcome = await signUp(path, user, address("late", path));
			assert.deepEqual([welcome?.status, welcome?.error], ["skipped", PAUSED_REASON], path);
			assert.equal(sesEmails.length, before, `${path}: nothing reached the provider`);
		}
		assert.equal((await usage(user)).emailsSent, paths.length, "never past the limit");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, status: "active" }), paths.length * 2, "every signup joined");
		assert.equal(platformEmails.slice(emailsBefore).filter(isWelcomeNotice).length, 1);
	});

	test("confirmation emails go out past the limit and still count; skipped welcome emails never hold them up", async () => {
		const user = await addNewsletter(await customer("confirming@example.com", { emails: 1 }), { requireConfirmation: true });
		await setUsage(user, 1);
		// More skipped welcome emails in the last minutes than the cap of 100 signup emails per newsletter every 10 minutes.
		await m.Message.insertMany(
			Array.from({ length: 100 }, (_, index) => ({
				kind: "welcome",
				accountId: user.accountId,
				newsletterId: user.newsletterId,
				email: `skipped${index}@example.org`,
				status: "skipped",
				error: PAUSED_REASON,
			}))
		);

		const before = sesEmails.length;
		const added = await callApi("POST", "/api/v1/contacts", { key: user.key, body: { newsletter: user.slug, email: "pending-api@example.org" } });
		assert.deepEqual([added.status, added.body.status], [201, "pending"]);
		const fromForm = await fromNewVisitor(() => m.archive.subscribe(null, form({ newsletter: user.slug, email: "pending-form@example.org" })));
		assert.equal(fromForm.pending, true);
		await flushAfter();
		const subject = `Confirm your subscription to ${user.slug} news`;
		assert.deepEqual(
			sesEmails
				.slice(before)
				.map(({ to, subject }) => [to, subject])
				.sort(),
			[
				["pending-api@example.org", subject],
				["pending-form@example.org", subject],
			]
		);
		assert.equal((await usage(user)).emailsSent, 3, "over the limit, and counted");

		const pending = await m.Contact.findOne({ accountId: user.accountId, email: "pending-api@example.org" }).lean();
		const token = createConfirmToken({ contactId: pending._id, newsletterId: user.newsletterId });
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
		await flushAfter();
		assert.equal(await m.Message.exists({ accountId: user.accountId, kind: "welcome", email: "pending-api@example.org" }), null, "the confirmation was their one email");
	});
});

describe("the owner", () => {
	test("hears once a month: the plan's emails, the reset date and the billing page", async () => {
		const user = await addNewsletter(await customer("notice@example.com", { emails: 2 }));
		await setUsage(user, 2);
		const emailsBefore = platformEmails.length;
		for (const index of [1, 2, 3]) assert.equal((await signUp("REST API", user, `skipped${index}@example.org`)).status, "skipped");

		const notices = platformEmails.slice(emailsBefore).filter(isWelcomeNotice);
		assert.equal(notices.length, 1, "three skipped, one email");
		const [notice] = notices;
		const current = await usage(user);
		assert.deepEqual(notice.to, ["notice@example.com"]);
		assert.equal(notice.subject, "[MailCheap] Welcome emails paused: you've used this month's 2 emails");
		const { supportChatPath } = m.siteExtensions;
		assert.equal(
			notice.text,
			[
				"Welcome emails paused: you've used this month's 2 emails",
				`They resume when your emails reset on ${formatDate(current.periodEnd)}, or as soon as you upgrade. Subscribers who join before then won't get one later. Confirmation emails still go out.`,
				"http://localhost:3000/billing",
				...(supportChatPath ? ["", `Questions? Chat with us: http://localhost:3000${supportChatPath}`] : []),
			].join("\n")
		);
		assert.ok(current.welcomePausedAt);
	});

	test("a new month lets welcome emails go again, and its first skipped one tells the owner again", async () => {
		const user = await addNewsletter(await customer("next-month@example.com", { emails: 1, interval: "year" }));
		await setUsage(user, 1);
		const emailsBefore = platformEmails.length;
		assert.equal((await signUp("REST API", user, "this-month@example.org")).status, "skipped");

		// The year was paid 45 days ago: its first month is over, and the account hasn't sent since.
		const { addMonths, startUsagePeriod } = m.usagePeriod;
		const start = new Date(Date.now() - 45 * DAY_MS);
		const { welcomePausedAt } = await usage(user);
		await m.Account.updateOne(
			{ _id: user.accountId },
			{ $set: { usage: { ...startUsagePeriod({ start, end: addMonths(start, 12) }), emailsSent: 1, welcomePausedAt } } }
		);
		assert.equal((await signUp("REST API", user, "next-month@example.org")).status, "sent");
		const current = await usage(user);
		assert.equal(current.emailsSent, 1, "the new month's first email");
		assert.ok(current.periodStart > start);
		assert.equal(current.welcomePausedAt, undefined);

		assert.equal((await signUp("REST API", user, "next-month-late@example.org")).status, "skipped");
		assert.equal(platformEmails.slice(emailsBefore).filter(isWelcomeNotice).length, 2, "one each month");
	});

	test("a monthly plan's renewal lets welcome emails go again", async () => {
		const user = await addNewsletter(await customer("renewal@example.com", { emails: 1 }));
		// The paid month just ended with its emails used up, and Stripe's renewal hasn't arrived yet.
		const { addMonths, startUsagePeriod } = m.usagePeriod;
		const end = new Date(Date.now() - 60_000);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { usage: { ...startUsagePeriod({ start: addMonths(end, -1), end }), emailsSent: 1 } } });
		assert.equal((await signUp("REST API", user, "before-renewal@example.org")).status, "skipped");

		const seconds = (date) => Math.floor(date.getTime() / 1000);
		const invoice = {
			id: "in_renewal",
			object: "invoice",
			customer: `cus_${user.accountId}`,
			parent: { type: "subscription_details", subscription_details: { subscription: `sub_${user.accountId}`, metadata: { accountId: String(user.accountId) } } },
			lines: { object: "list", data: [{ id: "il_renewal", object: "line_item", period: { start: seconds(end), end: seconds(addMonths(end, 1)) } }] },
		};
		assert.deepEqual(await m.billing.handleStripeEvent({ type: "invoice.paid", data: { object: invoice } }), { reset: true });
		const current = await usage(user);
		assert.deepEqual([current.emailsSent, current.welcomePausedAt], [0, undefined]);
		assert.equal((await signUp("REST API", user, "after-renewal@example.org")).status, "sent");
	});

	test("an upgrade lets the next welcome emails go at once, never the skipped ones, and the month's email isn't sent twice", async () => {
		const user = await addNewsletter(await customer("upgrade@example.com", { emails: 1 }));
		await setUsage(user, 1);
		const emailsBefore = platformEmails.length;
		const skipped = await signUp("REST API", user, "while-paused@example.org");
		assert.equal(skipped.status, "skipped");

		// A bigger plan mid-month keeps the month's count (lib/billing.js applySubscription).
		await m.Account.updateOne({ _id: user.accountId }, { $set: { plan: "growth" }, $unset: { limitOverrides: 1 } });
		assert.equal((await signUp("REST API", user, "after-upgrade@example.org")).status, "sent");
		assert.equal((await m.Message.findOne({ accountId: user.accountId, _id: skipped._id }).lean()).status, "skipped", "not sent later");
		assert.equal(sesEmails.some(({ to }) => to === "while-paused@example.org"), false);
		assert.equal((await usage(user)).emailsSent, 2);

		await setUsage(user, 75_000);
		assert.equal((await signUp("REST API", user, "growth-used-up@example.org")).status, "skipped", "Growth's 75,000 used up too");
		assert.equal(platformEmails.slice(emailsBefore).filter(isWelcomeNotice).length, 1, "one email a month");
	});
});

describe("whose limits", () => {
	test("a free plan from an admin gives its plan's emails", async () => {
		const user = await signIn("free-welcome@example.com");
		assert.equal((await as(admin, () => m.admin.giveFreePlan(null, form({ accountId: String(user.accountId), plan: "starter" })))).ok, true);
		await addNewsletter(user);
		await setUsage(user, 19_999);
		assert.equal((await signUp("REST API", user, "last-room@example.org")).status, "sent");
		assert.equal((await signUp("REST API", user, "no-room@example.org")).status, "skipped");
		assert.equal((await usage(user)).emailsSent, 20_000);
	});

	test("an admin's override wins over the plan, below it or above it", async () => {
		const saveLimits = (user, emailsPerMonth) =>
			as(admin, () => m.admin.saveLimits(null, form({ accountId: String(user.accountId), emailsPerMonth, subscribers: "" })));

		const held = await addNewsletter(await customer("override-low@example.com", { plan: "growth" }));
		assert.equal((await saveLimits(held, "3")).ok, true);
		await setUsage(held, 3);
		assert.equal((await signUp("Add contact", held, "held@example.org")).status, "skipped", "Growth's 75,000 held to 3");

		const raised = await addNewsletter(await customer("override-high@example.com", { plan: "starter" }));
		assert.equal((await saveLimits(raised, "30000")).ok, true);
		await setUsage(raised, 25_000);
		assert.equal((await signUp("Add contact", raised, "raised@example.org")).status, "sent", "Starter's 20,000 raised to 30,000");
	});
});

describe("what the API, MCP and dashboard say", () => {
	test("get_billing, get_overview and the newsletter's welcome email say it's paused until there's room again", async () => {
		const user = await addNewsletter(await customer("paused-api@example.com", { emails: 2 }));
		async function read() {
			const billing = await callApi("GET", "/api/v1/billing", { key: user.key });
			const overview = await callApi("GET", "/api/v1/overview", { key: user.key });
			const newsletter = await callApi("GET", `/api/v1/newsletters/${user.slug}`, { key: user.key });
			const listed = await callTool(user.key, "list_newsletters");
			const tool = await callTool(user.key, "get_billing");
			return [
				billing.body.usage.welcomeEmailsPaused,
				overview.body.usage.welcomeEmailsPaused,
				newsletter.body.welcome.paused,
				listed.structuredContent.newsletters[0].welcome.paused,
				tool.structuredContent.usage.welcomeEmailsPaused,
			];
		}
		assert.deepEqual(await read(), [false, false, false, false, false]);
		await setUsage(user, 2);
		assert.deepEqual(await read(), [true, true, true, true, true]);
		await m.Account.updateOne({ _id: user.accountId }, { $set: { "limitOverrides.emailsPerMonth": 3 } });
		assert.deepEqual(await read(), [false, false, false, false, false], "room again after an upgrade");
	});

	test("the dashboard's notices show while welcome emails are paused and a newsletter sends one", async () => {
		const user = await addNewsletter(await customer("paused-dashboard@example.com", { emails: 1 }));
		const readUsage = async () => m.usage.getUsage(await m.Account.findById(user.accountId).lean());
		assert.equal((await readUsage()).welcomeEmailsPaused, false);
		await setUsage(user, 1);
		const paused = await readUsage();
		assert.deepEqual([paused.welcomeEmailsPaused, paused.emailsLimit], [true, 1]);
		assert.equal(await m.usage.hasWelcomeEmailsOn(user.accountId), true);

		const confirming = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, {
			key: user.key,
			body: { requireConfirmation: true, welcome: { enabled: false } },
		});
		assert.equal(confirming.status, 200);
		assert.equal(await m.usage.hasWelcomeEmailsOn(user.accountId), false, "the confirmation email replaces it");
	});
});
