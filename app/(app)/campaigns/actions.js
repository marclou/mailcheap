"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PUBLISHED_STATUSES, revalidateArchive } from "@/lib/archive-data";
import { requireSession } from "@/lib/auth";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { getDb, isUniqueViolation } from "@/lib/db";
import { notifyActivity } from "@/lib/notify-activity";
import { isRateLimited } from "@/lib/rate-limit";
import { findCampaignById, findNewsletterById } from "@/lib/records";
import { getScheduleProblem } from "@/lib/schedule";
import { campaigns } from "@/lib/schema";
import { kickSender } from "@/lib/sender-client";
import { getCleanupPreview, queueCampaign, sendTestEmail, sendToMoreContacts } from "@/lib/sending";
import { getSendProblem } from "@/lib/sending-rules";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import { isAiGatewayConfigured, suggestSubjectLines } from "@/lib/subject-ideas";
import { firstImageUrl } from "@/lib/thumbnail";
import { MAX_BODY_BYTES, isIdString } from "@/lib/validation";

const MAX_SUBJECT_LENGTH = 200;
const COPY_SUFFIX = " (copy)";
// A scheduled campaign stays editable until it goes out.
const EDITABLE_STATUSES = ["draft", "scheduled"];

function readAudienceLimit(value) {
	const limit = Number(value);
	return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function notifySend(campaign, action) {
	return notifyActivity([`${action}: ${campaign.subject || "(no subject)"}`, `${getAppUrl()}/campaigns/${campaign._id}`]);
}

function formatCount(count) {
	return count.toLocaleString("en-US");
}

async function findCampaign(id) {
	await requireSession();
	if (!isIdString(id)) return null;
	return findCampaignById(id);
}

// Conditional writes: the filter is part of the update, so it only lands on a campaign still in that state.
async function updateCampaign(where, set) {
	const rows = await getDb().update(campaigns).set(set).where(where).returning({ _id: campaigns._id });
	return rows.length > 0;
}

function isEditable(id) {
	return and(eq(campaigns._id, id), inArray(campaigns.status, EDITABLE_STATUSES));
}

export async function createCampaign(newsletterId) {
	await requireSession();
	if (!(await findNewsletterById(newsletterId, ["_id"]))) return { error: "Newsletter not found" };

	const [campaign] = await getDb().insert(campaigns).values({ newsletterId }).returning({ _id: campaigns._id });
	revalidatePath("/campaigns");
	redirect(`/campaigns/${campaign._id}`);
}

// The status check is part of the write, so a save can't land on a campaign that just started sending.
export async function saveCampaign(id, values) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Only drafts can be edited" };

	const body = String(values?.body ?? "");
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes > MAX_BODY_BYTES) {
		return { error: `The content is ${Math.ceil(bytes / 1000)} KB. The limit is ${MAX_BODY_BYTES / 1000} KB.` };
	}

	// The editor opens Markdown drafts as rich text, so their first save moves them to it.
	const format = campaign.format === "markdown" ? "rich" : campaign.format;
	const thumbnailUrl = firstImageUrl({ format, html: body });
	const saved = await updateCampaign(isEditable(campaign._id), {
		subject: String(values?.subject ?? "").slice(0, MAX_SUBJECT_LENGTH),
		previewText: String(values?.previewText ?? "").slice(0, 300),
		format,
		html: body,
		thumbnailUrl: thumbnailUrl ?? null,
	});
	if (!saved) return { error: "This campaign is already sending" };

	revalidatePath("/campaigns");
	return { ok: true };
}

// Sending errors become toasts; a thrown error would replace the page with the error boundary.
async function runSend(send) {
	try {
		await send();
		return { ok: true };
	} catch (error) {
		console.error("[campaigns] Send failed:", error);
		return { error: error.message || "Sending failed" };
	}
}

export async function sendTestCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const result = await runSend(() =>
		sendTestEmail({ campaignId: campaign._id.toString(), to: process.env.ADMIN_EMAIL })
	);
	revalidatePath(`/campaigns/${id}`);
	return result;
}

// Sending a scheduled campaign now replaces its schedule: the sender's cron only starts scheduled ones.
export async function sendCampaign(id, { audienceLimit } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Already sent" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const limit = readAudienceLimit(audienceLimit);
	await updateCampaign(isEditable(campaign._id), { audienceLimit: limit ?? null, scheduledAt: null });

	const result = await runSend(() => queueCampaign(campaign._id.toString()));
	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) {
		kickSender();
		revalidateArchive();
		await notifySend(campaign, limit ? `Send started (first ${formatCount(limit)})` : "Send started");
	}
	return result;
}

// Checked now and again when it goes out: content edited in between could still block the send.
export async function scheduleCampaign(id, { scheduledAt, audienceLimit } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Already sent" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const at = new Date(scheduledAt ?? NaN);
	const problem = getScheduleProblem(at);
	if (problem) return { error: problem };
	const newsletter = await findNewsletterById(campaign.newsletterId);
	const sendProblem = getSendProblem({ campaign, newsletter });
	if (sendProblem) return { error: sendProblem };

	// The sender function's every-minute cron starts it when it's due (lib/scheduling.js).
	const limit = readAudienceLimit(audienceLimit);
	const scheduled = await updateCampaign(isEditable(campaign._id), {
		status: "scheduled",
		scheduledAt: at,
		audienceLimit: limit ?? null,
	});
	if (!scheduled) return { error: "The campaign changed, refresh and try again" };

	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	const when = `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
	await notifySend(campaign, `Send scheduled for ${when}${limit ? ` (first ${formatCount(limit)})` : ""}`);
	return { ok: true };
}

export async function unscheduleCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };

	const unscheduled = await updateCampaign(and(eq(campaigns._id, campaign._id), eq(campaigns.status, "scheduled")), {
		status: "draft",
		scheduledAt: null,
	});
	if (!unscheduled) return { error: "It isn't scheduled anymore" };

	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

// The send dialogs ask when they open: it walks the whole list.
export async function previewCleanup(id) {
	await requireSession();
	if (!isIdString(id)) return { error: "Campaign not found" };
	try {
		return await getCleanupPreview(id);
	} catch (error) {
		console.error("[campaigns] Cleanup preview failed:", error);
		return { error: error.message || "Couldn't count the list cleanup" };
	}
}

// Without a number, the campaign goes to everyone who hasn't received it yet.
export async function sendCampaignToMore(id, { additional } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const more = readAudienceLimit(additional);
	const result = await runSend(() => sendToMoreContacts(campaign._id.toString(), more));
	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) {
		kickSender();
		await notifySend(campaign, `Send to more started (${more ? `next ${formatCount(more)}` : "everyone left"})`);
	}
	return result;
}

export async function resumeCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (campaign.status !== "paused") return { error: "Only paused campaigns can resume" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const result = await runSend(() => queueCampaign(campaign._id.toString()));
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) {
		kickSender();
		await notifySend(campaign, "Send resumed");
	}
	return result;
}

export async function pauseCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	await updateCampaign(and(eq(campaigns._id, campaign._id), eq(campaigns.status, "sending")), { status: "paused" });
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

export async function toggleArchivePin(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!campaign.archiveSlug || campaign.archiveListed === false) return { error: "Not listed on the archive" };

	await updateCampaign(eq(campaigns._id, campaign._id), { archivePinned: !campaign.archivePinned });
	revalidatePath(`/campaigns/${id}`);
	revalidateArchive();
	return { ok: true };
}

export async function duplicateCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };

	const [copy] = await getDb()
		.insert(campaigns)
		.values({
			newsletterId: campaign.newsletterId,
			subject: campaign.subject ? `${campaign.subject.slice(0, MAX_SUBJECT_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}` : "",
			previewText: campaign.previewText,
			format: campaign.format,
			markdown: campaign.markdown,
			html: campaign.html,
			thumbnailUrl: campaign.thumbnailUrl,
			// A copy of an API draft is still content from the API key's holder, not from the dashboard.
			...(campaign.source === "api" && { source: "api" }),
		})
		.returning({ _id: campaigns._id });
	revalidatePath("/campaigns");
	redirect(`/campaigns/${copy._id}`);
}

// Discarded campaigns keep everything: canceled hides them from the lists and stops a scheduled send.
export async function discardCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Only drafts can be discarded" };

	const discarded = await updateCampaign(isEditable(campaign._id), { status: "canceled", scheduledAt: null });
	if (!discarded) return { error: "This campaign is already sending" };

	revalidatePath("/");
	revalidatePath("/campaigns");
	return { ok: true };
}

// The page lives at /p/<slug> once the issue goes out. A draft without one gets the subject's slug then.
// Slugs are unique across newsletters: /p/<slug> on the app's own domain finds an issue by slug alone.
export async function updateArchiveSlug(id, value) {
	const campaign = await findCampaign(id);
	if (!campaign || campaign.status === "canceled") return { error: "Campaign not found" };

	const slug = String(value ?? "").trim().toLowerCase().replace(/-+$/, "");
	const isPublished = PUBLISHED_STATUSES.includes(campaign.status);
	if (!slug && isPublished) return { error: "A sent issue needs a URL" };
	if (slug && !ARCHIVE_SLUG_PATTERN.test(slug)) return { error: "Use lowercase letters, digits and hyphens" };
	if (slug === (campaign.archiveSlug ?? "")) return { ok: true, archiveSlug: slug };
	const taken = await getDb()
		.select({ _id: campaigns._id })
		.from(campaigns)
		.where(and(ne(campaigns._id, campaign._id), eq(campaigns.archiveSlug, slug)))
		.limit(1);
	if (slug && taken.length > 0) return { error: "Another issue uses this URL" };

	try {
		await updateCampaign(eq(campaigns._id, campaign._id), { archiveSlug: slug || null });
	} catch (error) {
		if (isUniqueViolation(error)) return { error: "Another issue uses this URL" };
		throw error;
	}

	revalidatePath(`/campaigns/${id}`);
	if (isPublished) {
		revalidatePath("/campaigns");
		revalidateArchive();
	}
	return { ok: true, archiveSlug: slug };
}

// Subject line ideas from the Neon AI Gateway, for the draft as it is in the editor.
const IDEAS_RATE_LIMIT = { name: "subject-ideas", limit: 60, window: "1 h" };

export async function suggestSubjects(id, { subject, body } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!isAiGatewayConfigured()) return { error: "The AI Gateway isn't set up: run neon deploy, then neon env pull" };
	if (await isRateLimited({ ...IDEAS_RATE_LIMIT, key: "admin" })) return { error: "Too many ideas this hour, try again later" };

	const newsletter = await findNewsletterById(campaign.newsletterId, ["name", "description"]);
	const draft = {
		...campaign,
		subject: String(subject ?? campaign.subject ?? "").slice(0, MAX_SUBJECT_LENGTH),
		...(body !== undefined && {
			format: campaign.format === "markdown" ? "rich" : campaign.format,
			html: String(body).slice(0, MAX_BODY_BYTES),
		}),
	};
	try {
		return { ideas: await suggestSubjectLines({ newsletter, campaign: draft }) };
	} catch (error) {
		console.error("[campaigns] Subject ideas failed:", error);
		if (error.message === "Write some of the issue first") return { error: error.message };
		// The gateway says why it refused (no credits, a model the branch doesn't serve): only the admin sees it.
		if (error.statusCode >= 400 && error.statusCode < 500 && error.data?.error?.message) {
			return { error: `AI Gateway: ${error.data.error.message}` };
		}
		return { error: "Couldn't get ideas, try again" };
	}
}
