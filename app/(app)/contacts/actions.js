"use server";

import { revalidatePath } from "next/cache";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";

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

// With the box ticked, the contact is active at once: no confirmation email, the welcome email if it's on.
export async function addContact(_state, formData) {
	const { output, failure } = await runDashboardAction("add_contact", {
		newsletter: String(formData.get("newsletterId") ?? ""),
		email: String(formData.get("email") ?? ""),
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
	revalidatePath("/contacts");
	return failure ? toFormError(failure) : { ok: true };
}

// The contact sheet: a first name, the account's field values (null clears one) and the whole list of tags.
export async function updateContactDetails(id, { firstName, fields, tags } = {}) {
	const { output, failure } = await runDashboardAction("update_contact", {
		id: String(id),
		firstName: typeof firstName === "string" ? firstName : null,
		fields: fields && typeof fields === "object" ? fields : {},
		tags: Array.isArray(tags) ? tags : [],
	});
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { contact: output };
}

export async function createContactField({ label, type } = {}) {
	const { output, failure } = await runDashboardAction("create_contact_field", { label: String(label ?? ""), type });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { field: output };
}

export async function deleteContactField(key) {
	const { failure } = await runDashboardAction("delete_contact_field", { key: String(key ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { ok: true };
}

export async function deleteContact(id) {
	const { failure } = await runDashboardAction("delete_contact", { id: String(id) });
	revalidatePath("/contacts");
	return failure ? toFormError(failure) : { ok: true };
}

// A link to the CSV with the list's filters, valid for an hour.
export async function exportContacts({ newsletterId, status, query, segmentId, tag } = {}) {
	const { output, failure } = await runDashboardAction("export_contacts", {
		...(newsletterId && { newsletter: String(newsletterId) }),
		...listFilter({ status, query, segmentId, tag }),
	});
	return failure ? toFormError(failure) : { url: output.url, count: output.count };
}

// Adds tags to every contact the list shows with its filters, or takes them off (remove).
export async function tagListedContacts({ newsletterId, status, query, segmentId, tag, tags, remove = false } = {}) {
	const input = {
		newsletter: String(newsletterId ?? ""),
		filter: listFilter({ status, query, segmentId, tag }),
		tags: Array.isArray(tags) ? tags : [],
	};
	const { output, failure } = remove ? await runDashboardAction("untag_contacts", input) : await runDashboardAction("tag_contacts", input);
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return output;
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

function listFilter({ status, query, segmentId, tag }) {
	return {
		...(status && { status }),
		...(query && { search: String(query) }),
		...(segmentId && { segment: String(segmentId) }),
		...(tag && { tag: String(tag) }),
	};
}

// The segment editor's conditions as it holds them; the action checks them.
export async function saveSegment(id, { newsletterId, name, match, conditions } = {}) {
	const input = { name: String(name ?? ""), match, conditions: Array.isArray(conditions) ? conditions : [] };
	const { output, failure } = id
		? await runDashboardAction("update_segment", { id: String(id), ...input })
		: await runDashboardAction("create_segment", { newsletter: String(newsletterId ?? ""), ...input });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { id: output.id };
}

export async function deleteSegment(id) {
	const { failure } = await runDashboardAction("delete_segment", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
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
