import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { getAlertType } from "../lib/alert-rules.js";
import { formatRelativeShort } from "../lib/format.js";
import {
	NOTIFICATION_KINDS,
	NOTIFICATION_TONES,
	cleanNotificationPath,
	getNotificationTone,
	hasNewNotifications,
	joinSentences,
} from "../lib/notification-rules.js";
import { findAlertCalls, isAdminAlert, kindsOf } from "./helpers/alert-calls.mjs";
import { activate, as, callApi, catchRedirect, form, jsonRequest, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published } from "./stubs/qstash.mjs";

// The dashboard's notifications (lib/notifications.js): each alert emailed to an account's owner, what only the bell
// tells, what opening it marks read, and none of it reaching another account.
const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const CAMPAIGN_ID = "6650f1c2e9b1d4a012345678";

describe("what the bell shows of each kind", () => {
	test("every account alert in the code has its tone in lib/notification-rules.js", async () => {
		const missing = [];
		let count = 0;
		for (const { file, object } of await findAlertCalls()) {
			if (isAdminAlert(object)) continue;
			count++;
			const kinds = kindsOf(object).map((kind) => kind.replace(/-$/, ""));
			if (!kinds.some((kind) => Object.hasOwn(NOTIFICATION_KINDS, kind))) missing.push(`${file}: ${object.slice(0, 120)}`);
		}
		assert.ok(count >= 15, `found ${count} account alerts`);
		assert.deepEqual(missing, []);
		for (const [kind, tone] of Object.entries(NOTIFICATION_KINDS)) assert.ok(NOTIFICATION_TONES.includes(tone), kind);
	});

	test("an alert's key gives its notification's kind, and a kind it doesn't know is only news", () => {
		assert.equal(getAlertType(`campaign-paused-${CAMPAIGN_ID}`), "campaign-paused");
		assert.equal(getAlertType(`domain-dns-${CAMPAIGN_ID}`), "domain-dns");
		assert.equal(getAlertType("embed-flood-plain:weekly"), "embed-flood-plain");
		assert.equal(getAlertType(`signup-email-rejected:${CAMPAIGN_ID}:welcome`), "signup-email-rejected");
		assert.equal(getNotificationTone("campaign-paused"), "urgent");
		assert.equal(getNotificationTone("import-done"), "success");
		assert.equal(getNotificationTone("something-new"), "info");
	});

	test("a notification only links to a page of the dashboard", () => {
		for (const path of [`/campaigns/${CAMPAIGN_ID}`, `/newsletters/${CAMPAIGN_ID}?next=%2Fcontacts`, "/account?chat=open"]) assert.equal(cleanNotificationPath(path), path);
		for (const path of ["https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/a b", "", null, `/${"a".repeat(600)}`]) {
			assert.equal(cleanNotificationPath(path), null, String(path));
		}
	});

	test("the tray says when in a few characters, so a short title stays on one line", () => {
		const now = Date.parse("2026-10-30T12:00:00Z");
		const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
		assert.equal(formatRelativeShort(ago(0.5), now), "now");
		assert.equal(formatRelativeShort(ago(5), now), "5m");
		assert.equal(formatRelativeShort(ago(59), now), "59m");
		assert.equal(formatRelativeShort(ago(60), now), "1h");
		assert.equal(formatRelativeShort(ago(26 * 60), now), "1d");
		assert.equal(formatRelativeShort(ago(6 * 24 * 60 + 23 * 60), now), "6d");
		assert.equal(formatRelativeShort("2026-10-07T12:00:00Z", now), "Oct 7");
		assert.equal(formatRelativeShort("2025-12-20T12:00:00Z", now), "Dec 20, 2025");
		assert.equal(formatRelativeShort(null, now), null);
	});

	test("the bell rings for one more unread, and for an unread one back on top, like an import that started and then ended", () => {
		const started = { id: "a", at: "2026-10-30T12:00:00.000Z", read: false };
		const loaded = { notifications: [started], unread: 1 };
		assert.equal(hasNewNotifications(loaded, loaded), false, "the same page again");
		assert.equal(hasNewNotifications(loaded, { notifications: [{ ...started, at: "2026-10-30T12:01:00.000Z" }], unread: 1 }), true, "same count, newer");
		assert.equal(hasNewNotifications(loaded, { notifications: [{ ...started, at: "2026-10-30T12:01:00.000Z", read: true }], unread: 0 }), false, "read elsewhere");
		assert.equal(hasNewNotifications({ notifications: [], unread: 0 }, loaded), true);
		assert.equal(hasNewNotifications(loaded, { notifications: [{ id: "b", at: "2026-10-30T11:00:00.000Z", read: false }, started], unread: 2 }), true, "one more");
	});

	test("an alert's lines read as one text, and one starting with an address or a domain keeps it", () => {
		assert.equal(joinSentences(["this month's emails are used up", "Upgrade to send the rest."]), "This month's emails are used up. Upgrade to send the rest.");
		assert.equal(joinSentences(["reader@example.org marked an email as spam. Contacts are suppressed.", ""]), "reader@example.org marked an email as spam. Contacts are suppressed.");
		assert.equal(joinSentences(["example.com has no DKIM record", null]), "example.com has no DKIM record.");
		assert.equal(joinSentences(["3% of emails bounced"]), "3% of emails bounced.");
	});
});

describe("an account's notifications", () => {
	let app;
	let m;
	let processed = 0;

	before(async () => {
		app = await startTestApp({ CRON_SECRET, QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
		m = {
			alerts: await import("../lib/alerts.js"),
			blocks: await import("../lib/account-blocks.js"),
			lib: await import("../lib/notifications.js"),
			jobs: await import("../lib/import-jobs.js"),
			registry: await import("../lib/actions/registry.js"),
			notifications: await import("../app/(app)/(notifications)/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			cronRoute: await import("../app/api/cron/hourly/route.js"),
			sendBatchRoute: await import("../app/api/jobs/send-batch/route.js"),
			Alert: (await import("../models/Alert.js")).default,
			ContactImport: (await import("../models/ContactImport.js")).default,
			Notification: (await import("../models/Notification.js")).default,
		};
		// The one notification per key is a unique index, which a new database builds in the background.
		await Promise.all([m.Alert.init(), m.Notification.init()]);
	});

	after(() => app?.stop());

	async function customer(email, { hasPlan = true } = {}) {
		const user = await signIn(email);
		if (hasPlan) await activate(user);
		user.slug = email.split("@")[0];
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" }))));
		user.newsletterId = url.split("/").at(-1);
		return user;
	}

	const listFor = (user) => as(user, () => m.notifications.getNotifications());
	const createKey = async (user) => (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	const rowsOf = (count, prefix = "reader") => Array.from({ length: count }, (_, index) => ({ email: `${prefix}${index}@example.org`, status: "active" }));
	const importJob = () => published.findLast(({ url }) => url.endsWith("/api/jobs/import-contacts"));

	async function runSendJobs() {
		while (processed < published.length) {
			const { url, body } = published[processed++];
			if (url.endsWith("/api/jobs/send-batch")) await m.sendBatchRoute.POST(jsonRequest(url, { method: "POST", body }));
		}
	}

	test("an alert emailed to an account's owner shows in its notifications; the admins' never do", async () => {
		const user = await customer("bell-alerts@example.com");
		await m.alerts.sendAlert({
			accountId: user.accountId,
			key: "complaints",
			title: "Spam complaint",
			detail: "reader@example.org marked an email as spam. Contacts are suppressed.",
			path: `/campaigns/${CAMPAIGN_ID}`,
		});
		await m.alerts.sendAlert({ accountId: null, key: `tenant-failed:${user.accountId}`, title: "Tenant not created", detail: "Throttled." });

		const { notifications, unread } = await listFor(user);
		assert.equal(unread, 1);
		assert.deepEqual(
			notifications.map(({ kind, tone, title, body, path, read }) => ({ kind, tone, title, body, path, read })),
			[
				{
					kind: "complaints",
					tone: "warning",
					title: "Spam complaint",
					body: "reader@example.org marked an email as spam. Contacts are suppressed.",
					path: `/campaigns/${CAMPAIGN_ID}`,
					read: false,
				},
			]
		);
		assert.equal(await m.Notification.countDocuments({ key: `tenant-failed:${user.accountId}` }).setOptions({ crossAccount: true }), 0);
	});

	test("within its cooldown an alert adds nothing; after it, the same notification comes back on top, unread", async () => {
		const user = await customer("bell-again@example.com");
		const alert = { accountId: user.accountId, key: "rates-warning", title: "Bounces or complaints are high", detail: "3% of emails bounced", path: "/", cooldownMinutes: 60 };
		await m.alerts.sendAlert(alert);
		const [first] = (await listFor(user)).notifications;
		assert.deepEqual(await as(user, () => m.notifications.markNotificationsRead([first.id])), { marked: 1, unread: 0 });

		await m.alerts.sendAlert({ ...alert, detail: "4% of emails bounced" });
		let listed = await listFor(user);
		assert.equal(listed.unread, 0, "no email, and nothing new");
		assert.equal(listed.notifications[0].body, "3% of emails bounced.");

		await m.Alert.updateOne({ accountId: user.accountId, key: alert.key }, { $set: { lastSentAt: new Date(Date.now() - 2 * 3_600_000) } });
		await m.alerts.sendAlert({ ...alert, detail: "4% of emails bounced" });
		listed = await listFor(user);
		assert.equal(listed.unread, 1);
		assert.deepEqual(
			listed.notifications.map(({ id, body, read }) => ({ id, body, read })),
			[{ id: first.id, body: "4% of emails bounced.", read: false }],
			"the same notification, saying what it says now"
		);
		assert.ok(listed.notifications[0].at > first.at);
	});

	test("an account's notifications are its own: another account can neither list them nor mark them read", async () => {
		const owner = await customer("bell-owner@example.com");
		const other = await customer("bell-other@example.com");
		await m.alerts.sendAlert({
			accountId: owner.accountId,
			key: `domain-dns-${CAMPAIGN_ID}`,
			title: "Sending from news.example.com stopped",
			detail: "Its DKIM record is gone.",
			path: "/domains",
			domain: "news.example.com",
		});
		const [notification] = (await listFor(owner)).notifications;
		assert.equal(notification.domain, "news.example.com", "its favicon shows in the tray");
		assert.equal(notification.tone, "urgent");

		assert.deepEqual((await listFor(other)).notifications, []);
		assert.deepEqual(await as(other, () => m.notifications.markNotificationsRead([notification.id])), { marked: 0, unread: 0 });
		const viaApi = await callApi("POST", "/api/v1/notifications/read", { key: await createKey(other), body: { ids: [notification.id] } });
		assert.equal(viaApi.status, 200, JSON.stringify(viaApi.body));
		assert.equal(viaApi.body.marked, 0);
		assert.equal((await listFor(owner)).unread, 1, "still unread for its owner");
	});

	test("the API lists them newest first, 20 a page, each with its page's full address, and marks them read", async () => {
		const user = await customer("bell-api@example.com");
		const start = Date.now() - 60_000;
		for (let index = 0; index < 22; index++) {
			await m.lib.notify({ accountId: user.accountId, key: `sent:${index}`, kind: "campaign-sent", title: `Campaign ${index} sent`, path: `/campaigns/${CAMPAIGN_ID}`, at: new Date(start + index * 1000) });
		}
		const key = await createKey(user);
		const output = m.registry.getAction("list_notifications").output;

		const first = await callApi("GET", "/api/v1/notifications", { key });
		assert.equal(first.status, 200, JSON.stringify(first.body));
		assert.ok(output.safeParse(first.body).success, "answers in its schema");
		assert.equal(first.body.unread, 22);
		assert.equal(first.body.notifications.length, 20);
		assert.equal(first.body.notifications[0].title, "Campaign 21 sent");
		assert.equal(first.body.notifications[0].url, `http://localhost:3000/campaigns/${CAMPAIGN_ID}`);
		const second = await callApi("GET", `/api/v1/notifications?cursor=${encodeURIComponent(first.body.nextCursor)}`, { key });
		assert.deepEqual(second.body.notifications.map(({ title }) => title), ["Campaign 1 sent", "Campaign 0 sent"]);
		assert.equal(second.body.nextCursor, null);
		assert.equal((await callApi("GET", "/api/v1/notifications?limit=5", { key })).body.notifications.length, 5);
		assert.equal((await callApi("GET", "/api/v1/notifications?cursor=nope", { key })).status, 400);

		const shown = first.body.notifications.slice(0, 2).map(({ id }) => id);
		assert.deepEqual(await as(user, () => m.notifications.markNotificationsRead(shown)), { marked: 2, unread: 20 }, "the tray marks only what it showed");
		const rest = await callApi("POST", "/api/v1/notifications/read", { key, body: {} });
		assert.deepEqual(rest.body, { marked: 20, unread: 0 });
		assert.ok((await callApi("GET", "/api/v1/notifications?limit=50", { key })).body.notifications.every(({ read }) => read));
	});

	test("a blocked account still lists its notifications, marks them read and clears them, and so does one without a plan", async () => {
		const user = await customer("bell-blocked@example.com");
		await m.blocks.blockAccount(user.accountId, { reason: "Too many bounces", by: "rates" });
		const [blocked] = (await listFor(user)).notifications;
		assert.deepEqual([blocked.kind, blocked.tone, blocked.title], ["account-blocked", "urgent", "Account blocked"]);
		assert.match(blocked.body, /^Too many bounces\. Nothing is sent from this account/);
		assert.deepEqual(await as(user, () => m.notifications.markNotificationsRead([blocked.id])), { marked: 1, unread: 0 });
		assert.deepEqual(await as(user, () => m.notifications.clearNotifications(blocked.at)), { cleared: 1, unread: 0 });

		const trial = await customer("bell-trial@example.com", { hasPlan: false });
		await m.lib.notify({ accountId: trial.accountId, key: "welcome", kind: "import-done", title: "Imported 3 new contacts" });
		const listed = await listFor(trial);
		assert.equal(listed.unread, 1);
		assert.deepEqual(await as(trial, () => m.notifications.markNotificationsRead([listed.notifications[0].id])), { marked: 1, unread: 0 });
		assert.deepEqual(await as(trial, () => m.notifications.clearNotifications(listed.notifications[0].at)), { cleared: 1, unread: 0 });
		assert.deepEqual((await listFor(trial)).notifications, []);
	});

	test("Clear all takes what the tray showed and everything older off the list; what came since stays, and one comes back if it happens again", async () => {
		const user = await customer("bell-clear@example.com");
		const other = await customer("bell-clear-other@example.com");
		const start = Date.now() - 60_000;
		for (const [index, key] of ["older", "shown", "since"].entries()) {
			await m.lib.notify({ accountId: user.accountId, key, kind: "campaign-sent", title: `Campaign ${key}`, at: new Date(start + index * 1000) });
		}
		await m.lib.notify({ accountId: other.accountId, key: "theirs", kind: "campaign-sent", title: "Their campaign" });
		const shown = (await listFor(user)).notifications.find(({ title }) => title === "Campaign shown");

		assert.deepEqual(await as(user, () => m.notifications.clearNotifications(shown.at)), { cleared: 2, unread: 1 });
		assert.deepEqual((await listFor(user)).notifications.map(({ title }) => title), ["Campaign since"]);
		assert.deepEqual(await as(user, () => m.notifications.clearNotifications(shown.at)), { cleared: 0, unread: 1 }, "twice is the same");

		await m.lib.notify({ accountId: user.accountId, key: "older", kind: "campaign-sent", title: "Campaign older, again" });
		const again = await listFor(user);
		assert.equal(again.unread, 2);
		assert.deepEqual(
			again.notifications.map(({ title, read }) => ({ title, read })),
			[
				{ title: "Campaign older, again", read: false },
				{ title: "Campaign since", read: false },
			],
			"the same thing again brings it back, new"
		);

		const key = await createKey(user);
		const theirs = (await listFor(other)).notifications[0];
		const refused = await callApi("POST", "/api/v1/notifications/clear", { key, body: { ids: [theirs.id] } });
		assert.equal(refused.status, 200, JSON.stringify(refused.body));
		assert.deepEqual(refused.body, { cleared: 0, unread: 2 }, "another account's ids clear nothing");
		assert.equal((await callApi("POST", "/api/v1/notifications/clear", { key, body: { until: "last week" } })).status, 400);
		assert.deepEqual((await callApi("POST", "/api/v1/notifications/read", { key, body: {} })).body, { marked: 2, unread: 0 }, "cleared ones aren't counted");
		assert.deepEqual((await callApi("POST", "/api/v1/notifications/clear", { key, body: {} })).body, { cleared: 2, unread: 0 });
		assert.deepEqual((await callApi("GET", "/api/v1/notifications", { key })).body.notifications, []);
		assert.deepEqual((await listFor(other)).notifications.map(({ title }) => title), ["Their campaign"]);
	});

	test("a link that leads off the dashboard isn't kept", async () => {
		const user = await customer("bell-paths@example.com");
		await m.lib.notify({ accountId: user.accountId, key: "away", kind: "complaints", title: "Away", path: "//evil.example/phish" });
		await m.lib.notify({ accountId: user.accountId, key: "script", kind: "complaints", title: "Script", path: "javascript:alert(1)" });
		assert.deepEqual((await listFor(user)).notifications.map(({ path }) => path), [null, null]);
	});

	test("an import says it started, then how it went in the same notification, back on top and unread; a small one at once", async () => {
		const user = await customer("bell-import@example.com");
		const path = `/newsletters/${user.newsletterId}?next=%2Fcontacts`;
		const started = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: rowsOf(250), total: 250, fileName: "readers.csv" }));
		assert.equal(started.status, "processing");
		const running = await listFor(user);
		assert.deepEqual(
			running.notifications.map(({ kind, tone, title, body, path }) => ({ kind, tone, title, body, path })),
			[{ kind: "import-started", tone: "info", title: "Importing readers.csv", body: "250 rows into bell-import news", path }],
			"as soon as it starts"
		);
		const [notification] = running.notifications;
		await as(user, () => m.notifications.markNotificationsRead([notification.id]));
		await m.jobs.runImport(importJob().body);
		await m.jobs.runImport(importJob().body);

		const done = await listFor(user);
		assert.equal(done.unread, 1, "its end is new again");
		assert.deepEqual(
			done.notifications.map(({ id, kind, tone, title, body, path }) => ({ id, kind, tone, title, body, path })),
			[{ id: notification.id, kind: "import-done", tone: "success", title: "Imported 250 new contacts", body: "readers.csv into bell-import news", path }],
			"once, however many times its job is delivered"
		);
		assert.ok(done.notifications[0].at > notification.at, "back on top");

		const small = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: rowsOf(3, "small"), total: 3 }));
		assert.equal(small.status, "done");
		const listed = await listFor(user);
		assert.equal(listed.unread, 2);
		assert.deepEqual(
			listed.notifications.map(({ kind, title, body }) => ({ kind, title, body })),
			[
				{ kind: "import-done", title: "Imported 3 new contacts", body: "Into bell-import news" },
				{ kind: "import-done", title: "Imported 250 new contacts", body: "readers.csv into bell-import news" },
			]
		);
	});

	test("an upload that stopped halfway is ended by the hourly run, and its owner hears it", async () => {
		const user = await customer("bell-stalled@example.com");
		const started = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: rowsOf(250), total: 1000, fileName: "big.csv" }));
		await m.jobs.runImport(importJob().body);
		// The browser closed: nothing new for over half an hour.
		await m.ContactImport.collection.updateOne({ _id: new mongoose.Types.ObjectId(started.importId) }, { $set: { updatedAt: new Date(Date.now() - 31 * 60_000) } });

		const response = await m.cronRoute.GET(new Request("http://localhost:3000/api/cron/hourly", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
		assert.equal(response.status, 200);
		assert.ok((await response.json()).imports.failed >= 1);
		assert.equal((await m.ContactImport.findOne({ accountId: user.accountId, _id: started.importId }).lean()).status, "failed");
		const [notification] = (await listFor(user)).notifications;
		assert.deepEqual(
			{ kind: notification.kind, tone: notification.tone, title: notification.title, body: notification.body },
			{
				kind: "import-stopped",
				tone: "warning",
				title: "Import of big.csv stopped",
				body: "The upload stopped before the end of the file. 250 added before it stopped. Import the file again for the rest: the contacts already in stay as they are.",
			}
		);
	});

	test("a campaign that went out to everyone says so, with a link to its report", async () => {
		const user = await customer("bell-sent@example.com");
		const key = await createKey(user);
		const imported = await callApi("POST", "/api/v1/contacts/import", { key, body: { consent: true, contacts: rowsOf(2) } });
		assert.equal(imported.status, 200, JSON.stringify(imported.body));
		const draft = await callApi("POST", "/api/v1/campaigns", { key, body: { subject: "October notes", content: "Hello." } });
		processed = published.length;
		const queued = await callApi("POST", `/api/v1/campaigns/${draft.body.id}/send`, { key });
		assert.equal(queued.status, 200, JSON.stringify(queued.body));
		await flushAfter();
		await runSendJobs();

		const [notification] = (await listFor(user)).notifications;
		assert.deepEqual(
			{ kind: notification.kind, tone: notification.tone, title: notification.title, body: notification.body, path: notification.path },
			{ kind: "campaign-sent", tone: "success", title: "Campaign sent", body: "“October notes” went out to 2 contacts.", path: `/campaigns/${draft.body.id}` }
		);
	});
});
