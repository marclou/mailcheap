import { isValidObjectId } from "mongoose";
import { findDeletedStatuses, getSignupProblem, toSearchPattern } from "@/lib/contacts";
import { getDomainLists } from "@/lib/domain-lists";
import { findGloballySuppressed } from "@/lib/global-suppressions";
import { findDomainsWithoutMail } from "@/lib/mail-domains";
import { moveContacts } from "@/lib/status-changes";
import Contact from "../models/Contact.js";
import ContactImport from "../models/ContactImport.js";
import LeftOutContact from "../models/LeftOutContact.js";
import Newsletter from "../models/Newsletter.js";
import Suppression from "../models/Suppression.js";
import { scoped, scopedNewsletter } from "./account-scope.js";
import { MAX_IMPORT_ROWS_PER_REQUEST, STATUS_RANK, sanitizeImportRow } from "./csv-import.js";
import { BRING_BACK_REASONS, CONSENT_TEXT, emptyDropped, getDropReason } from "./import-checks.js";

const SUPPRESSION_REASONS = { bounced: "bounce", complained: "complaint" };
export const LEFT_OUT_PAGE_SIZE = 50;

// Rows that only record a past unsubscribe, bounce or complaint get no emails, so they skip the checks.
function getsEmails({ status }) {
	return STATUS_RANK[status] <= STATUS_RANK.dormant;
}

function domainOf(email) {
	return email.split("@")[1];
}

function weakerStatuses(status) {
	return Object.keys(STATUS_RANK).filter((key) => STATUS_RANK[key] < STATUS_RANK[status]);
}

// One upsert per contact: new contacts take the file's status, existing ones keep theirs. A first name and field values
// in the file replace the contact's; its tags are added to the contact's own. Opens and clicks from the previous
// platform only move the contact's own forward (the later date, the higher count), so importing again changes nothing.
export function getContactWrites({ accountId, newsletterId, contacts, source, importId }) {
	return contacts.map((contact) => {
		const { email, status, subscribedAt, emailsReceived, openRate, clickRate, firstName, tags, fields } = contact;
		const set = {
			...Object.fromEntries(
				Object.entries({ emailsReceived, openRate, clickRate })
					.filter(([, value]) => value !== undefined)
					.map(([key, value]) => [`imported.${key}`, value])
			),
			...(firstName && { firstName }),
			...Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [`fields.${key}`, value])),
		};
		const max = Object.fromEntries(
			Object.entries({
				lastOpenAt: contact.lastOpenAt,
				lastClickAt: contact.lastClickAt,
				"stats.opens": contact.opens,
				"stats.clicks": contact.clicks,
			}).filter(([, value]) => value !== undefined)
		);
		return {
			updateOne: {
				filter: { accountId, newsletterId, email },
				update: {
					$setOnInsert: {
						status,
						source,
						...(importId && { importId }),
						subscribedAt: subscribedAt ?? new Date(),
						...(status === "unsubscribed" && { unsubscribedAt: new Date() }),
					},
					...(Object.keys(set).length > 0 && { $set: set }),
					...(Object.keys(max).length > 0 && { $max: max }),
					...(tags?.length > 0 && { $addToSet: { tags: { $each: tags } } }),
				},
				upsert: true,
			},
		};
	});
}

// Each status the rows move existing contacts to, with the weaker statuses it replaces. Nothing moves a
// contact to active, and pending has no rank, so a contact waiting to confirm stays as it is.
export function getStatusChanges(contacts) {
	return Object.entries(Object.groupBy(contacts, ({ status }) => status))
		.filter(([status]) => status !== "active")
		.map(([status, group]) => ({
			status,
			emails: group.map(({ email }) => email),
			replaces: weakerStatuses(status),
		}));
}

// Rows that would get emails are checked; rows that only record a past unsubscribe, bounce or complaint
// always go in, so those people stay out. fields: the account's own, which field values are checked against.
// lists: the downloaded domain lists in use (lib/domain-lists.js). leftOut: the addresses dropped, with the contact they
// would have been when they can be brought back.
export function checkImportRows(rows, fields = [], lists = {}) {
	const dropped = emptyDropped();
	const byEmail = new Map();
	for (const row of rows) {
		const contact = sanitizeImportRow(row, fields);
		if (!contact) dropped.invalid++;
		else if (byEmail.has(contact.email)) dropped.duplicate++;
		else byEmail.set(contact.email, contact);
	}
	const contacts = [];
	const leftOut = [];
	for (const contact of byEmail.values()) {
		const reason = getsEmails(contact) && getDropReason(contact.email, lists);
		if (!reason) {
			contacts.push(contact);
			continue;
		}
		dropped[reason]++;
		leftOut.push({ email: contact.email, reason, ...(BRING_BACK_REASONS.includes(reason) && { contact }) });
	}
	return { contacts, dropped, leftOut };
}

// Never deletes and never moves a contact back to a weaker status: an unsubscribe, bounce or
// complaint always wins.
async function writeContacts({ accountId, newsletterId, contacts, source, importId }) {
	if (contacts.length === 0) return { created: 0, existing: 0 };
	const result = await Contact.bulkWrite(getContactWrites({ accountId, newsletterId, contacts, source, importId }), {
		ordered: false,
	});

	const changes = getStatusChanges(contacts);
	const at = new Date();
	for (const { status, emails, replaces } of changes) {
		await moveContacts(
			{ accountId, newsletterId, email: { $in: emails } },
			{ from: replaces, to: status, via: "import", at, update: status === "unsubscribed" ? { $set: { unsubscribedAt: at } } : {} }
		);
	}

	const suppressed = changes.filter(({ status }) => SUPPRESSION_REASONS[status]);
	if (suppressed.length > 0) {
		await Suppression.bulkWrite(
			suppressed.flatMap(({ status, emails }) =>
				emails.map((email) => ({
					updateOne: {
						filter: { accountId, email },
						update: { $setOnInsert: { reason: SUPPRESSION_REASONS[status], detail: source } },
						upsert: true,
					},
				}))
			),
			{ ordered: false }
		);
	}

	return { created: result.upsertedCount, existing: result.matchedCount };
}

// An import starts with the customer's word that these people agreed to their emails. Its rows come after, in chunks
// (lib/import-jobs.js). duplicates: the rows the caller removed from the file before sending, counted in its report.
export async function createContactImport({ account, userId, apiKeyId, newsletterId, consent, source = "dashboard", fileName, total, duplicates = 0 }) {
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	const newsletter = await Newsletter.findOne(scoped(account, { _id: newsletterId })).select({ _id: 1 }).lean();
	if (!newsletter) return { error: "Newsletter not found" };
	if (consent !== true) return { error: "Confirm that these people agreed to receive your emails" };
	const contactImport = await ContactImport.create({
		accountId: account._id,
		newsletterId: newsletter._id,
		userId,
		apiKeyId,
		source,
		consent: true,
		consentText: CONSENT_TEXT,
		consentAt: new Date(),
		status: "processing",
		...(fileName && { fileName: String(fileName).slice(0, 200) }),
		...(total && { total }),
		dropped: { duplicate: Math.max(0, Math.floor(Number(duplicates) || 0)) },
	});
	return { contactImport };
}

// One chunk of an import's rows, with the same checks for every source. Returns what to add to the import's counts.
export async function processImportRows({ account, newsletterId, importId, rows }) {
	if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new Error("Too many rows in a chunk");
	const checked = checkImportRows(rows, account.contactFields ?? [], await getDomainLists());
	const dropped = { ...checked.dropped };
	const emailsToCheck = checked.contacts.filter(getsEmails).map(({ email }) => email);
	const [suppressed, deleted, undeliverable] = await Promise.all([
		Suppression.distinct("email", { accountId: account._id, email: { $in: emailsToCheck } }),
		findDeletedStatuses({ accountId: account._id, newsletterId, emails: emailsToCheck }),
		findGloballySuppressed(emailsToCheck),
	]);
	const suppressedEmails = new Set([...suppressed, ...deleted.keys()]);
	const unsuppressed = checked.contacts.filter((contact) => !getsEmails(contact) || !suppressedEmails.has(contact.email));
	dropped.suppressed += checked.contacts.length - unsuppressed.length;
	const deliverable = unsuppressed.filter((contact) => !getsEmails(contact) || !undeliverable.has(contact.email));
	dropped.undeliverable += unsuppressed.length - deliverable.length;
	// Every email to a domain without a mail server bounces, and bounces count against the account.
	const domainsWithoutMail = await findDomainsWithoutMail(deliverable.filter(getsEmails).map(({ email }) => domainOf(email)));
	const contacts = deliverable.filter((contact) => !getsEmails(contact) || !domainsWithoutMail.has(domainOf(contact.email)));
	dropped.noMail += deliverable.length - contacts.length;
	const leftOut = [
		...checked.leftOut,
		...emailsToCheck.filter((email) => suppressedEmails.has(email)).map((email) => ({ email, reason: "suppressed" })),
		...deliverable
			.filter((contact) => getsEmails(contact) && domainsWithoutMail.has(domainOf(contact.email)))
			.map(({ email }) => ({ email, reason: "noMail" })),
	];

	const written = await writeContacts({ accountId: account._id, newsletterId, contacts, source: "import", importId });
	await saveLeftOut({ accountId: account._id, newsletterId, importId, leftOut });
	return { rows: rows.length, ...written, dropped };
}

// Processing a chunk again changes nothing here.
async function saveLeftOut({ accountId, newsletterId, importId, leftOut }) {
	if (leftOut.length === 0) return;
	await LeftOutContact.bulkWrite(
		leftOut.map(({ email, reason, contact }) => ({
			updateOne: {
				filter: { accountId, importId, email },
				update: {
					$setOnInsert: {
						newsletterId,
						reason,
						canBringBack: BRING_BACK_REASONS.includes(reason),
						...(contact && { contact: withoutUndefined(contact) }),
					},
				},
				upsert: true,
			},
		})),
		{ ordered: false }
	);
}

function withoutUndefined(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// A page of what an import left out, the ones its account can bring back first, then by address. after: the last one
// of the page before. Null when the account has no such import.
export async function listLeftOut(account, importId, { search, after = null, limit = LEFT_OUT_PAGE_SIZE } = {}) {
	if (!isValidObjectId(importId)) return null;
	const contactImport = await ContactImport.findOne(scopedNewsletter(account, { _id: importId })).select({ _id: 1 }).lean();
	if (!contactImport) return null;
	const pattern = toSearchPattern(search);
	const found = await LeftOutContact.find(
		scoped(account, {
			importId: contactImport._id,
			...(pattern && { email: { $regex: pattern } }),
			...(after && {
				$or: [{ canBringBack: after.canBringBack, email: { $gt: after.email } }, ...(after.canBringBack ? [{ canBringBack: false }] : [])],
			}),
		})
	)
		.sort({ canBringBack: -1, email: 1 })
		.limit(limit + 1)
		.select({ email: 1, reason: 1, canBringBack: 1, broughtBackAt: 1 })
		.lean();
	return { contacts: found.slice(0, limit), hasMore: found.length > limit };
}

// Addresses an import left out as role addresses or throwaway inboxes, added after all with what their row had, as the
// import would have, once its account vouches for them. Each answers on its own; one already back counts as brought back.
export async function bringBackLeftOut({ account, importId, emails }) {
	if (!isValidObjectId(importId)) return { error: "Import not found" };
	const contactImport = await ContactImport.findOne(scopedNewsletter(account, { _id: importId })).select({ newsletterId: 1 }).lean();
	if (!contactImport) return { error: "Import not found" };
	const results = [];
	for (const email of new Set(emails)) results.push(await bringBackOne(account, contactImport, email));
	return { results };
}

async function bringBackOne(account, { _id: importId, newsletterId }, email) {
	const refuse = (error) => ({ email, broughtBack: false, error });
	const leftOut = await LeftOutContact.findOne(scoped(account, { importId, email })).lean();
	if (!leftOut) return refuse("This import didn't leave this address out");
	if (leftOut.broughtBackAt) return { email, broughtBack: true, error: null };
	if (!BRING_BACK_REASONS.includes(leftOut.reason) || !leftOut.contact) return refuse("Only role addresses and throwaway inboxes can be brought back");
	const problem = await getBringBackProblem(account, newsletterId, email);
	if (problem) return refuse(problem);

	const claimed = await LeftOutContact.updateOne(scoped(account, { _id: leftOut._id, broughtBackAt: null }), { $set: { broughtBackAt: new Date() } });
	if (claimed.modifiedCount === 0) return { email, broughtBack: true, error: null };
	let written;
	try {
		const contact = withCurrentFields(leftOut.contact, account.contactFields ?? []);
		written = await writeContacts({ accountId: account._id, newsletterId, contacts: [contact], source: "import", importId });
	} catch (error) {
		await LeftOutContact.updateOne(scoped(account, { _id: leftOut._id }), { $unset: { broughtBackAt: 1 } });
		throw error;
	}
	await ContactImport.updateOne(scoped(account, { _id: importId }), {
		$inc: { created: written.created, existing: written.existing, [`dropped.${leftOut.reason}`]: -1 },
	});
	return { email, broughtBack: true, error: null };
}

// What still keeps out an address its account vouches for: the checks adding one contact runs, and its own past
// unsubscribe, bounce or complaint, which an import never overrides.
async function getBringBackProblem(account, newsletterId, email) {
	const [suppression, deleted] = await Promise.all([
		Suppression.exists({ accountId: account._id, email }),
		findDeletedStatuses({ accountId: account._id, newsletterId, emails: [email] }),
	]);
	if (suppression || deleted.size > 0) return "This address unsubscribed, bounced or complained before";
	return getSignupProblem(email);
}

// A field deleted since the import doesn't come back with the contact.
function withCurrentFields(contact, fields) {
	if (!contact.fields) return contact;
	const keys = new Set(fields.map(({ key }) => key));
	return { ...contact, fields: Object.fromEntries(Object.entries(contact.fields).filter(([key]) => keys.has(key))) };
}
