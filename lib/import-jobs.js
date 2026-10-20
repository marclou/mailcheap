import "server-only";
import { isValidObjectId } from "mongoose";
import { after } from "next/server";
import { scoped } from "@/lib/account-scope";
import { getAppUrl } from "@/lib/config";
import { createContactImport, processImportRows } from "@/lib/contact-import";
import { MAX_IMPORT_ROWS, MAX_IMPORT_ROWS_PER_REQUEST } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { DROP_REASONS } from "@/lib/import-checks";
import { publishJob } from "@/lib/sending";
import Account from "@/models/Account";
import ContactImport from "@/models/ContactImport";
import ImportChunk from "@/models/ImportChunk";

// Imports run in the background. The caller sends a file's rows in chunks, one per request, each kept as an
// ImportChunk; a job processes them in order, as many as fit in a run, then hands the next to a new job. Every step is
// safe to repeat: a run first claims the import's next chunk, so a second delivery of a job finds nothing to do.
const MAX_CHUNKS = 2000;
// Longer than a run can last (maxDuration), so a held chunk is only taken back from a run that died.
const LOCK_MS = 6 * 60 * 1000;
// A run stops taking chunks after this, with room left for the one it's on.
const RUN_BUDGET_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;
// A chunk nobody started for this long lost its job on the way: the next look at the import starts it again.
const LOST_JOB_MS = 2 * 60 * 1000;
// Nothing new for this long while rows are missing: the upload stopped, say the browser closed.
const STALLED_MS = 30 * 60 * 1000;
const UPLOAD_STOPPED = "The upload stopped before the end of the file";

const JOB_URL = "/api/jobs/import-contacts";
// An import this small goes in during the request that brings it, so the answer has its counts; bigger ones go to the
// background job.
const INLINE_ROWS = 200;
const INLINE_BUDGET_MS = 20 * 1000;

// What the API and the dashboard show of an import. Imports from before background jobs have no status: they ran
// while the browser waited, so they're done.
export function toImportView(job) {
	return {
		importId: String(job._id),
		status: job.status ?? "done",
		fileName: job.fileName ?? null,
		total: job.total ?? null,
		received: job.received || job.rows || 0,
		processed: job.rows ?? 0,
		created: job.created ?? 0,
		existing: job.existing ?? 0,
		dropped: Object.fromEntries(Object.keys(DROP_REASONS).map((reason) => [reason, job.dropped?.[reason] ?? 0])),
		createdAt: new Date(job.createdAt).toISOString(),
		finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
		error: job.error ?? null,
	};
}

function isLocked(job, now) {
	return Boolean(job.lockedUntil) && new Date(job.lockedUntil).getTime() > now;
}

// Whether a look at the import should start its next chunk again (its job was lost) or fail it (rows stopped coming).
export function getStalledAction(job, now = Date.now()) {
	if (job.status !== "processing" || isLocked(job, now)) return null;
	const idleMs = now - new Date(job.updatedAt ?? job.createdAt).getTime();
	if (idleMs > STALLED_MS) return "fail";
	if (job.nextChunk < job.chunks && idleMs > LOST_JOB_MS) return "resume";
	return null;
}

// The last chunk of what the caller said it sends: with a total, once every row is in; without one, once no other
// chunk waits. A later chunk opens the import again.
export function isLastChunk(job, index, rows) {
	if (index + 1 < job.chunks) return false;
	return !job.total || (job.rows ?? 0) + rows >= job.total;
}

export async function startImport({ account, userId, apiKeyId, newsletterId, consent, source, fileName, total, duplicates }) {
	if (total !== undefined && total !== null && (!Number.isInteger(total) || total < 1 || total > MAX_IMPORT_ROWS)) {
		return { error: `An import takes ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows at most` };
	}
	return createContactImport({ account, userId, apiKeyId, newsletterId, consent, source, fileName, total: total ?? undefined, duplicates });
}

// The import's next chunk, in the order chunks arrive. Starts the job when the import waits for it.
export async function addImportRows({ account, importId, newsletterId, rows }) {
	if (!isValidObjectId(importId)) return { error: "Import not found" };
	if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows" };
	if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) return { error: `${MAX_IMPORT_ROWS_PER_REQUEST} rows at most per request` };
	const reserved = await ContactImport.findOneAndUpdate(
		scoped(account, {
			_id: importId,
			...(newsletterId && { newsletterId }),
			status: { $ne: "failed" },
			chunks: { $lt: MAX_CHUNKS },
			received: { $lte: MAX_IMPORT_ROWS - rows.length },
		}),
		{ $inc: { chunks: 1, received: rows.length }, $set: { status: "processing" }, $unset: { finishedAt: 1 } },
		{ new: true, projection: { chunks: 1 } }
	).lean();
	if (!reserved) return { error: await getRefusal(account, importId) };

	const index = reserved.chunks - 1;
	await ImportChunk.create({ accountId: account._id, importId: reserved._id, index, rows, count: rows.length });
	// Read after the chunk is in: a run that just finished either sees it (and carries on) or left the import free.
	const job = await ContactImport.findOne(scoped(account, { _id: reserved._id })).lean();
	if (job.nextChunk !== index || isLocked(job, Date.now())) return { job };

	const next = { accountId: String(account._id), importId: String(job._id), index };
	if ((job.total ?? rows.length) > INLINE_ROWS || rows.length > INLINE_ROWS) {
		await queueImportChunk(next);
		return { job };
	}
	try {
		await runImport(next, { budgetMs: INLINE_BUDGET_MS });
	} catch {
		// Its run released the chunk for another try: the background job takes it from there.
		await queueImportChunk(next);
	}
	return { job: await ContactImport.findOne(scoped(account, { _id: job._id })).lean() };
}

async function getRefusal(account, importId) {
	const job = await ContactImport.findOne(scoped(account, { _id: importId })).select({ status: 1, chunks: 1 }).lean();
	if (!job) return "Import not found";
	if (job.status === "failed") return "This import stopped: start a new one";
	return `An import takes ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows at most`;
}

// QStash runs the chunk; without QStash (development, or a server that has none) it runs once the response is sent.
export async function queueImportChunk({ accountId, importId, index }) {
	const job = { accountId: String(accountId), importId: String(importId), index };
	if (process.env.QSTASH_TOKEN) {
		await publishJob({ url: `${getAppUrl()}${JOB_URL}`, body: job });
		return;
	}
	after(() =>
		runImport(job, { budgetMs: Number.POSITIVE_INFINITY }).catch((error) => {
			console.error(`[import] ${job.importId} failed: ${describeError(error)}`);
		})
	);
}

// What an error was, for the logs, without its message: a database error can quote an address.
function describeError(error) {
	return String(error?.code ?? error?.name ?? "error");
}

// One job: the chunk it was sent for, then the following ones while time is left; the rest goes to a new job.
export async function runImport(job, { budgetMs = RUN_BUDGET_MS, now = Date.now, deps } = {}) {
	const isValid = isValidObjectId(String(job?.accountId)) && isValidObjectId(String(job?.importId)) && Number.isInteger(job?.index) && job.index >= 0;
	if (!isValid) return { skipped: "invalid job" };
	if (!deps) await connectDb();
	const started = now();
	let current = { accountId: String(job.accountId), importId: String(job.importId), index: job.index };
	let processed = 0;
	for (;;) {
		const result = await runImportChunk(current, { now, deps });
		processed += result.processed ?? 0;
		if (!result.next) return { ...result, processed };
		current = result.next;
		if (now() - started > budgetMs) {
			await (deps?.queue ?? queueImportChunk)(current);
			return { processed, queued: current.index };
		}
	}
}

const defaultDeps = {
	claim: ({ accountId, importId, index }, now) =>
		ContactImport.findOneAndUpdate(
			{
				accountId,
				_id: importId,
				status: "processing",
				nextChunk: index,
				$or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date(now) } }],
			},
			{ $set: { lockedUntil: new Date(now + LOCK_MS) }, $min: { startedAt: new Date(now) } },
			{ new: true }
		).lean(),
	loadChunk: ({ accountId, importId, index }) => ImportChunk.findOne({ accountId, importId, index }).lean(),
	loadAccount: (accountId) => Account.findById(accountId).select({ contactFields: 1 }).lean(),
	process: processImportRows,
	// Only the run holding the chunk moves the import on: the filter is the chunk it claimed.
	commit: async ({ accountId, importId, index }, update, { last }) => {
		if (last) {
			const done = await ContactImport.updateOne(
				{ accountId, _id: importId, nextChunk: index, chunks: index + 1 },
				{ ...update, $set: { ...update.$set, status: "done", finishedAt: new Date() } }
			);
			if (done.modifiedCount === 1) return { done: true };
		}
		await ContactImport.updateOne({ accountId, _id: importId, nextChunk: index }, update);
		return { done: false };
	},
	release: ({ accountId, importId, index }, set = {}) =>
		ContactImport.updateOne(
			{ accountId, _id: importId, nextChunk: index },
			{ ...(Object.keys(set).length > 0 && { $set: set }), $unset: { lockedUntil: 1 } }
		),
	clearChunk: ({ accountId, importId, index }) =>
		ImportChunk.updateOne({ accountId, importId, index }, { $unset: { rows: 1 }, $set: { processedAt: new Date() } }),
	hasChunk: ({ accountId, importId, index }) => ImportChunk.exists({ accountId, importId, index }),
};

// Claims the chunk, adds its rows, counts them in the import, and says which chunk comes next if it's already in.
export async function runImportChunk(job, { now = Date.now, deps } = {}) {
	const use = { ...defaultDeps, ...deps };
	const claimed = await use.claim(job, now());
	if (!claimed) return { skipped: "not the next chunk" };
	const chunk = await use.loadChunk(job);
	if (!chunk?.rows) {
		// Not in yet: its upload starts it. Already processed rows can't be missing here, the import would have moved on.
		await use.release(job);
		return { waiting: true };
	}
	const account = await use.loadAccount(job.accountId);
	if (!account) {
		await use.release(job, { status: "failed", error: "The account is gone", finishedAt: new Date() });
		return { failed: "account gone" };
	}

	let result;
	try {
		result = await use.process({ account, newsletterId: claimed.newsletterId, importId: claimed._id, rows: chunk.rows });
	} catch (error) {
		const attempts = (claimed.attempts ?? 0) + 1;
		if (attempts < MAX_ATTEMPTS) {
			await use.release(job, { attempts });
			throw new Error(`Import chunk ${job.index} failed (${describeError(error)})`);
		}
		await use.release(job, { attempts, status: "failed", error: "Part of the file couldn't be imported", finishedAt: new Date() });
		return { failed: describeError(error) };
	}

	const update = {
		$inc: {
			rows: result.rows,
			created: result.created,
			existing: result.existing,
			...Object.fromEntries(Object.entries(result.dropped).map(([reason, count]) => [`dropped.${reason}`, count])),
		},
		$set: { nextChunk: job.index + 1, attempts: 0 },
		$unset: { lockedUntil: 1 },
	};
	const { done } = await use.commit(job, update, { last: isLastChunk(claimed, job.index, result.rows) });
	await use.clearChunk(job);
	const next = { ...job, index: job.index + 1 };
	const hasNext = !done && (await use.hasChunk(next));
	return { processed: result.rows, done, next: hasNext ? next : null };
}

// A look at an import also mends it: a chunk whose job was lost starts again, and an upload that stopped fails. Only
// one look restarts a chunk: marking the import counts as news, so the next looks wait again.
async function mend(job, now = Date.now()) {
	const action = getStalledAction(job, now);
	if (action === "resume") {
		const { modifiedCount } = await ContactImport.updateOne(
			{ accountId: job.accountId, _id: job._id, status: "processing", nextChunk: job.nextChunk, updatedAt: job.updatedAt },
			{ $set: { resumedAt: new Date(now) } }
		);
		if (modifiedCount === 1) await queueImportChunk({ accountId: job.accountId, importId: job._id, index: job.nextChunk });
		return job;
	}
	if (action === "fail") {
		const failed = { status: "failed", error: UPLOAD_STOPPED, finishedAt: new Date(now) };
		const { modifiedCount } = await ContactImport.updateOne(
			{ accountId: job.accountId, _id: job._id, status: "processing", nextChunk: job.nextChunk, chunks: job.chunks },
			{ $set: failed, $unset: { lockedUntil: 1 } }
		);
		return modifiedCount === 1 ? { ...job, ...failed } : job;
	}
	return job;
}

export async function getImport(account, importId) {
	if (!isValidObjectId(importId)) return null;
	const job = await ContactImport.findOne(scoped(account, { _id: importId })).lean();
	return job ? toImportView(await mend(job)) : null;
}

export async function listImports(account, { newsletterId, limit = 5 } = {}) {
	const jobs = await ContactImport.find(scoped(account, newsletterId ? { newsletterId } : {}))
		.sort({ createdAt: -1 })
		.limit(Math.min(Math.max(limit, 1), 20))
		.lean();
	return Promise.all(jobs.map(async (job) => toImportView(await mend(job))));
}
