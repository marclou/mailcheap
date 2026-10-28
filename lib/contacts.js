import crypto from "node:crypto";
import { Types } from "mongoose";
import { scoped } from "@/lib/account-scope";
import { withEngagement } from "@/lib/cleanup";
import { getAppSecret } from "@/lib/config";
import { checkFieldDefinition } from "@/lib/contact-fields";
import { getStatusChangeProblem, needsConsent } from "@/lib/contact-status";
import { getDomainLists } from "@/lib/domain-lists";
import { classifyDomain } from "@/lib/domain-reputation";
import { UNDELIVERABLE_MESSAGE, findGloballySuppressed } from "@/lib/global-suppressions";
import { getSignupEmailProblem } from "@/lib/import-checks";
import { findDomainsWithoutMail } from "@/lib/mail-domains";
import { moveContact, withStatusChange } from "@/lib/status-changes";
import { resubscribeContactQuietly } from "@/lib/tenants";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import Account from "@/models/Account";
import Contact, { CONTACT_STATUSES } from "@/models/Contact";
import DeletedContact from "@/models/DeletedContact";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

export const CONTACTS_PAGE_SIZE = 50;
export const MAX_LISTED_SOURCES = 100;
const FINAL_STATUSES = ["unsubscribed", "bounced", "complained"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Signup forms, add_contact and MCP, for one normalized address: what to tell the person typing it, or null. A listed
// address gets the same words whichever account's email listed it, its own included, and so does a spam domain, so
// neither list can be probed through a form.
export async function getSignupProblem(email) {
	const problem = getSignupEmailProblem(email);
	if (problem) return problem;
	const domain = email.split("@")[1];
	if (classifyDomain(domain, await getDomainLists()) === "spam") return UNDELIVERABLE_MESSAGE;
	if ((await findGloballySuppressed([email])).size > 0) return UNDELIVERABLE_MESSAGE;
	const withoutMail = await findDomainsWithoutMail([domain]);
	return withoutMail.size > 0 ? "This email's domain can't receive email" : null;
}

// An account's newsletters in creation order with their active contacts, counted from the index in the
// same round trip. Without their content checks, which an aggregation would otherwise return (select: false).
export function listNewslettersWithActiveCounts(account, fields) {
	return Newsletter.aggregate([
		{ $match: scoped(account) },
		{ $sort: { createdAt: 1, _id: 1 } },
		...(fields ? [{ $project: Object.fromEntries(fields.split(" ").map((field) => [field, 1])) }] : []),
		{
			$lookup: {
				from: Contact.collection.collectionName,
				localField: "_id",
				foreignField: "newsletterId",
				pipeline: [{ $match: { status: "active" } }, { $count: "count" }],
				as: "active",
			},
		},
		{ $set: { activeCount: { $ifNull: [{ $first: "$active.count" }, 0] } } },
		{ $unset: ["active", "reviews"] },
	]);
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// What a search matches: its text anywhere in an address or a name, where * stands for any characters, as in
// *@example.com or jane*@example.com. null when there's nothing to look for. Each part only has to come after the one
// before, so the first place it fits is as good as any: atomic groups keep MongoDB from backtracking through every
// other, which grows with the address's length to the power of the number of *.
function toSearchPattern(query) {
	const parts = String(query ?? "").toLowerCase().split("*").filter(Boolean).map(escapeRegex);
	if (parts.length < 2) return parts[0] ?? null;
	return `^${parts.map((part) => `(?>.*?${part})`).join("")}`;
}

// A YYYY-MM-DD day as its midnight UTC, or null for anything else.
export function readDay(value) {
	if (typeof value !== "string" || !DAY_PATTERN.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

// The contacts list's filters: a newsletter, a search in the email address, a tag, where they came from, and when they
// signed up: since that day's start, before another's.
export function contactSearchFilter(account, { newsletterId, query, tag, source, signedUpSince, signedUpBefore }) {
	const pattern = toSearchPattern(query);
	return scoped(account, {
		...(newsletterId && { newsletterId: new Types.ObjectId(String(newsletterId)) }),
		...(pattern && { email: { $regex: pattern } }),
		...(tag && { tags: tag }),
		...(source && { source }),
		...((signedUpSince || signedUpBefore) && {
			subscribedAt: { ...(signedUpSince && { $gte: signedUpSince }), ...(signedUpBefore && { $lt: signedUpBefore }) },
		}),
	});
}

// The contacts a list, its counts, a bulk tag change and an export pick, built the same way for each so what an export
// counts is what its file holds. A segment's filter (lib/segment-queries.js) joins under $and: it only ever narrows.
export function contactListFilter(account, { status, segmentFilter = null, ...search }) {
	const filter = contactSearchFilter(account, search);
	const segment = segmentFilter ? [...(segmentFilter.newsletterId ? [{ newsletterId: segmentFilter.newsletterId }] : []), ...segmentFilter.$and] : [];
	return {
		...filter,
		...(segment.length > 0 && { $and: [...(filter.$and ?? []), ...segment] }),
		...(status && { status }),
	};
}

// What a picker offers as it's typed in: the contacts with the text in their address or first name, in any case, newest
// signups first. Without text, the newest.
export function findContactsMatching(account, { newsletterId, status, query, limit }) {
	const pattern = toSearchPattern(query);
	return Contact.find(
		scoped(account, {
			...(newsletterId && { newsletterId: new Types.ObjectId(String(newsletterId)) }),
			...(status && { status }),
			...(pattern && { $or: [{ email: { $regex: pattern } }, { firstName: { $regex: pattern, $options: "i" } }] }),
		})
	)
		.sort({ subscribedAt: -1, _id: -1 })
		.limit(limit)
		.lean();
}

// One of a newsletter's contacts, by ID or address.
export function findNewsletterContact(account, newsletterId, reference) {
	const value = String(reference ?? "").trim().toLowerCase();
	const filter = isObjectIdString(value) ? { _id: value } : { email: normalizeEmail(value) ?? value };
	return Contact.findOne(scoped(account, { newsletterId, ...filter })).lean();
}

export function countContactsByStatus(baseFilter) {
	return Promise.all(CONTACT_STATUSES.map((key) => Contact.countDocuments({ ...baseFilter, status: key }))).then((counts) =>
		Object.fromEntries(CONTACT_STATUSES.map((key, index) => [key, counts[index]]))
	);
}

// One page of the contacts list, newest first, with the list's filters (contactListFilter) and within a segment's when
// one is given (lib/segment-queries.js). One count per status reads only the status indexes; grouping the contacts would
// read every one.
export async function findContactsPage(account, { status, page = 1, ...filters }) {
	const baseFilter = contactListFilter(account, filters);
	const filter = { ...baseFilter, ...(status && { status }) };
	const [statusCounts, contacts] = await Promise.all([
		Promise.all(CONTACT_STATUSES.map((key) => Contact.countDocuments({ ...baseFilter, status: key }))),
		Contact.find(filter)
			.sort({ subscribedAt: -1, _id: -1 })
			.skip((page - 1) * CONTACTS_PAGE_SIZE)
			.limit(CONTACTS_PAGE_SIZE)
			.lean(),
	]);
	const counts = Object.fromEntries(CONTACT_STATUSES.map((key, index) => [key, statusCounts[index]]));
	const totalAll = statusCounts.reduce((sum, count) => sum + count, 0);
	return { contacts, counts, totalAll, total: status ? counts[status] || 0 : totalAll };
}

// Keyed like lib/deletion-records.js, since a plain hash of an email is easy to reverse with a list of emails, and
// salted with the newsletter, so one person's hashes don't match across newsletters.
function getDeletedEmailKey() {
	return Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", "mailcheap-deleted-contact-v1", 32));
}

function hashDeletedEmail(key, newsletterId, email) {
	return crypto.createHmac("sha256", key).update(`${newsletterId}:${email}`).digest("base64url");
}

// The status each address had when it was deleted from the newsletter, for those deleted after they left.
export async function findDeletedStatuses({ accountId, newsletterId, emails }) {
	if (emails.length === 0) return new Map();
	const key = getDeletedEmailKey();
	const emailsByHash = new Map(emails.map((email) => [hashDeletedEmail(key, newsletterId, email), email]));
	const deleted = await DeletedContact.find({ accountId, newsletterId, emailHash: { $in: [...emailsByHash.keys()] } })
		.select({ emailHash: 1, status: 1 })
		.lean();
	return new Map(deleted.map(({ emailHash, status }) => [emailsByHash.get(emailHash), status]));
}

// A contact who unsubscribed, bounced or complained leaves its status behind, so its address added again is never
// emailed; any other can sign up again like anyone. False when the contact changed since it was read.
export async function removeContact(account, contact) {
	if (FINAL_STATUSES.includes(contact.status)) {
		const emailHash = hashDeletedEmail(getDeletedEmailKey(), contact.newsletterId, contact.email);
		await DeletedContact.updateOne(
			scoped(account, { newsletterId: contact.newsletterId, emailHash }),
			{ $set: { status: contact.status } },
			{ upsert: true }
		);
	}
	// Only as it was read: an unsubscribe landing in between would leave nothing behind.
	const { deletedCount } = await Contact.deleteOne(scoped(account, { _id: contact._id, status: contact.status }));
	return deletedCount === 1;
}

export const MAX_DELETED_AT_ONCE = 5000;

// The contacts a filter of the account picks, MAX_DELETED_AT_ONCE at most, each the way removeContact deletes one.
// remaining: the contacts the filter still picks afterwards, for the next call.
export async function removeContacts(account, filter) {
	const contacts = await Contact.find(filter).select({ newsletterId: 1, email: 1, status: 1 }).limit(MAX_DELETED_AT_ONCE).lean();
	const left = contacts.filter(({ status }) => FINAL_STATUSES.includes(status));
	if (left.length > 0) {
		const key = getDeletedEmailKey();
		await DeletedContact.bulkWrite(
			left.map(({ newsletterId, email, status }) => ({
				updateOne: {
					filter: scoped(account, { newsletterId, emailHash: hashDeletedEmail(key, newsletterId, email) }),
					update: { $set: { status } },
					upsert: true,
				},
			})),
			{ ordered: false }
		);
	}
	let deleted = 0;
	for (const [status, group] of Map.groupBy(contacts, (contact) => contact.status)) {
		const { deletedCount } = await Contact.deleteMany(scoped(account, { _id: { $in: group.map(({ _id }) => _id) }, status }));
		deleted += deletedCount;
	}
	return { deleted, remaining: await Contact.countDocuments(filter) };
}

// Only an explicit resubscribe reverses an opt-out; bounces, complaints and a deleted contact's status never reverse.
const REACTIVATABLE_STATUSES = ["unsubscribed", "dormant"];
const SUPPRESSED_STATUSES = { bounce: "bounced", complaint: "complained", manual: "unsubscribed" };

// consent: a dashboard user's word that the person agreed, which stands in for the confirmation email. profile: a first
// name, tags and field values (checked, lib/contact-fields.js) from the form or the caller. Signing up again only fills
// in what the contact doesn't have and adds tags: a form can't rename someone. country: the visitor's (lib/countries.js),
// for a new contact only, since anyone can type someone else's address in a form.
export async function upsertContact({ newsletter, email, source, resubscribe, consent, profile = {}, country = null }) {
	const { accountId } = newsletter;
	const joinStatus = newsletter.requireConfirmation && !consent ? "pending" : "active";
	const [suppression, deletedStatuses] = await Promise.all([
		Suppression.findOne({ accountId, email }).select({ reason: 1 }).lean(),
		findDeletedStatuses({ accountId, newsletterId: newsletter._id, emails: [email] }),
	]);
	const deletedStatus = deletedStatuses.get(email);
	const status = suppression ? (SUPPRESSED_STATUSES[suppression.reason] ?? "unsubscribed") : (deletedStatus ?? joinStatus);
	const now = new Date();
	const fieldValues = Object.entries(profile.fields ?? {}).filter(([, value]) => value !== null);
	const result = await Contact.findOneAndUpdate(
		{ accountId, newsletterId: newsletter._id, email },
		{
			$setOnInsert: {
				status,
				source,
				subscribedAt: now,
				...(consent && { consent }),
				...(country && { country }),
				...(profile.firstName && { firstName: profile.firstName }),
				...(profile.tags?.length && { tags: profile.tags }),
				...(fieldValues.length > 0 && { fields: Object.fromEntries(fieldValues) }),
			},
		},
		{ upsert: true, returnDocument: "after", includeResultMetadata: true }
	).lean();
	const created = !result.lastErrorObject?.updatedExisting;
	let contact = result.value;
	if (!created) contact = await fillMissingProfile(contact, profile);

	if (created) {
		// An unsubscribe reaches every newsletter of the account, at the provider too: joining another one lifts it there.
		const isBack = !suppression && !deletedStatus && (await Contact.exists({ accountId, email, status: "unsubscribed", _id: { $ne: contact._id } }));
		if (isBack) await resubscribeContactQuietly({ accountId, email });
		return { contact, created };
	}
	if (!resubscribe || suppression || deletedStatus) return { contact, created };
	// Signing up again is a sign of life, and brings back a contact who left or went dormant.
	if (contact.status === "active") {
		await Contact.updateOne({ accountId, _id: contact._id }, withEngagement());
		return { contact, created };
	}
	if (!REACTIVATABLE_STATUSES.includes(contact.status)) return { contact, created };
	const at = new Date();
	const reactivated = await moveContact(
		{ accountId, _id: contact._id },
		{
			from: REACTIVATABLE_STATUSES,
			to: joinStatus,
			via: "signup",
			source,
			at,
			update: withEngagement({ $set: { subscribedAt: at }, $unset: { unsubscribedAt: 1 } }, at),
			options: { returnDocument: "after" },
		}
	);
	if (reactivated && contact.status === "unsubscribed") await resubscribeContactQuietly({ accountId, email });
	return { contact: reactivated ?? contact, created };
}

// A first name and field values the contact doesn't have yet, and tags it doesn't have; the contact as it is then.
async function fillMissingProfile(contact, { firstName, tags = [], fields = {} }) {
	const set = {
		...(firstName && !contact.firstName && { firstName }),
		...Object.fromEntries(
			Object.entries(fields)
				.filter(([key, value]) => value !== null && (contact.fields?.[key] ?? null) === null)
				.map(([key, value]) => [`fields.${key}`, value])
		),
	};
	const newTags = tags.filter((tag) => !contact.tags?.includes(tag));
	if (Object.keys(set).length === 0 && newTags.length === 0) return contact;
	return (
		(await Contact.findOneAndUpdate(
			{ accountId: contact.accountId, _id: contact._id },
			{ ...(Object.keys(set).length > 0 && { $set: set }), ...(newTags.length > 0 && { $addToSet: { tags: { $each: newTags } } }) },
			{ returnDocument: "after" }
		).lean()) ?? contact
	);
}

// The dashboard's contact sheet, update_contact: a first name ("" removes it), field values by key (null removes one)
// and tags, which replace the contact's own when given.
export async function updateContactDetails(account, contact, { firstName, fields = {}, tags }) {
	const set = {};
	const unset = {};
	if (firstName !== undefined) {
		if (firstName) set.firstName = firstName;
		else unset.firstName = 1;
	}
	for (const [key, value] of Object.entries(fields)) {
		if (value === null) unset[`fields.${key}`] = 1;
		else set[`fields.${key}`] = value;
	}
	if (tags !== undefined) {
		if (tags.length > 0) set.tags = tags;
		else unset.tags = 1;
	}
	if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) return contact;
	return Contact.findOneAndUpdate(
		scoped(account, { _id: contact._id }),
		{ ...(Object.keys(set).length > 0 && { $set: set }), ...(Object.keys(unset).length > 0 && { $unset: unset }) },
		{ returnDocument: "after" }
	).lean();
}

// Adds tags to some of the account's contacts, or takes them off: how many it matched and changed. The contacts are
// given by ID, or by a filter like the contacts list's (contactSearchFilter, a segment, a status).
export async function changeContactTags(account, { contactIds, filter, add = [], remove = [] }) {
	const where = scoped(account, filter ?? { _id: { $in: contactIds } });
	const isAdding = add.length > 0;
	// Only the contacts the change is for, as updatedAt would count every contact found as changed. The account stays at
	// the top, where lib/account-scope.js looks for it.
	const narrowed = (condition) => ({ accountId: where.accountId, $and: [where, condition] });
	const update = isAdding ? { $addToSet: { tags: { $each: add } } } : { $pull: { tags: { $in: remove } } };
	// Counted first: a filter on the tag being taken off would no longer find them after.
	const matched = await Contact.countDocuments(where);
	const { modifiedCount } = await Contact.updateMany(narrowed(isAdding ? { tags: { $not: { $all: add } } } : { tags: { $in: remove } }), update);
	// Taking a contact's last tag off leaves an empty list, which reads like no tags anywhere. The filter may have been on
	// that tag, so it no longer finds them: every empty list of the newsletter goes.
	if (!isAdding && modifiedCount > 0) {
		await Contact.updateMany(
			{ accountId: where.accountId, ...(where.newsletterId && { newsletterId: where.newsletterId }), tags: { $size: 0 } },
			{ $unset: { tags: 1 } }
		);
	}
	return { matched, changed: modifiedCount };
}

// A new field for the account's contacts, at the end of its list, or what's wrong with it.
export async function addContactField(account, input) {
	const { field, problem } = checkFieldDefinition(input, account.contactFields ?? []);
	if (problem) return { problem };
	const { matchedCount } = await Account.updateOne(
		{ _id: account._id, "contactFields.key": { $ne: field.key } },
		{ $push: { contactFields: { ...field, createdAt: new Date() } } }
	);
	return matchedCount ? { field } : { problem: `There's already a field called "${field.label}"` };
}

// The field goes from the account's list; contacts keep their values, which come back if it's added again.
export async function removeContactField(account, key) {
	const { modifiedCount } = await Account.updateOne({ _id: account._id }, { $pull: { contactFields: { key } } });
	return modifiedCount > 0;
}

export const MAX_LISTED_TAGS = 200;

// The tags a newsletter's contacts have (the account's without one), most used first, with how many contacts have each.
export async function listContactTags(account, newsletterId = null) {
	const rows = await Contact.aggregate([
		{ $match: scoped(account, { ...(newsletterId && { newsletterId: new Types.ObjectId(String(newsletterId)) }), tags: { $exists: true } }) },
		{ $unwind: "$tags" },
		{ $group: { _id: "$tags", contacts: { $sum: 1 } } },
		{ $sort: { contacts: -1, _id: 1 } },
		{ $limit: MAX_LISTED_TAGS },
	]);
	return rows.map(({ _id, contacts }) => ({ name: _id, contacts }));
}

// Where a newsletter's contacts came from (the account's without one), most first, with how many each: website, embed,
// import, dashboard, api, or a source an API caller gave.
export async function listContactSources(account, newsletterId = null) {
	const rows = await Contact.aggregate([
		{ $match: scoped(account, { ...(newsletterId && { newsletterId: new Types.ObjectId(String(newsletterId)) }), source: { $type: "string" } }) },
		{ $group: { _id: "$source", contacts: { $sum: 1 } } },
		{ $sort: { contacts: -1, _id: 1 } },
		{ $limit: MAX_LISTED_SOURCES },
	]);
	return rows.map(({ _id, contacts }) => ({ name: _id, contacts }));
}

// The click on the confirmation link. A contact that already confirmed stays as it is. country: the browser's that
// confirmed, which only the address's owner can do, over the signup form's.
export async function confirmContact({ accountId, contactId, newsletterId, country = null }) {
	const at = new Date();
	const confirmed = await Contact.findOneAndUpdate(
		{ accountId, _id: contactId, newsletterId, status: "pending" },
		withStatusChange(withEngagement({ $set: { confirmedAt: at, ...(country && { country }) } }, at), {
			from: "pending",
			to: "active",
			at,
			via: "confirmation",
		}),
		{ returnDocument: "after" }
	).lean();
	if (confirmed) return { contact: confirmed, confirmed: true };
	const contact = await Contact.findOne({ accountId, _id: contactId, newsletterId }).lean();
	return { contact, confirmed: false };
}

const SUPPRESSED_MESSAGES = {
	bounce: "Their address bounced, so it can't be emailed again",
	complaint: "They marked an email as spam, so they can't be emailed again",
	provider: "The email provider refused this address, so it can't be emailed again",
	manual: "This address is on your account's do-not-email list",
};

// A status set by hand or through the API and MCP, as lib/contact-status.js allows it. Back to active, the list
// cleanup starts over, and an address the account or MailCheap won't email stays where it is. Only as it was read,
// so a bounce or an unsubscribe landing in between isn't overwritten. actor: { via, userId, apiKeyId, connectionId }.
export async function changeContactStatus({ account, contact, status, consent, actor }) {
	const from = contact.status;
	if (from === status) return { contact };
	const problem = getStatusChangeProblem({ from, to: status, consent, reason: contact.undeliverableReason });
	if (problem) return { problem };
	if (status === "active") {
		const [suppression, globallySuppressed] = await Promise.all([
			Suppression.findOne(scoped(account, { email: contact.email })).select({ reason: 1 }).lean(),
			findGloballySuppressed([contact.email]),
		]);
		if (globallySuppressed.size > 0) return { problem: { code: "conflict", message: UNDELIVERABLE_MESSAGE } };
		if (suppression) return { problem: { code: "conflict", message: SUPPRESSED_MESSAGES[suppression.reason] ?? SUPPRESSED_MESSAGES.manual } };
	}
	const at = new Date();
	const change = {
		from,
		to: status,
		at,
		via: actor.via,
		...(actor.userId && { userId: actor.userId }),
		...(actor.apiKeyId && { apiKeyId: actor.apiKeyId }),
		...(actor.connectionId && { connectionId: actor.connectionId }),
		...(needsConsent(from, status) && { consent: true }),
	};
	const updated = await Contact.findOneAndUpdate(
		scoped(account, { _id: contact._id, status: from }),
		withStatusChange(getStatusUpdate(from, status, at), change),
		{ returnDocument: "after" }
	).lean();
	if (!updated) return { problem: { code: "conflict", message: "This contact just changed, try again" } };
	if (from === "unsubscribed") await resubscribeContactQuietly({ accountId: updated.accountId, email: updated.email });
	return { contact: updated };
}

function getStatusUpdate(from, to, at) {
	if (to === "unsubscribed") return { $set: { unsubscribedAt: at } };
	if (to === "dormant") return {};
	// Like signing up again, or clicking the confirmation email.
	if (from === "unsubscribed") return withEngagement({ $set: { subscribedAt: at }, $unset: { unsubscribedAt: 1 } }, at);
	if (from === "pending") return withEngagement({ $set: { confirmedAt: at } }, at);
	return withEngagement({}, at);
}

// The "Yes, keep sending it" click in the last-chance email. It also brings back a contact who went
// dormant; unsubscribes, bounces and complaints stay as they are.
export async function keepContact({ accountId, contactId, newsletterId }) {
	const contact = await Contact.findOne({ accountId, _id: contactId, newsletterId })
		.select({ email: 1, status: 1 })
		.lean();
	if (!contact || !["active", "dormant"].includes(contact.status)) return null;
	if (contact.status === "dormant" && (await Suppression.exists({ accountId, email: contact.email }))) return null;
	const at = new Date();
	const update = withEngagement({}, at);
	const kept = await moveContact(
		{ accountId, _id: contact._id },
		{ from: ["dormant"], to: "active", via: "keep", at, update, options: { returnDocument: "after" } }
	);
	return kept ?? Contact.findOneAndUpdate({ accountId, _id: contact._id, status: "active" }, update, { returnDocument: "after" }).lean();
}
