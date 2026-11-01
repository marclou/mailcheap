import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { getKeyLevel } from "../lib/api-key-tokens.js";
import { canKeyUse, defineAction, getPathParams } from "../lib/actions/define-action.js";
import { ERRORS, actionError, formatIssues, getErrorStatus, toActionError } from "../lib/actions/errors.js";
import { getCleanupSettings } from "../lib/cleanup.js";
import {
	applySharedAddress,
	getNewsletterProblem,
	mergeNewsletterSettings,
	toNewsletterDocument,
	toNewsletterSettings,
} from "../lib/newsletter-settings.js";

const valid = {
	name: "get_thing",
	title: "Get a thing",
	description: "Gets a thing.",
	group: "Things",
	http: { method: "GET", path: "/things/{id}" },
	input: z.object({ id: z.string() }),
	output: z.object({ id: z.string() }),
	readOnly: true,
	handler: async ({ input }) => input,
};

test("an action needs a name, docs, a route, schemas and a handler", () => {
	const action = defineAction(valid);
	assert.equal(action.permission, "full");
	assert.equal(action.idempotent, true, "read-only actions are safe to repeat");
	assert.equal(action.http.status, 200);
	assert.ok(Object.isFrozen(action));
	const broken = {
		name: "Get-thing",
		description: "",
		http: { method: "PUT", path: "/things" },
		input: z.string(),
		dashboardInput: z.boolean(),
		permission: "admin",
		destructive: true,
		handler: null,
		example: { id: 5 },
	};
	for (const [key, value] of Object.entries(broken)) {
		assert.throws(() => defineAction({ ...valid, [key]: value }), /^Error: Action /, key);
	}
});

test("path parameters and key levels", () => {
	assert.deepEqual(getPathParams("/campaigns/{id}/send"), ["id"]);
	const signups = defineAction({ ...valid, name: "add_thing", permission: "signups", readOnly: false, http: { method: "POST", path: "/things" } });
	assert.equal(canKeyUse("signups", signups), true);
	assert.equal(canKeyUse("signups", defineAction(valid)), false);
	assert.equal(canKeyUse("full", defineAction(valid)), true);
	assert.equal(getKeyLevel({ level: "full" }), "full");
	assert.equal(getKeyLevel({ level: "signups" }), "signups");
	assert.equal(getKeyLevel({}), "signups", "keys from before levels");
	assert.equal(getKeyLevel({ level: "FULL" }), "signups");
});

test("errors keep known codes and hide the rest", () => {
	assert.deepEqual(toActionError(actionError("conflict", "Already sending")), { code: "conflict", message: "Already sending" });
	assert.deepEqual(toActionError(Object.assign(new Error("Over"), { code: "plan_limit_emails" })), { code: "plan_limit_emails", message: "Over" });
	assert.equal(toActionError(Object.assign(new Error("E11000 duplicate key"), { code: 11000 })).code, "internal_error");
	assert.doesNotMatch(toActionError(new Error("connection string mongodb://secret")).message, /mongodb/);
	assert.equal(getErrorStatus("plan_limit_subscribers"), 402);
	assert.equal(getErrorStatus("nonsense"), 500);
	for (const code of ["unauthorized", "forbidden", "not_found", "validation_failed", "conflict", "rate_limited", "plan_limit_emails", "plan_limit_subscribers", "account_blocked"]) {
		assert.ok(ERRORS[code], code);
	}
	const issues = z.object({ subject: z.string().max(2), nested: z.object({ count: z.number() }) }).safeParse({ subject: "long", nested: { count: "1" } }).error.issues;
	assert.match(formatIssues(issues), /^subject: .+; nested\.count: /);
});

test("newsletter changes land on the saved settings, and the shared address follows the slug", () => {
	const saved = toNewsletterSettings({
		name: "Weekly",
		slug: "weekly",
		fromEmail: "weekly@mailcheapmail.com",
		welcome: { enabled: true, subject: "Hi", markdown: "Hello" },
	});
	const merged = mergeNewsletterSettings(saved, { slug: "letters", welcome: { subject: "Welcome" } });
	assert.deepEqual(merged.welcome, { enabled: true, subject: "Welcome", previewText: "", format: "markdown", markdown: "Hello", html: "" });
	assert.equal(applySharedAddress(merged, "mailcheapmail.com").fromEmail, "hello@letters.mailcheapmail.com");
	assert.equal(applySharedAddress({ ...merged, fromEmail: "hello@weekly.mailcheapmail.com" }, "mailcheapmail.com").fromEmail, "hello@letters.mailcheapmail.com");
	assert.equal(applySharedAddress({ ...merged, fromEmail: "hi@own.dev" }, "mailcheapmail.com").fromEmail, "hi@own.dev");
	assert.equal(getNewsletterProblem(applySharedAddress(merged, "mailcheapmail.com")), null);
	assert.equal(getNewsletterProblem({ ...merged, cleanup: { issues: 1 } }), "Ignored issues should be a whole number from 2 to 100");
	assert.equal(getNewsletterProblem({ ...merged, socialLinks: ["http://x.com/me"] }), "http://x.com/me is not an https:// link");
});

test("a slug can't be a subdomain MailCheap uses or keeps", () => {
	const settings = (slug) => applySharedAddress(mergeNewsletterSettings(toNewsletterSettings(null), { name: "Mine", slug }), "mailcheap.ai");
	for (const slug of ["www", "r", "rp", "send", "rsend", "cdn", "api", "app", "mail", "docs", "admin", "status", "blog", "help", "support", "bounce", "mcp"]) {
		assert.equal(getNewsletterProblem(settings(slug)), `${slug} is reserved for MailCheap, pick another slug`, slug);
	}
	for (const slug of ["weekly", "the-hens", "www2", "api-notes", "r2"]) assert.equal(getNewsletterProblem(settings(slug)), null, slug);
});

test("new newsletters start with confirmed opt-in and the built-in confirmation email", () => {
	const created = applySharedAddress(mergeNewsletterSettings(toNewsletterSettings(null), { name: "Fresh", slug: "fresh" }), "mailcheapmail.com");
	assert.equal(created.requireConfirmation, true);
	assert.equal(getNewsletterProblem(created), null, "no confirmation email of its own: the built-in one");
	assert.equal(toNewsletterSettings({ name: "Old", slug: "old" }).requireConfirmation, false, "saved newsletters keep theirs");
	assert.equal(getNewsletterProblem({ ...created, confirmation: { subject: "", previewText: "", markdown: "Click here" } }), "Confirmation email needs a subject");
});

test("new newsletters start with list cleanup on and the default numbers, unless they say false; saved ones keep theirs", () => {
	const create = (changes) => mergeNewsletterSettings(toNewsletterSettings(null), { name: "Fresh", slug: "fresh", ...changes });
	const created = toNewsletterDocument(create({}));
	assert.deepEqual(created.cleanup, { enabled: true });
	assert.deepEqual(getCleanupSettings(created), { enabled: true, issues: 6, days: 180 });
	assert.equal(create({ cleanup: { days: 90 } }).cleanup.enabled, true, "numbers alone leave it on");
	assert.equal(create({ cleanup: { enabled: false } }).cleanup.enabled, false);
	assert.equal(toNewsletterSettings({ name: "Old", slug: "old", cleanup: { enabled: false } }).cleanup.enabled, false);
	assert.equal(toNewsletterSettings({ name: "Old", slug: "old" }).cleanup.enabled, false, "saved without it: still off");
});
