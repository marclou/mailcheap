import "server-only";
import { after } from "next/server";
import * as z from "zod";
import { scoped } from "@/lib/account-scope";
import { ERROR_CODES, hasActiveSubscription } from "@/lib/account-state";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import { afterCursor, dateOutput, encodeCursor, findNewsletter, newsletterFilterInput, newsletterInput, toIso } from "@/lib/actions/shared";
import { sendAlert } from "@/lib/alerts";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import {
	FIELD_TYPE_IDS,
	MAX_CONTACT_FIELDS,
	MAX_FIELD_LABEL,
	MAX_TAGS,
	cleanFirstName,
	cleanTag,
	cleanTags,
	contactFieldValues,
	readFieldValues,
} from "@/lib/contact-fields";
import { SETTABLE_STATUSES } from "@/lib/contact-status";
import {
	addContactField,
	changeContactStatus,
	changeContactTags,
	contactSearchFilter,
	countContactsByStatus,
	getSignupProblem,
	listContactTags,
	removeContact,
	removeContactField,
	updateContactDetails,
	upsertContact,
} from "@/lib/contacts";
import { MAX_IMPORT_ROWS, MAX_IMPORT_ROWS_PER_REQUEST, STATUS_RANK } from "@/lib/csv-import";
import { createExportToken } from "@/lib/export-token";
import { formatNumber, formatWindow } from "@/lib/format";
import { CONSENT_TEXT, DROP_REASONS } from "@/lib/import-checks";
import { addImportRows, getImport, listImports, startImport, toImportView } from "@/lib/import-jobs";
import { getInbox } from "@/lib/inbox-links";
import { isRateLimited } from "@/lib/rate-limit";
import { findSegmentListFilter } from "@/lib/segment-queries";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import Contact, { CONTACT_STATUSES } from "@/models/Contact";
import Segment from "@/models/Segment";

const GROUP = "Contacts";
// Each signup can send a welcome email, so a leaked key or a form without its own limit must not be
// able to flood the list. Sites that pass their visitor's IP get the archive form's per-visitor limit.
const SIGNUPS_PER_KEY = { name: "api-contacts-key", limit: 600, window: "1 h" };
const SIGNUPS_PER_VISITOR = { name: "api-contacts-ip", limit: 5, window: "10 m" };
// And an account gets a key's signups across all its keys, connected apps and contacts added by hand, who get the
// welcome email too.
const SIGNUPS_PER_ACCOUNT = { ...SIGNUPS_PER_KEY, name: "account-signups" };
// Enough to add yourself and try the dashboard without a plan, not enough to build a list for free.
export const TRIAL_CONTACTS = { name: "contact-trial", limit: 3, window: "1 d" };
const IP_PATTERN = /^[0-9a-f.:]{3,45}$/i;
const SORT = { subscribedAt: -1, _id: -1 };

const contactReference = z.string().trim().min(1).max(320).describe("The contact's ID or email address");
const contactNewsletterInput = newsletterFilterInput.describe(
	"The newsletter's ID or slug, needed for an email address that is a contact of several newsletters"
);
const searchInput = z.string().trim().toLowerCase().max(254).optional().describe("Contacts whose email starts with this");
const statusInput = z.enum(CONTACT_STATUSES).optional().describe("Only contacts with this status");
const tagFilterInput = z.string().trim().max(100).optional().describe("Only contacts with this tag");
const firstNameInput = z
	.string()
	.max(200)
	.nullable()
	.optional()
	.describe('The first name {{first_name}} prints in emails. null or "" removes it.');
const tagsInput = z
	.array(z.string().max(100))
	.max(MAX_TAGS)
	.optional()
	.describe(`Labels, ${MAX_TAGS} at most. Tags are lowercase: "VIP" is saved as "vip". No commas.`);
const fieldsInput = z
	.record(z.string(), z.union([z.string(), z.number(), z.null()]))
	.optional()
	.describe("Values for the account's own fields, by key (list_contact_fields): text, a number, or YYYY-MM-DD for a date. null removes one.");
const segmentInput = z
	.string()
	.trim()
	.max(100)
	.optional()
	.describe(
		"Only the contacts a segment picks (its ID, from list_segments), whatever their status unless status is given. With newsletter, one of that newsletter's segments."
	);

// The filter of a segment the account has, or not_found. With a newsletter asked for too, the segment has to be one of
// its own, as on campaigns: another newsletter's would pick by conditions written for a different list.
async function readSegmentFilter(account, id, newsletter) {
	if (!id) return null;
	const filter = await findSegmentListFilter(account, id);
	if (!filter) throw actionError("not_found", "Segment not found");
	if (newsletter && !filter.newsletterId.equals(newsletter._id)) throw actionError("validation_failed", "segment: it belongs to another newsletter");
	return filter;
}

const ContactSchema = z.object({
	id: z.string(),
	newsletterId: z.string(),
	email: z.string(),
	status: z
		.enum(CONTACT_STATUSES)
		.describe(
			"active: gets issues. pending: hasn't confirmed yet. dormant: gets no issues, stopped by the list cleanup or by hand; back if they sign up again or are made active. unsubscribed: gets nothing; back if they sign up again or are resubscribed with their consent. bounced, complained: final. bounced also covers a contact a send skipped because MailCheap knows the address can't receive email."
		),
	source: z.string().nullable(),
	sourceDomain: z.string().nullable().describe("The site whose signup form they used, for the source embed"),
	firstName: z.string().nullable().describe("What {{first_name}} prints in its emails"),
	tags: z.array(z.string()),
	fields: z
		.record(z.string(), z.union([z.string(), z.number()]))
		.describe("Its values for the account's own fields, by key (list_contact_fields). Dates are YYYY-MM-DD."),
	subscribedAt: dateOutput,
	confirmedAt: dateOutput,
	unsubscribedAt: dateOutput,
	lastSentAt: dateOutput,
	lastOpenAt: dateOutput,
	lastClickAt: dateOutput,
	stats: z.object({ sent: z.number().int(), opens: z.number().int(), clicks: z.number().int() }),
	createdAt: dateOutput,
});

const FieldSchema = z.object({
	key: z.string().describe("What the API, segments (fields.<key>) and CSV columns call it"),
	label: z.string(),
	type: z.enum(FIELD_TYPE_IDS),
});

function toContact(contact, account) {
	return {
		id: String(contact._id),
		newsletterId: String(contact.newsletterId),
		email: contact.email,
		status: contact.status,
		source: contact.source ?? null,
		sourceDomain: contact.sourceDomain ?? null,
		firstName: contact.firstName || null,
		tags: contact.tags ?? [],
		fields: contactFieldValues(contact, account.contactFields ?? []),
		subscribedAt: toIso(contact.subscribedAt),
		confirmedAt: toIso(contact.confirmedAt),
		unsubscribedAt: toIso(contact.unsubscribedAt),
		lastSentAt: toIso(contact.lastSentAt),
		lastOpenAt: toIso(contact.lastOpenAt),
		lastClickAt: toIso(contact.lastClickAt),
		stats: { sent: contact.stats?.sent ?? 0, opens: contact.stats?.opens ?? 0, clicks: contact.stats?.clicks ?? 0 },
		createdAt: toIso(contact.createdAt),
	};
}

// The tag a list or an export filters on, as saved: one that can't be a tag matches no contact.
function readTagFilter(value) {
	return value ? (cleanTag(value) ?? value) : undefined;
}

// A first name, tags and field values as given, checked against the account's fields. Only what's given is in it.
function readProfile(account, { firstName, tags, fields }) {
	const read = readFieldValues(fields, account.contactFields ?? []);
	if (read.problem) throw actionError("validation_failed", read.problem);
	const badTag = tags?.find((tag) => !cleanTag(tag));
	if (badTag !== undefined) throw actionError("validation_failed", `tags: "${badTag}" isn't a tag (40 characters at most, no commas)`);
	return {
		...(firstName !== undefined && { firstName: cleanFirstName(firstName) }),
		...(tags !== undefined && { tags: cleanTags(tags) }),
		fields: read.values,
	};
}

// By ID or by address; an address in several newsletters needs the newsletter.
async function findContact(account, reference, newsletterReference) {
	const value = reference.toLowerCase();
	const newsletter = newsletterReference ? await findNewsletter(account, newsletterReference, { _id: 1 }) : null;
	const filter = isObjectIdString(value) ? { _id: value } : { email: normalizeEmail(value) ?? value };
	const [contact, other] = await Contact.find(scoped(account, { ...filter, ...(newsletter && { newsletterId: newsletter._id }) }))
		.sort({ createdAt: 1 })
		.limit(2)
		.lean();
	if (!contact) throw actionError("not_found", "Contact not found");
	if (other) throw actionError("validation_failed", "newsletter is required: this address is a contact of several newsletters");
	return contact;
}

// The key's and the visitor's limits first: a flood they stop doesn't use up the account's signups.
async function signupLimitProblem({ account, apiKey, connection, ip, via }) {
	const caller = apiKey ? String(apiKey._id) : connection && `oauth-${connection.id}`;
	if (apiKey && (await isRateLimited({ ...SIGNUPS_PER_KEY, key: caller }))) {
		await sendAlert({
			accountId: account._id,
			key: `api-signup-flood:${caller}`,
			title: "API signups paused",
			detail: `The "${apiKey.name}" key sent over ${SIGNUPS_PER_KEY.limit} signups in an hour. New ones are refused until it slows down. If that isn't your site, revoke the key.`,
			path: "/api-keys",
		});
		return "Too many signups, try again later";
	}
	if (caller && ip && (await isRateLimited({ ...SIGNUPS_PER_VISITOR, key: `${caller}:${ip}` }))) {
		return "Too many signups from this visitor, try again later";
	}
	if (!(await isRateLimited({ ...SIGNUPS_PER_ACCOUNT, key: String(account._id) }))) return null;
	if (via === "dashboard") return `You can add ${formatNumber(SIGNUPS_PER_ACCOUNT.limit)} contacts ${formatWindow(SIGNUPS_PER_ACCOUNT.window)}. Try again later.`;
	await sendAlert({
		accountId: account._id,
		key: "account-signup-flood",
		title: "Signups paused",
		detail: `Your API keys, connected apps and the dashboard added over ${SIGNUPS_PER_ACCOUNT.limit} contacts in an hour. New signups are refused until it slows down. If that isn't you, revoke the key or app on the API keys page.`,
		path: "/api-keys",
	});
	return "Too many signups on this account, try again later";
}

const listContacts = defineAction({
	name: "list_contacts",
	tryWithoutPlan: true,
	title: "List contacts",
	group: GROUP,
	description:
		"Lists contacts, newest signups first, 50 a page, with their first name, tags and field values. Filter by newsletter, status, segment, tag or the start of the email address; pass nextCursor back as cursor for the next page. counts has every status for the same filters.",
	http: { method: "GET", path: "/contacts" },
	readOnly: true,
	example: { status: "active", search: "jane" },
	input: z.object({
		newsletter: newsletterFilterInput,
		status: statusInput,
		segment: segmentInput,
		tag: tagFilterInput,
		search: searchInput,
		limit: z.number().int().min(1).max(100).optional().describe("Contacts per page, 50 by default, 100 at most"),
		cursor: z.string().max(200).optional().describe("nextCursor from the previous page"),
	}),
	output: z.object({
		contacts: z.array(ContactSchema),
		nextCursor: z.string().nullable().describe("null on the last page"),
		counts: z.object(Object.fromEntries(CONTACT_STATUSES.map((status) => [status, z.number().int()]))),
	}),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		const limit = input.limit ?? 50;
		const baseFilter = {
			...(await readSegmentFilter(account, input.segment, newsletter)),
			...contactSearchFilter(account, { newsletterId: newsletter?._id, query: input.search, tag: readTagFilter(input.tag) }),
		};
		const filter = {
			...baseFilter,
			...(input.status && { status: input.status }),
			...(input.cursor && afterCursor(input.cursor, "subscribedAt")),
		};
		const [contacts, counts] = await Promise.all([
			Contact.find(filter).sort(SORT).limit(limit + 1).lean(),
			countContactsByStatus(baseFilter),
		]);
		const page = contacts.slice(0, limit);
		const last = page.at(-1);
		return {
			contacts: page.map((contact) => toContact(contact, account)),
			nextCursor: contacts.length > limit ? encodeCursor(last.subscribedAt, last._id) : null,
			counts,
		};
	},
});

const getContact = defineAction({
	name: "get_contact",
	tryWithoutPlan: true,
	title: "Get a contact",
	group: GROUP,
	description: "Gets one contact by ID or email address, with its status, first name, tags, field values, dates and engagement.",
	http: { method: "GET", path: "/contacts/{id}" },
	readOnly: true,
	input: z.object({ id: contactReference, newsletter: contactNewsletterInput }),
	output: ContactSchema,
	handler: async ({ account, input }) => toContact(await findContact(account, input.id, input.newsletter), account),
});

const addContact = defineAction({
	name: "add_contact",
	tryWithoutPlan: true,
	title: "Add a contact",
	group: GROUP,
	description:
		"Signs someone up, like the archive's form: they get the welcome email, or the confirmation email when the newsletter asks new subscribers to confirm. Signing up again keeps the contact as it is unless resubscribe is true. Works with signups only keys, for website forms. Signups and confirmation emails keep coming in over the plan's limits; welcome emails count toward the month's emails and are skipped once they're used up, never sent later (get_billing's usage.welcomeEmailsPaused). A misspelled domain (gmial.com) answers validation_failed with the address it was likely meant to be; spam trap addresses, domains that can't receive email, and addresses MailCheap knows can't receive email (they hard bounced or hit a spam trap, from any sender on MailCheap) answer validation_failed too.",
	http: { method: "POST", path: "/contacts", status: (output) => (output.created ? 201 : 200) },
	permission: "signups",
	openWorld: true,
	example: { email: "jane@example.com", source: "website" },
	input: z.object({
		newsletter: newsletterInput,
		email: z.string().trim().max(320).describe("The subscriber's email address"),
		firstName: firstNameInput.describe(
			"Their first name, which {{first_name}} prints in emails. For a contact who signs up again, only saved if they had none."
		),
		tags: tagsInput.describe("Tags to add, lowercase, no commas. A contact who signs up again keeps theirs and gets these too."),
		fields: fieldsInput.describe(
			"Values for the account's own fields, by key (list_contact_fields). For a contact who signs up again, only the ones they had no value for."
		),
		source: z.string().trim().max(100).optional().describe("Where they signed up, e.g. website. Default: api."),
		resubscribe: z
			.boolean()
			.optional()
			.describe(
				"Bring back a contact who unsubscribed or went dormant. Bounced and complained addresses never come back, nor does a contact deleted after it unsubscribed."
			),
		ip: z.string().trim().max(45).optional().describe("The visitor's IP address: one visitor gets 5 signups in 10 minutes"),
	}),
	// Add contact's "This person agreed to get my emails" box: added by hand, they skip the confirmation email.
	dashboardInput: z.object({ consent: z.boolean().optional() }),
	output: z.object({
		id: z.string(),
		email: z.string(),
		newsletterId: z.string(),
		status: z.enum(CONTACT_STATUSES),
		created: z.boolean().describe("False when the address was already a contact"),
		inbox: z
			.object({ name: z.string(), url: z.string() })
			.nullable()
			.describe("For pending contacts on a known webmail: a link for a \"check your inbox\" button"),
	}),
	handler: async ({ account, user, apiKey, connection, input, via }) => {
		const isByHand = via === "dashboard";
		if (isByHand && input.consent !== true) throw actionError("validation_failed", "Check that this person agreed to get your emails");
		const email = normalizeEmail(input.email);
		if (!email) throw actionError("validation_failed", "email is invalid");
		const ip = input.ip && IP_PATTERN.test(input.ip) ? input.ip : null;
		const limitProblem = await signupLimitProblem({ account, apiKey, connection, ip, via });
		if (limitProblem) throw actionError("rate_limited", limitProblem);
		const emailProblem = await getSignupProblem(email);
		if (emailProblem) throw actionError("validation_failed", emailProblem);
		const profile = readProfile(account, input);

		const newsletter = await findNewsletter(account, input.newsletter);
		if (!hasActiveSubscription(account) && (await isRateLimited({ ...TRIAL_CONTACTS, key: String(account._id) }))) {
			throw actionError(ERROR_CODES.subscriptionRequired, "Pick a plan to add more contacts");
		}
		const { contact, created } = await upsertContact({
			newsletter,
			email,
			source: isByHand ? "dashboard" : input.source || "api",
			resubscribe: input.resubscribe === true,
			consent: isByHand ? { userId: user.id, at: new Date() } : null,
			profile,
		});
		// A pending contact who signs up again gets the confirmation again (throttled per address), unless it's
		// someone added by hand.
		const isPending = contact.status === "pending";
		const needsConfirmation = isPending && !isByHand;
		if (isSendingEnabled() && (needsConfirmation || (created && contact.status === "active"))) {
			const queue = needsConfirmation ? queueConfirmationEmail : queueWelcomeEmail;
			after(() =>
				queue({ newsletter, contact }).catch((error) => console.error(`[contacts] Signup email for ${contact._id} failed:`, error.message))
			);
		}
		return {
			id: String(contact._id),
			email: contact.email,
			newsletterId: String(newsletter._id),
			status: contact.status,
			created,
			inbox: isPending ? getInbox({ email: contact.email, fromEmail: newsletter.fromEmail }) : null,
		};
	},
});

const updateContactStatus = defineAction({
	name: "update_contact_status",
	tryWithoutPlan: true,
	title: "Change a contact's status",
	group: GROUP,
	description:
		"Sets a contact's status to active, dormant or unsubscribed. active brings back a dormant contact, resubscribes one who unsubscribed, or makes a pending one active without the confirmation email; dormant stops issues to an active contact without unsubscribing them; unsubscribed stops every email. Resubscribing and making a pending contact active need consent: true, your word that the person asked for it. Someone who unsubscribed can only become active. Bounced and complained contacts never change, and an address the account or MailCheap won't email (it bounced, complained or hit a spam trap) can't become active. No email goes out.",
	http: { method: "PATCH", path: "/contacts/{id}" },
	destructive: true,
	idempotent: true,
	example: { status: "dormant" },
	input: z.object({
		id: contactReference,
		newsletter: contactNewsletterInput,
		status: z.enum(SETTABLE_STATUSES).describe("active, dormant or unsubscribed"),
		consent: z
			.boolean()
			.optional()
			.describe("true when the person asked for it: needed to resubscribe someone who unsubscribed, or to make a pending contact active"),
	}),
	output: ContactSchema,
	handler: async ({ account, user, apiKey, connection, input, via }) => {
		const contact = await findContact(account, input.id, input.newsletter);
		const result = await changeContactStatus({
			account,
			contact,
			status: input.status,
			consent: input.consent === true,
			actor: { via, userId: user?.id, apiKeyId: apiKey?._id, connectionId: connection?.id },
		});
		if (result.problem) throw actionError(result.problem.code, result.problem.message);
		return toContact(result.contact, account);
	},
});

const updateContact = defineAction({
	name: "update_contact",
	tryWithoutPlan: true,
	title: "Update a contact",
	group: GROUP,
	description:
		"Changes a contact's first name, field values or tags. Send only what changes: tags replace the contact's own (tag_contacts and untag_contacts add or remove some), fields only change the keys given. update_contact_status changes the status.",
	http: { method: "PATCH", path: "/contacts/{id}/details" },
	idempotent: true,
	example: { firstName: "Jane", tags: ["vip", "podcast"], fields: { company: "Acme" } },
	input: z.object({
		id: contactReference,
		newsletter: contactNewsletterInput,
		firstName: firstNameInput,
		tags: tagsInput.describe("The contact's tags, replacing the ones it has. [] removes them all."),
		fields: fieldsInput,
	}),
	output: ContactSchema,
	handler: async ({ account, input }) => {
		const contact = await findContact(account, input.id, input.newsletter);
		const updated = await updateContactDetails(account, contact, readProfile(account, input));
		if (!updated) throw actionError("not_found", "Contact not found");
		return toContact(updated, account);
	},
});

const contactsListInput = z
	.array(z.string().trim().min(1).max(320))
	.min(1)
	.max(1000)
	.optional()
	.describe("Contact IDs or email addresses, 1,000 at most. An address matches its contact in every newsletter unless newsletter is given.");
const contactsFilterInput = z
	.object({ segment: segmentInput, status: statusInput, tag: tagFilterInput, search: searchInput })
	.optional()
	.describe("Instead of contacts: every contact of the newsletter these pick, like list_contacts' filters. Needs newsletter.");
const changedTagsInput = z.array(z.string().max(100)).min(1).max(10).describe("Tags, 10 at most. Tags are lowercase.");
const TagChangeOutput = z.object({
	matched: z.number().int().describe("Contacts found"),
	changed: z.number().int().describe("Contacts whose tags changed"),
});

// The account's contacts by ID or address, within a newsletter when one is given.
async function findContactIds(account, references, newsletterReference) {
	const newsletter = newsletterReference ? await findNewsletter(account, newsletterReference, { _id: 1 }) : null;
	const ids = references.filter((value) => isObjectIdString(value));
	const emails = references.filter((value) => !isObjectIdString(value)).map((value) => normalizeEmail(value) ?? value.toLowerCase());
	const contacts = await Contact.find(
		scoped(account, {
			$or: [...(ids.length ? [{ _id: { $in: ids } }] : []), ...(emails.length ? [{ email: { $in: emails } }] : [])],
			...(newsletter && { newsletterId: newsletter._id }),
		})
	)
		.select({ _id: 1 })
		.lean();
	return contacts.map(({ _id }) => _id);
}

// Which contacts a tag change is for: { contactIds } from a list, or { filter } from the list's filters.
async function readTagTarget(account, input) {
	if (Boolean(input.contacts) === Boolean(input.filter)) throw actionError("validation_failed", "Give contacts or filter, not both");
	if (input.contacts) return { contactIds: await findContactIds(account, input.contacts, input.newsletter) };
	if (!input.newsletter) throw actionError("validation_failed", "filter needs newsletter");
	const newsletter = await findNewsletter(account, input.newsletter, { _id: 1 });
	const { segment, status, tag, search } = input.filter;
	return {
		filter: {
			...(await readSegmentFilter(account, segment, newsletter)),
			...contactSearchFilter(account, { newsletterId: newsletter._id, query: search, tag: readTagFilter(tag) }),
			...(status && { status }),
		},
	};
}

function readChangedTags(tags) {
	const cleaned = cleanTags(tags);
	if (cleaned.length !== tags.length) throw actionError("validation_failed", "tags: each is 40 characters at most, without commas, and listed once");
	return cleaned;
}

const tagContacts = defineAction({
	name: "tag_contacts",
	tryWithoutPlan: true,
	title: "Tag contacts",
	group: GROUP,
	description:
		"Adds tags to contacts, keeping the tags they have: a list of contacts, or every contact a filter picks (a segment, a status, a tag, the start of the address). Segments can then pick them by tag (field tag, op has).",
	http: { method: "POST", path: "/contacts/tag" },
	idempotent: true,
	rateLimit: { limit: 120, window: "1 h" },
	example: { contacts: ["jane@example.com"], tags: ["vip"] },
	input: z.object({ newsletter: contactNewsletterInput, contacts: contactsListInput, filter: contactsFilterInput, tags: changedTagsInput }),
	output: TagChangeOutput,
	handler: async ({ account, input }) => {
		const add = readChangedTags(input.tags);
		return changeContactTags(account, { ...(await readTagTarget(account, input)), add });
	},
});

const untagContacts = defineAction({
	name: "untag_contacts",
	tryWithoutPlan: true,
	title: "Untag contacts",
	group: GROUP,
	description: "Takes tags off contacts, a list of them or every contact a filter picks, like tag_contacts. Other tags stay.",
	http: { method: "POST", path: "/contacts/untag" },
	idempotent: true,
	rateLimit: { limit: 120, window: "1 h" },
	example: { contacts: ["jane@example.com"], tags: ["vip"] },
	input: z.object({ newsletter: contactNewsletterInput, contacts: contactsListInput, filter: contactsFilterInput, tags: changedTagsInput }),
	output: TagChangeOutput,
	handler: async ({ account, input }) => {
		const remove = readChangedTags(input.tags);
		return changeContactTags(account, { ...(await readTagTarget(account, input)), remove });
	},
});

const listTags = defineAction({
	name: "list_contact_tags",
	tryWithoutPlan: true,
	title: "List tags",
	group: GROUP,
	description: "Lists the tags contacts have, most used first, with how many contacts have each (200 at most).",
	http: { method: "GET", path: "/contacts/tags" },
	readOnly: true,
	input: z.object({ newsletter: newsletterFilterInput }),
	output: z.object({ tags: z.array(z.object({ name: z.string(), contacts: z.number().int() })) }),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		return { tags: await listContactTags(account, newsletter?._id) };
	},
});

const listFields = defineAction({
	name: "list_contact_fields",
	tryWithoutPlan: true,
	title: "List contact fields",
	group: GROUP,
	description:
		"Lists the account's own contact fields, shared by its newsletters: their key (for fields on contacts, segments as fields.<key>, and CSV columns), name and type. Every contact also has a first name and tags.",
	http: { method: "GET", path: "/contacts/fields" },
	readOnly: true,
	input: z.object({}),
	output: z.object({ fields: z.array(FieldSchema) }),
	handler: async ({ account }) => ({ fields: (account.contactFields ?? []).map(({ key, label, type }) => ({ key, label, type })) }),
});

const createField = defineAction({
	name: "create_contact_field",
	tryWithoutPlan: true,
	title: "Create a contact field",
	group: GROUP,
	description: `Adds a field contacts can hold, like a company or a birthday, ${MAX_CONTACT_FIELDS} at most. Its key comes from the name: "Company size" becomes company_size.`,
	http: { method: "POST", path: "/contacts/fields", status: 201 },
	rateLimit: { limit: 60, window: "1 h" },
	example: { label: "Company", type: "text" },
	input: z.object({
		label: z.string().trim().min(1).max(MAX_FIELD_LABEL).describe(`The field's name, ${MAX_FIELD_LABEL} characters at most`),
		type: z.enum(FIELD_TYPE_IDS).describe("text, number or date"),
	}),
	output: FieldSchema,
	handler: async ({ account, input }) => {
		const { field, problem } = await addContactField(account, input);
		if (problem) throw actionError(problem.startsWith("There's already") ? "conflict" : "validation_failed", problem);
		return field;
	},
});

const deleteField = defineAction({
	name: "delete_contact_field",
	tryWithoutPlan: true,
	title: "Delete a contact field",
	group: GROUP,
	description:
		"Deletes one of the account's contact fields. Contacts keep their values, hidden, and get them back if a field with the same key is added again. A segment using it answers conflict: change the segment first.",
	http: { method: "DELETE", path: "/contacts/fields/{key}" },
	destructive: true,
	idempotent: true,
	input: z.object({ key: z.string().trim().min(1).max(40).describe("The field's key, from list_contact_fields") }),
	output: z.object({ key: z.string(), deleted: z.literal(true) }),
	handler: async ({ account, input }) => {
		if (!(account.contactFields ?? []).some(({ key }) => key === input.key)) throw actionError("not_found", "Field not found");
		const segment = await Segment.findOne(scoped(account, { deletedAt: null, "conditions.field": `fields.${input.key}` }))
			.select({ name: 1 })
			.lean();
		if (segment) throw actionError("conflict", `The "${segment.name}" segment uses this field: change it first`);
		await removeContactField(account, input.key);
		return { key: input.key, deleted: true };
	},
});

const deleteContact = defineAction({
	name: "delete_contact",
	tryWithoutPlan: true,
	title: "Delete a contact",
	group: GROUP,
	description:
		"Deletes a contact from its newsletter, with its dates and engagement. It can't be undone. For a contact who unsubscribed, bounced or complained, MailCheap keeps a hash of the address so the newsletter never emails it again: import_contacts leaves it out, and add_contact or a signup form adds it back with that status. Any other contact can be added again like a new one.",
	http: { method: "DELETE", path: "/contacts/{id}" },
	destructive: true,
	idempotent: true,
	rateLimit: { limit: 120, window: "1 h" },
	input: z.object({ id: contactReference, newsletter: contactNewsletterInput }),
	output: z.object({ id: z.string(), deleted: z.literal(true) }),
	handler: async ({ account, input }) => {
		const contact = await findContact(account, input.id, input.newsletter);
		if (!(await removeContact(account, contact))) throw actionError("conflict", "This contact just changed, try again");
		return { id: String(contact._id), deleted: true };
	},
});

const importOutput = z.object({
	importId: z.string(),
	status: z
		.enum(["processing", "done", "failed"])
		.describe("processing while rows wait for the background job or for more rows, then done; failed says why in error"),
	fileName: z.string().nullable().describe("The file's name, for imports from the dashboard"),
	total: z.number().int().nullable().describe("The rows the import said it sends, if it did"),
	received: z.number().int().describe("Rows received so far"),
	processed: z.number().int().describe("Rows processed so far"),
	created: z.number().int().describe("New contacts so far"),
	existing: z.number().int().describe("Rows that were already contacts: their status stays unless a row gave a stricter one"),
	dropped: z.object(Object.fromEntries(Object.keys(DROP_REASONS).map((reason) => [reason, z.number().int()]))),
	createdAt: dateOutput,
	finishedAt: z.string().nullable(),
	error: z.string().nullable(),
});

const importContacts = defineAction({
	name: "import_contacts",
	title: "Import contacts",
	group: GROUP,
	description: `Queues up to ${MAX_IMPORT_ROWS_PER_REQUEST} contacts per call for a background import, with the same checks as the dashboard's CSV import: invalid, misspelled (gmial.com…), spam trap, role (info@, support@…), throwaway, duplicate and suppressed addresses, undeliverable ones (MailCheap knows they can't receive email: they hard bounced or hit a spam trap, from any sender on MailCheap), and addresses on domains that can't receive email, are left out and counted. consent must be true: "${CONSENT_TEXT}". Existing contacts keep their status unless a row gives a stricter one (unsubscribed, bounced, complained), which is final. No welcome emails go out. For more rows, send the next chunk with the importId of the first, one call after the other: chunks are processed in the order they arrive, ${formatNumber(MAX_IMPORT_ROWS)} rows at most per import. Answers right away with the import's status and counts so far; get_import shows them as it goes, and with total set, status turns done once every row is in.`,
	http: { method: "POST", path: "/contacts/import" },
	destructive: true,
	idempotent: true,
	rateLimit: { limit: 120, window: "1 h" },
	// A file is one import: the dashboard sends it in chunks, and only the first counts.
	limitDashboard: (input) => !input.importId,
	example: {
		consent: true,
		contacts: [{ email: "jane@example.com", subscribedAt: "2025-03-01T00:00:00Z" }, { email: "sam@example.com", status: "unsubscribed" }],
	},
	input: z.object({
		newsletter: newsletterInput,
		consent: z.boolean().describe(`Must be true: ${CONSENT_TEXT}. Bought or scraped lists aren't allowed.`),
		contacts: z
			.array(
				z.object({
					email: z.string().max(1000).describe("Invalid addresses are left out and counted"),
					status: z
						.enum(Object.keys(STATUS_RANK))
						.optional()
						.describe("active (default), dormant, unsubscribed, bounced or complained"),
					subscribedAt: z.string().max(40).optional().describe("When they signed up, ISO 8601"),
					emailsReceived: z.number().min(0).optional().describe("Emails they got on the previous platform"),
					openRate: z.number().min(0).optional().describe("0 to 1, from the previous platform: sends reach the most engaged first"),
					clickRate: z.number().min(0).optional().describe("0 to 1, from the previous platform"),
					lastOpenAt: z.string().max(40).optional().describe("Their last open on the previous platform, ISO 8601: segments on opens use it"),
					lastClickAt: z.string().max(40).optional().describe("Their last click on the previous platform, ISO 8601"),
					opens: z.number().int().min(0).optional().describe("How many emails they opened on the previous platform"),
					clicks: z.number().int().min(0).optional().describe("How many emails they clicked on the previous platform"),
					firstName: z.string().max(200).optional().describe("Their first name, replacing the contact's"),
					tags: z.array(z.string().max(100)).max(MAX_TAGS).optional().describe("Tags added to the contact's own"),
					fields: z
						.record(z.string(), z.union([z.string(), z.number(), z.null()]))
						.optional()
						.describe("Values for the account's own fields, by key: values that don't fit the field's type are left out"),
				})
			)
			.min(1)
			.max(MAX_IMPORT_ROWS_PER_REQUEST)
			.describe(`The rows, ${MAX_IMPORT_ROWS_PER_REQUEST} at most`),
		importId: z.string().max(100).optional().describe("The importId of the first chunk, to add rows to the same import"),
		total: z
			.number()
			.int()
			.min(1)
			.max(MAX_IMPORT_ROWS)
			.optional()
			.describe("With the first chunk: the rows the whole import sends, so its status turns done once they're all processed"),
		duplicates: z.number().int().min(0).optional().describe("Duplicates you removed before sending, counted in the import's report"),
	}),
	dashboardInput: z.object({ fileName: z.string().max(200).optional() }),
	output: importOutput,
	handler: async ({ account, user, apiKey, input, via }) => {
		// A later chunk only needs its importId; with a newsletter too, the import has to be that newsletter's.
		const newsletter = !input.importId || input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		if (input.consent !== true) throw actionError("validation_failed", "Confirm that these people agreed to receive your emails");
		let importId = input.importId;
		if (!importId) {
			const started = await startImport({
				account,
				userId: user?.id,
				apiKeyId: apiKey?._id,
				newsletterId: String(newsletter._id),
				consent: input.consent,
				source: via === "dashboard" ? "dashboard" : "api",
				fileName: input.fileName,
				total: input.total,
				duplicates: input.duplicates,
			});
			if (started.error) throw actionError("validation_failed", started.error);
			importId = String(started.contactImport._id);
		}
		const added = await addImportRows({
			account,
			importId,
			newsletterId: newsletter?._id,
			rows: input.contacts.map((row) => ({ ...row, status: row.status ?? "active" })),
		});
		if (added.error) throw actionError(added.error === "Import not found" ? "not_found" : "validation_failed", added.error);
		return toImportView(added.job);
	},
});

const importIdInput = z.string().trim().min(1).max(100).describe("The importId import_contacts answered with");

const getImportAction = defineAction({
	name: "get_import",
	title: "Get an import",
	group: GROUP,
	description:
		"An import's status and counts as its rows go in: processing while they wait for the background job or for more rows, then done, or failed with the reason in error.",
	http: { method: "GET", path: "/contacts/imports/{id}" },
	readOnly: true,
	input: z.object({ id: importIdInput }),
	output: importOutput,
	handler: async ({ account, input }) => {
		const view = await getImport(account, input.id);
		if (!view) throw actionError("not_found", "Import not found");
		return view;
	},
});

const listImportsAction = defineAction({
	name: "list_imports",
	title: "List imports",
	group: GROUP,
	description: "The latest imports, newest first, with their status and counts.",
	http: { method: "GET", path: "/contacts/imports" },
	readOnly: true,
	input: z.object({
		newsletter: newsletterFilterInput,
		limit: z.number().int().min(1).max(20).optional().describe("How many, 5 by default"),
	}),
	output: z.object({ imports: z.array(importOutput) }),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		return { imports: await listImports(account, { newsletterId: newsletter?._id, limit: input.limit ?? 5 }) };
	},
});

const exportContacts = defineAction({
	name: "export_contacts",
	title: "Export contacts",
	group: GROUP,
	description:
		"Makes a CSV download link for the contacts matching the filters, valid for an hour, no API key needed to open it. The columns go back in through the import as they are.",
	http: { method: "GET", path: "/contacts/export" },
	readOnly: true,
	rateLimit: { limit: 30, window: "1 h" },
	example: { status: "active" },
	input: z.object({ newsletter: newsletterFilterInput, status: statusInput, segment: segmentInput, tag: tagFilterInput, search: searchInput }),
	output: z.object({
		url: z.string().describe("The CSV file. Anyone with the link can download it until it expires."),
		expiresAt: z.string(),
		count: z.number().int().describe("Contacts in the file"),
	}),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		const filters = { newsletterId: newsletter?._id, status: input.status, query: input.search, tag: readTagFilter(input.tag) };
		const count = await Contact.countDocuments({
			...(await readSegmentFilter(account, input.segment, newsletter)),
			...contactSearchFilter(account, filters),
			...(input.status && { status: input.status }),
		});
		const { token, expiresAt } = createExportToken({ accountId: account._id, ...filters, segmentId: input.segment });
		return { url: `${getAppUrl()}/api/v1/contacts/export.csv?token=${token}`, expiresAt: expiresAt.toISOString(), count };
	},
});

export const contactActions = [
	listContacts,
	getContact,
	addContact,
	updateContact,
	updateContactStatus,
	tagContacts,
	untagContacts,
	deleteContact,
	importContacts,
	getImportAction,
	listImportsAction,
	exportContacts,
	listTags,
	listFields,
	createField,
	deleteField,
];
