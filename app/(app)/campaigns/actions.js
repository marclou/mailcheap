"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";
import { gravatarHash } from "@/lib/gravatar";

const MAX_SUBJECT_LENGTH = 200;
const MAX_PREVIEW_TEXT_LENGTH = 300;

function readCount(value) {
	const count = Number(value);
	return Number.isInteger(count) && count > 0 ? count : undefined;
}

function refresh(id) {
	revalidatePath("/campaigns");
	if (id) revalidatePath(`/campaigns/${id}`);
}

export async function createCampaign(newsletterId) {
	const { output, failure } = await runDashboardAction("create_campaign", { newsletter: String(newsletterId ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath("/campaigns");
	redirect(`/campaigns/${output.id}`);
}

// The editor saves rich text, or the HTML of an imported issue; Markdown drafts open as rich text. revision: on a team's
// newsletter, the one the editor started from, which answers conflict once someone else saved since
// (lib/use-draft-sync.js), and the new one once it's saved.
export async function saveCampaign(id, values) {
	const revision = Number.isInteger(values?.revision) ? values.revision : undefined;
	const { output, failure } = await runDashboardAction("update_campaign", {
		id: String(id),
		subject: String(values?.subject ?? "").slice(0, MAX_SUBJECT_LENGTH),
		previewText: String(values?.previewText ?? "").slice(0, MAX_PREVIEW_TEXT_LENGTH),
		content: String(values?.body ?? ""),
		...(values?.format && { format: values.format }),
		...(revision !== undefined && { revision }),
	});
	if (failure?.code === "revision_conflict") return { conflict: true };
	if (failure) return toFormError(failure);
	revalidatePath("/campaigns");
	return revision === undefined ? { ok: true } : { ok: true, revision: output.revision };
}

// A draft as it's saved now, for an editor whose save someone else's beat to merge with.
export async function loadDraft(id) {
	const { output, failure } = await runDashboardAction("get_campaign", { id: String(id) });
	if (failure) return toFormError(failure);
	const { subject, previewText, content, format, revision } = output;
	return { subject, previewText, content, format, revision };
}

// Who the draft goes to: a segment's ID, or null for every active contact. The page counts its audience again.
export async function setCampaignSegment(id, segmentId) {
	const { failure } = await runDashboardAction("update_campaign", { id: String(id), segment: segmentId ? String(segmentId) : null });
	if (failure) return toFormError(failure);
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

// Where the draft goes: both, email or web (lib/publish-to.js). Saved right away, like its segment.
export async function setCampaignPublishTo(id, publishTo) {
	const { failure } = await runDashboardAction("update_campaign", { id: String(id), publishTo: String(publishTo ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

// Who wrote the draft (components/PickerAuthor.jsx), saved right away like its segment.
export async function setCampaignAuthor(id, authorId) {
	const { failure } = await runDashboardAction("update_campaign", { id: String(id), author: String(authorId ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

// A new author of the newsletter, who then writes the draft.
export async function addCampaignAuthor(id, newsletterId, values) {
	const { output, failure } = await runDashboardAction("create_author", {
		newsletter: String(newsletterId ?? ""),
		...readAuthorValues(values),
	});
	if (failure) return toFormError(failure);
	const chosen = await setCampaignAuthor(id, output.id);
	return chosen.error ? { ...chosen, author: toAuthorOption(output) } : { author: toAuthorOption(output) };
}

// Who the newsletter's new issues start with, picked on its Sender page and saved right away.
export async function setDefaultAuthor(authorId) {
	const { failure } = await runDashboardAction("update_author", { id: String(authorId ?? ""), isDefault: true });
	if (failure) return toFormError(failure);
	refreshAuthors();
	return { ok: true };
}

// A new author of the newsletter, who then becomes its default one.
export async function addDefaultAuthor(newsletterId, values) {
	const { output, failure } = await runDashboardAction("create_author", {
		newsletter: String(newsletterId ?? ""),
		...readAuthorValues(values),
	});
	if (failure) return toFormError(failure);
	const chosen = output.isDefault ? { ok: true } : await setDefaultAuthor(output.id);
	return chosen.error ? { ...chosen, author: toAuthorOption(output) } : { author: toAuthorOption(output) };
}

export async function editAuthor(authorId, values) {
	const { output, failure } = await runDashboardAction("update_author", { id: String(authorId ?? ""), ...readAuthorValues(values) });
	if (failure) return toFormError(failure);
	refreshAuthors();
	return { author: toAuthorOption(output) };
}

export async function removeAuthor(authorId) {
	const { failure } = await runDashboardAction("delete_author", { id: String(authorId ?? "") });
	if (failure) return toFormError(failure);
	refreshAuthors();
	return { ok: true };
}

// The editor and the Sender page list the newsletter's authors.
function refreshAuthors() {
	revalidatePath("/campaigns", "layout");
	revalidatePath("/newsletters", "layout");
}

function readAuthorValues(values) {
	return {
		name: String(values?.name ?? "").slice(0, 200),
		email: String(values?.email ?? "").slice(0, 320),
		imageUrl: String(values?.imageUrl ?? "").slice(0, 500),
		showOnWeb: values?.showOnWeb !== false,
		showInEmails: values?.showInEmails !== false,
	};
}

// The menu shows an author by their picture, or the one their address has (AvatarUser).
function toAuthorOption({ id, name, email, imageUrl, showOnWeb, showInEmails }) {
	return { id, name, email, imageUrl, showOnWeb, showInEmails, gravatarHash: gravatarHash(email) };
}
// The preview's reader picker: the newsletter's active contacts with what's typed in their address or first name, the
// newest before anything is, each with its field values, which the preview fills in, and the hash its picture comes
// from (AvatarContact). segmentIds: the segments the issue's sections name, of which each contact gets those it's in,
// along with its tags (lib/sections.js).
export async function findPreviewContacts(newsletterId, query, segmentIds = []) {
	const inSegments = Array.isArray(segmentIds) ? segmentIds.map(String).slice(0, 10) : [];
	const { output, failure } = await runDashboardAction("search_contacts", {
		newsletter: String(newsletterId ?? ""),
		query: String(query ?? "").slice(0, 100),
		status: "active",
		limit: 8,
		...(inSegments.length > 0 && { inSegments }),
	});
	if (failure) return toFormError(failure);
	return {
		contacts: output.contacts.map(({ id, email, firstName, fields, tags, inSegments: member = [] }) => ({
			id,
			email,
			firstName,
			fields,
			tags,
			segments: Object.fromEntries(inSegments.map((segmentId) => [segmentId, member.includes(segmentId)])),
			gravatarHash: gravatarHash(email),
		})),
	};
}

// How many of the readers a draft goes to have a tag or are in a segment, for its sections: tag:<tag> or segment:<id>.
export async function countSectionReaders(id, groups) {
	const { output, failure } = await runDashboardAction("count_section_readers", {
		id: String(id),
		groups: Array.isArray(groups) ? groups.map(String).slice(0, 10) : [],
	});
	return failure ? toFormError(failure) : output;
}

// Every tag and segment with how many of the readers a draft goes to each picks, for the menu its sections pick from.
export async function countAllSectionReaders(id) {
	const { output, failure } = await runDashboardAction("count_section_readers", { id: String(id), all: true });
	return failure ? toFormError(failure) : output;
}

// The test dialog (DialogSendTest): the addresses it goes to, the default ones without, the ID of the contact it reads
// as, and whether the addresses become the default.
export async function sendTestCampaign(id, { to, contact, saveAsDefault } = {}) {
	const { failure } = await runDashboardAction("send_test_email", { id: String(id), to, contact: contact ?? undefined, saveAsDefault });
	revalidatePath(`/campaigns/${id}`);
	return failure ? toFormError(failure) : { ok: true };
}

// held: paused as it starts, which only the content check does (lib/content-review.js), so nothing went out yet.
// checkTips: stop first when the check has tips (tips), so nothing went out either.
export async function sendCampaign(id, { audienceLimit, checkTips = false } = {}) {
	const { output, failure } = await runDashboardAction("send_campaign", {
		id: String(id),
		audienceLimit: readCount(audienceLimit),
		checkTips: checkTips === true,
	});
	if (output?.tips) return { ok: true, tips: output.tips };
	refresh(id);
	if (failure) return toFormError(failure);
	return output?.status === "paused" ? { ok: true, held: true } : { ok: true };
}

export async function scheduleCampaign(id, { scheduledAt, audienceLimit, checkTips = false } = {}) {
	const { output, failure } = await runDashboardAction("schedule_campaign", {
		id: String(id),
		scheduledAt: String(scheduledAt ?? ""),
		audienceLimit: readCount(audienceLimit),
		checkTips: checkTips === true,
	});
	if (failure) return toFormError(failure);
	if (output.tips) return { ok: true, tips: output.tips };
	refresh(id);
	return { ok: true };
}

export async function unscheduleCampaign(id) {
	const { failure } = await runDashboardAction("unschedule_campaign", { id: String(id) });
	if (failure) return toFormError(failure);
	refresh(id);
	return { ok: true };
}

// The send dialogs ask when they open: it walks the whole list.
export async function previewCleanup(id) {
	const { output, failure } = await runDashboardAction("preview_campaign_cleanup", { id: String(id), includeRanks: true });
	if (failure) return toFormError(failure);
	return output.enabled ? { enabled: true, ...output.ranks } : { enabled: false };
}

// Without a number, the campaign goes to everyone who hasn't received it yet.
export async function sendCampaignToMore(id, { additional } = {}) {
	const { failure } = await runDashboardAction("send_campaign_to_more", { id: String(id), additional: readCount(additional) });
	refresh(id);
	return failure ? toFormError(failure) : { ok: true };
}

export async function resumeCampaign(id) {
	const { failure } = await runDashboardAction("resume_campaign", { id: String(id) });
	revalidatePath(`/campaigns/${id}`);
	return failure ? toFormError(failure) : { ok: true };
}

export async function pauseCampaign(id) {
	const { failure } = await runDashboardAction("pause_campaign", { id: String(id) });
	revalidatePath(`/campaigns/${id}`);
	return failure ? toFormError(failure) : { ok: true };
}

export async function toggleArchivePin(id) {
	const current = await runDashboardAction("get_campaign", { id: String(id) });
	if (current.failure) return toFormError(current.failure);
	const { failure } = await runDashboardAction("update_campaign_archive", { id: String(id), pinned: !current.output.archivePinned });
	if (failure) return toFormError(failure);
	revalidatePath(`/campaigns/${id}`);
	revalidatePath(`/campaigns/${id}/web`);
	return { ok: true };
}

export async function duplicateCampaign(id) {
	const { output, failure } = await runDashboardAction("duplicate_campaign", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/campaigns");
	redirect(`/campaigns/${output.id}`);
}

// Discarded campaigns keep everything: canceled hides them from the lists and stops a scheduled send.
export async function discardCampaign(id) {
	const { failure } = await runDashboardAction("delete_campaign", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/");
	revalidatePath("/campaigns");
	return { ok: true };
}

// deleted: a web-only issue left the campaigns too, so its own page isn't refreshed while the dialog leaves it.
export async function unpublishCampaign(id) {
	const { output, failure } = await runDashboardAction("unpublish_campaign", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/");
	revalidatePath("/campaigns");
	if (!output.deleted) revalidatePath(`/campaigns/${id}`);
	return { ok: true, deleted: output.deleted };
}

// The issue's page on the website (update_campaign_archive): a draft's title, description and picture save as they're
// picked, and a page that's out changes all at once, its content too, once the content check has read it. content: null
// shows the email's content again.
export async function updateWebPage(id, values) {
	const { title, description, image, content, format } = values ?? {};
	const { failure } = await runDashboardAction("update_campaign_archive", {
		id: String(id),
		...(title !== undefined && { title: String(title).slice(0, MAX_SUBJECT_LENGTH) }),
		...(description !== undefined && { description: String(description).slice(0, MAX_PREVIEW_TEXT_LENGTH) }),
		...(image !== undefined && { image: String(image) }),
		...(content !== undefined && { content: content === null ? null : String(content) }),
		...(format && { format: String(format) }),
	});
	if (failure) return toFormError(failure);
	refresh(id);
	revalidatePath(`/campaigns/${id}/web`);
	return { ok: true };
}

// The page lives at /p/<slug> once the issue goes out. A draft without one gets the subject's slug then.
export async function updateArchiveSlug(id, value) {
	const { output, failure } = await runDashboardAction("update_campaign_archive", { id: String(id), slug: String(value ?? "") });
	if (failure) return toFormError(failure);
	refresh(id);
	return { ok: true, archiveSlug: output.archiveSlug ?? "" };
}
