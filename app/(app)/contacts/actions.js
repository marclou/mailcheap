"use server";

import { revalidatePath } from "next/cache";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";
import { gravatarHash } from "@/lib/gravatar";

// One chunk of a file: the first starts the import (with the file's name and its row count), the next ones pass its
// importId. The rows go in in the background; getImports follows them.
export async function importContacts({ newsletterId, rows, consent, importId, duplicates, total, fileName }) {
	const { output, failure } = await runDashboardAction("import_contacts", {
		newsletter: String(newsletterId ?? ""),
		contacts: Array.isArray(rows) ? rows : [],
		consent: consent === true,
		...(importId && { importId: String(importId) }),
		...(!importId && duplicates && { duplicates }),
		...(!importId && total && { total }),
		...(!importId && fileName && { fileName: String(fileName).slice(0, 200) }),
	});
	if (failure) return toFormError(failure);
	return output;
}

// The newsletter's latest imports, for the card that follows them on the contacts page.
export async function getImports(newsletterId) {
	const { output, failure } = await runDashboardAction("list_imports", { ...(newsletterId && { newsletter: String(newsletterId) }), limit: 3 });
	if (failure) return toFormError(failure);
	return output;
}

// A page of what an import left out, with what's typed in the search, each with the hash its picture comes from
// (AvatarContact).
export async function getLeftOut(importId, { search, cursor } = {}) {
	const { output, failure } = await runDashboardAction("list_left_out", {
		id: String(importId ?? ""),
		...(search && { search: String(search).slice(0, 254) }),
		...(cursor && { cursor: String(cursor) }),
	});
	if (failure) return toFormError(failure);
	return { contacts: output.contacts.map((contact) => ({ ...contact, gravatarHash: gravatarHash(contact.email) })), nextCursor: output.nextCursor };
}

// One address the import left out, added after all: whether it was, and the import's counts afterwards.
export async function bringBackContact(importId, email) {
	const { output, failure } = await runDashboardAction("bring_back_contacts", { id: String(importId ?? ""), emails: [String(email ?? "")] });
	if (failure) return toFormError(failure);
	const [result] = output.contacts;
	if (result.broughtBack) revalidateContacts();
	return { ...(result.error && { error: result.error }), broughtBack: result.broughtBack, import: output.import };
}

// With the box ticked, the contact is active at once: no confirmation email, the welcome email if it's on. A first name
// and tags, a "tags" entry each, are optional; an address already on the list keeps its own.
export async function addContact(_state, formData) {
	const firstName = String(formData.get("firstName") ?? "").trim();
	const tags = formData.getAll("tags").filter((tag) => typeof tag === "string");
	const { output, failure } = await runDashboardAction("add_contact", {
		newsletter: String(formData.get("newsletterId") ?? ""),
		email: String(formData.get("email") ?? ""),
		...(firstName && { firstName }),
		...(tags.length > 0 && { tags }),
		consent: formData.get("consent") === "on",
	});
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	if (!output.created) return { error: `${output.email} is already a contact` };
	return { email: output.email, status: output.status };
}

// consent: the box the menu's dialog asks for before resubscribing someone or making a pending contact active.
export async function setContactStatus(id, status, consent = false) {
	const { failure } = await runDashboardAction("update_contact_status", { id: String(id), status, consent: consent === true });
	revalidateContacts();
	return failure ? toFormError(failure) : { ok: true };
}

// A contact's Edit fields, a first name and the account's field values (null clears one), or its Edit tags, the whole
// list of tags: what isn't given stays as it is.
export async function updateContactDetails(id, { firstName, fields, tags } = {}) {
	const { output, failure } = await runDashboardAction("update_contact", {
		id: String(id),
		...(typeof firstName === "string" && { firstName }),
		fields: fields && typeof fields === "object" ? fields : {},
		...(Array.isArray(tags) && { tags }),
	});
	if (failure) return toFormError(failure);
	revalidateContacts();
	return { contact: output };
}

export async function createContactField({ label, type } = {}) {
	const { output, failure } = await runDashboardAction("create_contact_field", { label: String(label ?? ""), type });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	revalidatePath("/(app)/contacts/[id]", "page");
	return { field: output };
}

export async function deleteContactField(key) {
	const { failure } = await runDashboardAction("delete_contact_field", { key: String(key ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	revalidatePath("/(app)/contacts/[id]", "page");
	return { ok: true };
}

export async function deleteContact(id) {
	const { failure } = await runDashboardAction("delete_contact", { id: String(id) });
	revalidateContacts();
	return failure ? toFormError(failure) : { ok: true };
}

// The list's selection (selectionTarget), a batch at a time: the bar calls again while some remain. The pages that list
// contacts refresh once it's done.
export async function deleteSelectedContacts(selection) {
	const { output, failure } = await runDashboardAction("delete_contacts", selectionTarget(selection));
	if (failure || output.remaining === 0 || output.deleted === 0) revalidateContacts();
	return failure ? toFormError(failure) : { deleted: output.deleted, remaining: output.remaining };
}

// The same for a status: active, dormant or unsubscribed, for those whose status can change to it without their consent.
export async function setSelectedStatus(selection, status) {
	const { output, failure } = await runDashboardAction("update_contacts_status", { ...selectionTarget(selection), status });
	if (failure || output.remaining === 0 || output.changed === 0) revalidateContacts();
	return failure ? toFormError(failure) : { changed: output.changed, remaining: output.remaining };
}

// And for tags, which the newsletter's whole team can change.
export async function tagSelectedContacts(selection, tags) {
	const { output, failure } = await runDashboardAction("tag_contacts", { ...selectionTarget(selection), tags: readTags(tags) });
	if (failure || output.remaining === 0 || output.changed === 0) revalidateContacts();
	return failure ? toFormError(failure) : { changed: output.changed, remaining: output.remaining };
}

export async function untagSelectedContacts(selection, tags) {
	const { output, failure } = await runDashboardAction("untag_contacts", { ...selectionTarget(selection), tags: readTags(tags) });
	if (failure || output.remaining === 0 || output.changed === 0) revalidateContacts();
	return failure ? toFormError(failure) : { changed: output.changed, remaining: output.remaining };
}

// A segment of the list's selection: they get its tag, which its one condition picks, so anyone tagged so later joins
// it. Tagged first, a batch a call while some remain, so trying again with the same name tags no one twice and saves
// one segment.
export async function segmentSelectedContacts(selection, { name, tag } = {}) {
	const tagged = await runDashboardAction("tag_contacts", { ...selectionTarget(selection), tags: readTags([tag]) });
	if (tagged.failure) return toFormError(tagged.failure);
	if (tagged.output.remaining > 0 && tagged.output.changed > 0) return { remaining: tagged.output.remaining };
	revalidateContacts();
	const { output, failure } = await runDashboardAction("create_segment", {
		newsletter: String(selection?.newsletterId ?? ""),
		name: String(name ?? ""),
		match: "all",
		conditions: [{ field: "tag", op: "has", value: String(tag ?? "") }],
	});
	if (failure) return toFormError(failure);
	return { id: output.id };
}

// A link to the CSV with the list's filters, valid for an hour.
export async function exportContacts({ newsletterId, ...filters } = {}) {
	const { output, failure } = await runDashboardAction("export_contacts", {
		...(newsletterId && { newsletter: String(newsletterId) }),
		...listFilter(filters),
	});
	return failure ? toFormError(failure) : { url: output.url, count: output.count };
}

// What the segment editor and the contact sheet offer: the account's fields and the newsletter's tags.
export async function getContactOptions(newsletterId) {
	const [fields, tags] = await Promise.all([
		runDashboardAction("list_contact_fields", {}),
		runDashboardAction("list_contact_tags", { ...(newsletterId && { newsletter: String(newsletterId) }) }),
	]);
	const failure = fields.failure ?? tags.failure;
	return failure ? toFormError(failure) : { fields: fields.output.fields, tags: tags.output.tags };
}

// Who a change to the list's selection is for: the contacts picked on its page (ids), or every contact the list shows
// with its filters (filters, with segmentId on a segment's page), on every page: the whole list without any.
function selectionTarget({ newsletterId, ids, filters } = {}) {
	const newsletter = String(newsletterId ?? "");
	if (Array.isArray(ids)) return { newsletter, contacts: ids.map(String) };
	const filter = listFilter(filters ?? {});
	return { newsletter, ...(Object.keys(filter).length > 0 ? { filter } : { all: true }) };
}

function readTags(tags) {
	return Array.isArray(tags) ? tags.map((tag) => String(tag ?? "")) : [];
}

function listFilter({ status, query, segmentId, tag, source, signedUpSince, signedUpBefore }) {
	return {
		...(status && { status }),
		...(query && { search: String(query) }),
		...(segmentId && { segment: String(segmentId) }),
		...(tag && { tag: String(tag) }),
		...(source && { source: String(source) }),
		...(signedUpSince && { signedUpSince: String(signedUpSince) }),
		...(signedUpBefore && { signedUpBefore: String(signedUpBefore) }),
	};
}

// Every page that lists contacts: the list, each contact's page and the segments.
function revalidateContacts() {
	revalidatePath("/contacts");
	revalidatePath("/contacts/segments");
	revalidatePath("/(app)/contacts/[id]", "page");
	revalidatePath("/(app)/contacts/segments/[id]", "page");
}

// The segment editor's conditions as it holds them; the action checks them.
export async function saveSegment(id, { newsletterId, name, match, conditions } = {}) {
	const input = { name: String(name ?? ""), match, conditions: Array.isArray(conditions) ? conditions : [] };
	const { output, failure } = id
		? await runDashboardAction("update_segment", { id: String(id), ...input })
		: await runDashboardAction("create_segment", { newsletter: String(newsletterId ?? ""), ...input });
	if (failure) return toFormError(failure);
	revalidateContacts();
	return { id: output.id };
}

export async function deleteSegment(id) {
	const { failure } = await runDashboardAction("delete_segment", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidateContacts();
	return { ok: true };
}

// The editor's live count while the conditions change.
export async function countSegment({ newsletterId, match, conditions } = {}) {
	const { output, failure } = await runDashboardAction("count_segment", {
		newsletter: String(newsletterId ?? ""),
		match,
		conditions: Array.isArray(conditions) ? conditions : [],
	});
	return failure ? toFormError(failure) : { contacts: output.contacts };
}
