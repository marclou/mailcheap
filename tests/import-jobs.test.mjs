import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	assignColumnTarget,
	describeColumnTarget,
	normalizeImportRow,
	planColumns,
	readColumnPlan,
	sampleValues,
	splitImportChunks,
} from "../lib/csv-import.js";
import { getStalledAction, isLastChunk, runImport } from "../lib/import-jobs.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

const accountId = "64f1a2b3c4d5e6f7a8b9c0d1";
const importId = "74f1a2b3c4d5e6f7a8b9c0d2";

// An import and its chunks kept in memory, with the same rules as the database: a run claims the next chunk only.
function fakeImport({ chunks = [], total } = {}) {
	const state = {
		job: { _id: importId, accountId, newsletterId: "84f1a2b3c4d5e6f7a8b9c0d3", status: "processing", total, chunks: chunks.length, nextChunk: 0, rows: 0, created: 0, attempts: 0 },
		chunks: new Map(chunks.map((rows, index) => [index, { rows }])),
		processed: [],
		queued: [],
		fail: 0,
	};
	const deps = {
		claim: async ({ index }, now) => {
			const { job } = state;
			if (job.status !== "processing" || job.nextChunk !== index || job.lockedUntil > now) return null;
			job.lockedUntil = now + 60_000;
			return { ...job };
		},
		loadChunk: async ({ index }) => state.chunks.get(index) ?? null,
		loadAccount: async () => ({ _id: accountId, contactFields: [] }),
		process: async ({ rows }) => {
			if (state.fail > 0) {
				state.fail--;
				throw new Error("database down");
			}
			state.processed.push(rows.length);
			return { rows: rows.length, created: rows.length, existing: 0, dropped: { invalid: 0 } };
		},
		commit: async ({ index }, update, { last }) => {
			const { job } = state;
			if (job.nextChunk !== index) return { done: false };
			for (const [key, value] of Object.entries(update.$inc)) job[key] = (job[key] ?? 0) + value;
			Object.assign(job, update.$set, { lockedUntil: 0 });
			const done = last && job.chunks === index + 1;
			if (done) job.status = "done";
			return { done };
		},
		release: async ({ index }, set = {}) => {
			if (state.job.nextChunk === index) Object.assign(state.job, set, { lockedUntil: 0 });
		},
		clearChunk: async ({ index }) => state.chunks.set(index, { rows: undefined }),
		hasChunk: async ({ index }) => state.chunks.has(index),
		queue: async ({ index }) => state.queued.push(index),
	};
	return { state, deps, add: (rows) => state.chunks.set(state.job.chunks++, { rows }) };
}

const rowsOf = (count) => Array.from({ length: count }, (_, index) => ({ email: `reader${index}@example.org`, status: "active" }));

describe("the background job", () => {
	test("processes each chunk once, in order, and a second delivery of a job does nothing", async () => {
		const { state, deps } = fakeImport({ chunks: [rowsOf(2), rowsOf(2), rowsOf(1)], total: 5 });
		const result = await runImport({ accountId, importId, index: 0 }, { deps, budgetMs: Infinity });
		assert.equal(result.done, true);
		assert.deepEqual(state.processed, [2, 2, 1]);
		assert.equal(state.job.status, "done");
		assert.equal(state.job.rows, 5);
		assert.ok([...state.chunks.values()].every((chunk) => chunk.rows === undefined), "processed chunks lose their rows");

		assert.deepEqual(await runImport({ accountId, importId, index: 0 }, { deps }), { skipped: "not the next chunk", processed: 0 });
		assert.deepEqual(await runImport({ accountId, importId, index: 2 }, { deps }), { skipped: "not the next chunk", processed: 0 });
		assert.deepEqual(state.processed, [2, 2, 1]);
		assert.equal(state.job.rows, 5);
	});

	test("waits for a chunk still on its way, and carries on once it's in", async () => {
		const { state, deps, add } = fakeImport({ chunks: [rowsOf(3)], total: 5 });
		const first = await runImport({ accountId, importId, index: 0 }, { deps });
		assert.equal(first.done, false);
		assert.equal(state.job.status, "processing", "the import isn't done before its total is in");
		add(rowsOf(2));
		const second = await runImport({ accountId, importId, index: 1 }, { deps });
		assert.equal(second.done, true);
		assert.equal(state.job.rows, 5);
	});

	test("an import without a total is done once no chunk waits, and a later chunk opens it again", async () => {
		const { state, deps } = fakeImport({ chunks: [rowsOf(2)] });
		await runImport({ accountId, importId, index: 0 }, { deps });
		assert.equal(state.job.status, "done");
	});

	test("hands the rest to a new job once a run used its time", async () => {
		const { state, deps } = fakeImport({ chunks: [rowsOf(1), rowsOf(1), rowsOf(1), rowsOf(1)], total: 4 });
		let clock = 0;
		const now = () => (clock += 25_000);
		const result = await runImport({ accountId, importId, index: 0 }, { deps, now, budgetMs: 60_000 });
		assert.equal(result.queued, state.job.nextChunk);
		assert.deepEqual(state.queued, [state.job.nextChunk]);
		assert.ok(state.processed.length < 4);
	});

	test("retries a failing chunk, then stops the import on its third try", async () => {
		const { state, deps } = fakeImport({ chunks: [rowsOf(2)], total: 2 });
		state.fail = 3;
		await assert.rejects(runImport({ accountId, importId, index: 0 }, { deps }), /Import chunk 0 failed \(Error\)/);
		assert.equal(state.job.attempts, 1);
		await assert.rejects(runImport({ accountId, importId, index: 0 }, { deps }), /Import chunk 0 failed/);
		const last = await runImport({ accountId, importId, index: 0 }, { deps });
		assert.equal(last.failed, "Error", "logs never quote the error's message, which can hold an address");
		assert.equal(state.job.status, "failed");
		assert.equal(state.job.error, "Part of the file couldn't be imported");
		assert.deepEqual(state.processed, []);
	});

	test("refuses jobs that aren't an import's", async () => {
		assert.deepEqual(await runImport({ accountId: "nope", importId, index: 0 }), { skipped: "invalid job" });
		assert.deepEqual(await runImport({ accountId, importId, index: -1 }), { skipped: "invalid job" });
	});

	test("knows its last chunk, a lost job and a stopped upload", () => {
		assert.equal(isLastChunk({ chunks: 3, total: 10, rows: 6 }, 2, 4), true);
		assert.equal(isLastChunk({ chunks: 3, total: 12, rows: 6 }, 2, 4), false, "rows still to come");
		assert.equal(isLastChunk({ chunks: 3, rows: 6 }, 1, 4), false, "a chunk still waits");
		assert.equal(isLastChunk({ chunks: 1 }, 0, 4), true);

		const now = Date.parse("2026-10-19T12:00:00Z");
		const at = (minutes) => new Date(now - minutes * 60_000);
		const job = { status: "processing", chunks: 3, nextChunk: 1, updatedAt: at(5) };
		assert.equal(getStalledAction(job, now), "resume");
		assert.equal(getStalledAction({ ...job, updatedAt: at(1) }, now), null);
		assert.equal(getStalledAction({ ...job, lockedUntil: at(-2) }, now), null, "a run holds it");
		assert.equal(getStalledAction({ ...job, nextChunk: 3, updatedAt: at(10) }, now), null, "waiting for the rest of the file");
		assert.equal(getStalledAction({ ...job, nextChunk: 3, updatedAt: at(40) }, now), "fail");
		assert.equal(getStalledAction({ ...job, status: "done", updatedAt: at(40) }, now), null);
	});
});

describe("the dialog's chunks and columns", () => {
	test("chunks hold 1,000 rows at most, fewer when rows are big", () => {
		assert.deepEqual(splitImportChunks(rowsOf(2500)).map((chunk) => chunk.length), [1000, 1000, 500]);
		const big = Array.from({ length: 30 }, (_, index) => ({ email: `r${index}@example.org`, note: "x".repeat(100) }));
		const chunks = splitImportChunks(big, { maxSize: 1000 });
		assert.ok(chunks.length > 3);
		assert.ok(chunks.every((chunk) => JSON.stringify(chunk).length <= 1100));
		assert.equal(chunks.flat().length, 30);
	});

	const BEEHIIV = [
		"id",
		"email",
		"status",
		"created_at",
		"unsubscribed_at",
		"tags",
		"first_name",
		"acquisition_source",
		"utm_source",
		"stripe_customer_id",
		"last_opened_at",
		"total_unique_opened",
		"device_type",
		"Company",
	];
	const rows = [
		{ id: "sub_1", email: "Ada@Example.org", status: "active", created_at: "2023-03-24 10:23:10 UTC", tags: "vip, early", first_name: "Ada", acquisition_source: "Twitter", utm_source: "x", stripe_customer_id: "cus_1", last_opened_at: "2026-10-01 08:00:00 UTC", total_unique_opened: "12", device_type: "mobile", Company: "Lovelace Ltd" },
		{ id: "sub_2", email: "grace@example.org", status: "inactive", created_at: "2024-01-02 09:00:00 UTC", unsubscribed_at: "2025-01-01 00:00:00 UTC", first_name: "Grace", acquisition_source: "Google", Company: "Navy" },
	];

	test("recognized columns fold away; new fields and left out columns need a look", () => {
		const plan = planColumns(BEEHIIV, [], rows);
		const target = (column) => plan.find((item) => item.column === column);
		assert.deepEqual(
			["email", "status", "created_at", "unsubscribed_at", "tags", "first_name", "last_opened_at", "total_unique_opened"].map((column) => [
				column,
				target(column).auto,
			]),
			[
				["email", true],
				["status", true],
				["created_at", true],
				["unsubscribed_at", true],
				["tags", true],
				["first_name", true],
				["last_opened_at", true],
				["total_unique_opened", true],
			]
		);
		assert.equal(target("created_at").target, "subscribedAt");
		assert.equal(target("acquisition_source").target, "new:text");
		assert.equal(target("Company").target, "new:text");
		assert.equal(target("acquisition_source").auto, false);
		for (const column of ["id", "stripe_customer_id", "device_type"]) assert.equal(target(column).target, "skip", column);
		assert.deepEqual(target("Company").samples, ["Lovelace Ltd", "Navy"]);
	});

	test("a column takes a single target from the column that had it, and targets read in plain words", () => {
		const plan = planColumns(BEEHIIV, [], rows);
		const moved = assignColumnTarget(plan, "Company", "first_name");
		assert.equal(moved.find((item) => item.column === "Company").target, "first_name");
		assert.equal(moved.find((item) => item.column === "first_name").target, "skip");
		const twoNew = assignColumnTarget(plan, "device_type", "new:text");
		assert.equal(twoNew.find((item) => item.column === "Company").target, "new:text", "new fields aren't single");

		assert.equal(describeColumnTarget("subscribedAt"), "Signup date");
		assert.equal(describeColumnTarget("tags"), "Tags, split by comma");
		assert.equal(describeColumnTarget("skip"), "Don't import");
		assert.equal(describeColumnTarget("new:text", { column: "acquisition_source" }), "New field: Acquisition source (text)");
		assert.equal(describeColumnTarget("field:company", { fields: [{ key: "company", label: "Company" }] }), "Field: Company");
		assert.deepEqual(sampleValues(["", " a ", "a", "b", "c", "d"]), ["a", "b", "c"]);
	});

	test("the preview shows the contacts as they'll be: name, status, tags and fields", () => {
		const plan = planColumns(BEEHIIV, [], rows);
		const { columns, profile } = readColumnPlan(plan, []);
		const [ada, grace] = rows.map((row) => normalizeImportRow(row, columns, { profile }));
		assert.equal(ada.email, "ada@example.org");
		assert.equal(ada.firstName, "Ada");
		assert.equal(ada.status, "active");
		assert.deepEqual(ada.tags, ["vip", "early"]);
		assert.equal(ada.fields.company, "Lovelace Ltd");
		assert.equal(ada.fields.acquisition_source, "Twitter");
		assert.equal(ada.opens, 12);
		assert.equal(grace.status, "unsubscribed");
		assert.equal(ada.subscribedAt, "2023-03-24T10:23:10.000Z");
	});
});

describe("imports through the dashboard and the API", () => {
	let app;
	let m;

	before(async () => {
		app = await startTestApp();
		m = {
			contacts: await import("../app/(app)/contacts/actions.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			jobs: await import("../lib/import-jobs.js"),
			Contact: (await import("../models/Contact.js")).default,
			ContactImport: (await import("../models/ContactImport.js")).default,
			ImportChunk: (await import("../models/ImportChunk.js")).default,
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

	test("a big file goes in the background, and its job is safe to deliver twice", async () => {
		const user = await customer("big@example.com");
		const rows = rowsOf(450);
		published.length = 0;
		const first = await as(user, () =>
			m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: rows.slice(0, 250), total: 450, fileName: "list.csv" })
		);
		assert.equal(first.status, "processing");
		assert.equal(first.received, 250);
		assert.equal(first.processed, 0);
		assert.equal(first.fileName, "list.csv");
		const jobs = published.filter(({ url }) => url.endsWith("/api/jobs/import-contacts"));
		assert.equal(jobs.length, 1);
		assert.deepEqual(jobs[0].body, { accountId: String(user.accountId), importId: first.importId, index: 0 });

		const second = await as(user, () =>
			m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, importId: first.importId, rows: rows.slice(250) })
		);
		assert.equal(second.received, 450);

		await m.jobs.runImport(jobs[0].body);
		await m.jobs.runImport(jobs[0].body);
		const done = await m.ContactImport.findOne({ accountId: user.accountId, _id: first.importId }).lean();
		assert.equal(done.status, "done");
		assert.equal(done.rows, 450);
		assert.equal(done.created, 450);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, newsletterId: user.newsletterId }), 450);
		const chunks = await m.ImportChunk.find({ accountId: user.accountId, importId: first.importId }).lean();
		assert.equal(chunks.length, 2);
		assert.ok(chunks.every((chunk) => chunk.rows === undefined && chunk.processedAt));

		const listed = await as(user, () => m.contacts.getImports(user.newsletterId));
		assert.equal(listed.imports[0].importId, first.importId);
		assert.equal(listed.imports[0].status, "done");
	});

	test("a small import goes in right away, with its counts", async () => {
		const user = await customer("small@example.com");
		const result = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows: rowsOf(3), total: 3 }));
		assert.equal(result.status, "done");
		assert.equal(result.created, 3);
	});

	test("an import is its account's only", async () => {
		const owner = await customer("owner@example.com");
		const other = await customer("other@example.com");
		const started = await as(owner, () =>
			m.contacts.importContacts({ newsletterId: owner.newsletterId, consent: true, rows: rowsOf(300), total: 600 })
		);
		const { key } = await as(other, () => m.apiKeys.createApiKey(null, form({ name: "Other's script" })));
		const response = await callApi("GET", `/contacts/imports/${started.importId}`, { key });
		assert.equal(response.status, 404);
		const listed = await callApi("GET", "/contacts/imports", { key });
		assert.equal(listed.status, 200);
		assert.deepEqual(listed.body.imports, []);
		const adding = await callApi("POST", "/contacts/import", { key, body: { consent: true, importId: started.importId, contacts: rowsOf(1) } });
		assert.equal(adding.status, 404);
		assert.equal(await m.Contact.countDocuments({ accountId: other.accountId }), 0);
	});
});
