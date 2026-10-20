import { isValidObjectId } from "mongoose";
import { findDeletedStatuses } from "@/lib/contacts";
import { findGloballySuppressed } from "@/lib/global-suppressions";
import { findDomainsWithoutMail } from "@/lib/mail-domains";
import Contact from "../models/Contact.js";
import ContactImport from "../models/ContactImport.js";
import Newsletter from "../models/Newsletter.js";
import Suppression from "../models/Suppression.js";
import { scoped } from "./account-scope.js";
import { MAX_IMPORT_ROWS_PER_REQUEST, STATUS_RANK, sanitizeImportRow } from "./csv-import.js";
import { CONSENT_TEXT, emptyDropped, getDropReason } from "./import-checks.js";

const SUPPRESSION_REASONS = { bounced: "bounce", complained: "complaint" };

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
export function checkImportRows(rows, fields = []) {
	const dropped = emptyDropped();
	const byEmail = new Map();
	for (const row of rows) {
		const contact = sanitizeImportRow(row, fields);
		if (!contact) dropped.invalid++;
		else if (byEmail.has(contact.email)) dropped.duplicate++;
		else byEmail.set(contact.email, contact);
	}
	const contacts = [];
	for (const contact of byEmail.values()) {
		const reason = getsEmails(contact) && getDropReason(contact.email);
		if (reason) dropped[reason]++;
		else contacts.push(contact);
	}
	return { contacts, dropped };
}

// Never deletes and never moves a contact back to a weaker status: an unsubscribe, bounce or
// complaint always wins.
async function writeContacts({ accountId, newsletterId, contacts, source, importId }) {
	if (contacts.length === 0) return { created: 0, existing: 0 };
	const result = await Contact.bulkWrite(getContactWrites({ accountId, newsletterId, contacts, source, importId }), {
		ordered: false,
	});

	const changes = getStatusChanges(contacts);
	for (const { status, emails, replaces } of changes) {
		await Contact.updateMany(
			{ accountId, newsletterId, email: { $in: emails }, status: { $in: replaces } },
			{ $set: { status, ...(status === "unsubscribed" && { unsubscribedAt: new Date() }) } }
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
	const checked = checkImportRows(rows, account.contactFields ?? []);
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

	const written = await writeContacts({ accountId: account._id, newsletterId, contacts, source: "import", importId });
	return { rows: rows.length, ...written, dropped };
}
