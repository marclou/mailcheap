import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getStalledAction, isLastChunk, runImport, runImportChunk } from "../lib/import-jobs.js";

const ACCOUNT_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const IMPORT_ID = "74f1a2b3c4d5e6f7a8b9c0d2";
const NOW = Date.parse("2026-10-19T12:00:00Z");

// An import and its chunks in memory, with the same rules as the database steps: only the next chunk can be claimed,
// and only while nobody holds it.
function fakeStore({ chunks, total, failTimes = 0 }) {
	const job = { _id: IMPORT_ID, newsletterId: "n1", status: "processing", total, chunks: chunks.length, nextChunk: 0, rows: 0, created: 0, attempts: 0 };
	const stored = chunks.map((rows, index) => ({ index, rows }));
	let failures = failTimes;
	const written = [];
	const deps = {
		claim: async ({ index }, now) => {
			if (job.status !== "processing" || job.nextChunk !== index || (job.lockedUntil && job.lockedUntil > now)) return null;
			job.lockedUntil = now + 60_000;
			return { ...job };
		},
		loadChunk: async ({ index }) => stored[index] ?? null,
		loadAccount: async () => ({ _id: ACCOUNT_ID, contactFields: [] }),
		process: async ({ rows }) => {
			if (failures > 0) {
				failures--;
				throw new Error("database down");
			}
			written.push(...rows);
			return { rows: rows.length, created: rows.length, existing: 0, dropped: { invalid: 0 } };
		},
		commit: async ({ index }, update, { last }) => {
			if (job.nextChunk !== index) return { done: false };
			job.rows += update.$inc.rows;
			job.created += update.$inc.created;
			job.nextChunk = update.$set.nextChunk;
			job.attempts = 0;
			delete job.lockedUntil;
			if (last && job.chunks === index + 1) {
				job.status = "done";
				return { done: true };
			}
			return { done: false };
		},
		release: async ({ index }, set = {}) => {
			if (job.nextChunk !== index) return;
			Object.assign(job, set);
			delete job.lockedUntil;
		},
		clearChunk: async ({ index }) => {
			stored[index] = { index, rows: undefined };
		},
		hasChunk: async ({ index }) => Boolean(stored[index]),
		queue: async (next) => queued.push(next),
	};
	const queued = [];
	return { job, deps, written, queued, stored };
}

const jobRef = (index) => ({ accountId: ACCOUNT_ID, importId: IMPORT_ID, index });
const now = () => NOW;

describe("running an import's chunks", () => {
	test("one run takes the chunks in order until the last, then the import is done", async () => {
		const store = fakeStore({ chunks: [["a", "b"], ["c"], ["d", "e"]], total: 5 });
		const result = await runImport(jobRef(0), { now, deps: store.deps });
		assert.deepEqual(result, { processed: 5, done: true, next: null });
		assert.deepEqual(store.written, ["a", "b", "c", "d", "e"]);
		assert.equal(store.job.status, "done");
		assert.equal(store.job.rows, 5);
		assert.ok(store.stored.every((chunk) => chunk.rows === undefined), "processed chunks keep no rows");
	});

	test("a second delivery of the same job finds nothing to do and adds nothing", async () => {
		const store = fakeStore({ chunks: [["a"], ["b"]], total: 2 });
		await runImport(jobRef(0), { now, deps: store.deps });
		assert.deepEqual(await runImport(jobRef(0), { now, deps: store.deps }), { skipped: "not the next chunk", processed: 0 });
		assert.deepEqual(await runImportChunk(jobRef(1), { now, deps: store.deps }), { skipped: "not the next chunk" });
		assert.deepEqual(store.written, ["a", "b"]);
		assert.equal(store.job.rows, 2);
	});

	test("a chunk held by another run isn't taken twice", async () => {
		const store = fakeStore({ chunks: [["a"]], total: 1 });
		store.job.lockedUntil = NOW + 30_000;
		assert.deepEqual(await runImportChunk(jobRef(0), { now, deps: store.deps }), { skipped: "not the next chunk" });
		assert.deepEqual(store.written, []);
	});

	test("a chunk that isn't in yet waits for its upload, which starts it", async () => {
		const store = fakeStore({ chunks: [["a"]], total: 3 });
		const first = await runImport(jobRef(0), { now, deps: store.deps });
		assert.deepEqual(first, { processed: 1, done: false, next: null }, "the rest of the file hasn't arrived");
		assert.equal(store.job.status, "processing");
		assert.deepEqual(await runImportChunk(jobRef(1), { now, deps: store.deps }), { waiting: true });
		assert.equal(store.job.lockedUntil, undefined, "the chunk is free again");
	});

	test("past its time, a run hands the next chunk to a new job", async () => {
		const store = fakeStore({ chunks: [["a"], ["b"], ["c"]], total: 3 });
		let clock = NOW;
		const ticking = () => (clock += 20_000);
		const result = await runImport(jobRef(0), { now: ticking, budgetMs: 60_000, deps: store.deps });
		assert.equal(result.queued, 2);
		assert.deepEqual(store.queued, [jobRef(2)]);
		assert.deepEqual(store.written, ["a", "b"]);
	});

	test("a failing chunk is retried, then stops the import with a reason on its last try", async () => {
		const store = fakeStore({ chunks: [["a"]], total: 1, failTimes: 5 });
		await assert.rejects(runImportChunk(jobRef(0), { now, deps: store.deps }), /Import chunk 0 failed \(Error\)/);
		assert.equal(store.job.attempts, 1);
		assert.equal(store.job.lockedUntil, undefined, "the next try can take it");
		await assert.rejects(runImportChunk(jobRef(0), { now, deps: store.deps }), /Import chunk 0 failed/);
		const last = await runImportChunk(jobRef(0), { now, deps: store.deps });
		assert.equal(last.failed, "Error", "the error's message, which can quote an address, stays out");
		assert.equal(store.job.status, "failed");
		assert.equal(store.job.error, "Part of the file couldn't be imported");
		assert.deepEqual(store.written, []);
	});

	test("an invalid job is skipped", async () => {
		assert.deepEqual(await runImport({ accountId: "nope", importId: IMPORT_ID, index: 0 }), { skipped: "invalid job" });
		assert.deepEqual(await runImport({ accountId: ACCOUNT_ID, importId: IMPORT_ID, index: -1 }), { skipped: "invalid job" });
	});
});

describe("an import's end and its mending", () => {
	test("with a total, done once every row is in; without one, once no chunk waits", () => {
		assert.equal(isLastChunk({ chunks: 2, total: 10, rows: 6 }, 1, 4), true);
		assert.equal(isLastChunk({ chunks: 2, total: 10, rows: 2 }, 1, 4), false, "rows still to come");
		assert.equal(isLastChunk({ chunks: 3, total: 10, rows: 6 }, 1, 4), false, "a chunk waits");
		assert.equal(isLastChunk({ chunks: 1 }, 0, 4), true);
	});

	test("a look restarts a chunk whose job was lost, and fails an upload that stopped", () => {
		const base = { status: "processing", chunks: 3, nextChunk: 1 };
		assert.equal(getStalledAction({ ...base, updatedAt: new Date(NOW - 60_000) }, NOW), null, "it may still be on its way");
		assert.equal(getStalledAction({ ...base, updatedAt: new Date(NOW - 3 * 60_000) }, NOW), "resume");
		assert.equal(getStalledAction({ ...base, nextChunk: 3, updatedAt: new Date(NOW - 10 * 60_000) }, NOW), null, "waiting for rows");
		assert.equal(getStalledAction({ ...base, nextChunk: 3, updatedAt: new Date(NOW - 31 * 60_000) }, NOW), "fail");
		assert.equal(getStalledAction({ ...base, lockedUntil: new Date(NOW + 1000), updatedAt: new Date(NOW - 31 * 60_000) }, NOW), null, "a run holds it");
		assert.equal(getStalledAction({ ...base, status: "done", updatedAt: new Date(0) }, NOW), null);
	});
});
