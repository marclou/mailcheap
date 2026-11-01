import "server-only";
import { blockAccount } from "@/lib/account-blocks";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { REJECTED_PAUSE_CODE, REJECTED_PAUSE_REASON, REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { connectDb } from "@/lib/db";
import { notifyIssueReview } from "@/lib/notifications";
import { queueCampaign } from "@/lib/sending";
import { SIGNUP_EMAIL_INSTEAD, SIGNUP_EMAIL_KINDS, SIGNUP_EMAIL_NAMES, getCurrentReview, getSignupEmailPath } from "@/lib/signup-email-review";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

const MAX_NOTE_LENGTH = 300;
const ACCEPTABLE_USE = "It doesn't follow MailCheap's acceptable use policy.";

function cleanNote(note) {
	return String(note ?? "")
		.trim()
		.slice(0, MAX_NOTE_LENGTH)
		.replace(/\.+$/, "");
}

// The campaign a content check holds, whatever its account: admins decide on any of them (app/admin/actions.js).
async function findHeld(campaignId) {
	await connectDb();
	const campaign = await Campaign.findById(campaignId).select({ accountId: 1, status: 1, pauseCode: 1, subject: 1 }).setOptions({ crossAccount: true }).lean();
	return campaign?.status === "paused" && campaign.pauseCode === REVIEW_PAUSE_CODE ? campaign : null;
}

// Back to draft with the decision on it, then sent as its owner sent it: the check passes the content it approved.
export async function approveReview({ campaignId, admin }) {
	const campaign = await findHeld(campaignId);
	if (!campaign) return { error: "Nothing waits for a review here" };
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: "paused", pauseCode: REVIEW_PAUSE_CODE },
		{
			$set: { status: "draft", "review.decision": "approved", "review.decidedBy": admin.email, "review.decidedAt": new Date() },
			$unset: { pauseCode: 1, pauseReason: 1, scheduledAt: 1 },
		}
	);
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	console.info(`[admin] ${admin.email} approved campaign ${campaign._id} after its content check`);
	try {
		await queueCampaign({ accountId: String(campaign.accountId), campaignId: String(campaign._id) });
	} catch (error) {
		await sendAlert({
			accountId: campaign.accountId,
			key: `content-approved:${campaign._id}`,
			title: "Send didn't start",
			detail: `Your issue was approved, but it couldn't go out: ${error.message.replace(/\.$/, "")}. It's a draft again.`,
			path: `/campaigns/${campaign._id}`,
			cooldownMinutes: 1,
		});
		return { error: `Approved, but the send didn't start: ${error.message}. It's a draft again.` };
	}
	// The website's pages are cached: an approved issue that goes on it shows there now, not at their next refresh.
	revalidateArchive();
	await notifyIssueReview(campaign, { isApproved: true });
	return { ok: true };
}

// It stays paused for good; its owner reads the note, or a plain line, and can duplicate it to change it.
export async function rejectReview({ campaignId, admin, note = "", block = false }) {
	const campaign = await findHeld(campaignId);
	if (!campaign) return { error: "Nothing waits for a review here" };
	const text = cleanNote(note);
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: "paused", pauseCode: REVIEW_PAUSE_CODE },
		{
			$set: {
				pauseCode: REJECTED_PAUSE_CODE,
				pauseReason: text ? `${REJECTED_PAUSE_REASON}: ${text}` : REJECTED_PAUSE_REASON,
				"review.decision": "rejected",
				"review.decidedBy": admin.email,
				"review.decidedAt": new Date(),
				...(text && { "review.note": text }),
			},
		}
	);
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	console.info(`[admin] ${admin.email} rejected campaign ${campaign._id} after its content check${block ? " and blocked its account" : ""}`);
	await sendAlert({
		accountId: campaign.accountId,
		key: `content-rejected:${campaign._id}`,
		title: "An issue can't be sent",
		detail: text ? `${text}.` : ACCEPTABLE_USE,
		path: `/campaigns/${campaign._id}`,
		cooldownMinutes: 1,
	});
	if (block) {
		await blockAccount(campaign.accountId, {
			reason: text || "Your account is under review",
			by: "admin",
			detail: `Blocked by ${admin.email} after the content check of campaign ${campaign._id}`,
		});
	}
	return { ok: true };
}

// A newsletter's own welcome, confirmation or last-chance email the check holds, whatever its account, as it is now: an
// admin decides on the content they see, and a version its owner saved since gets its own check.
async function findHeldSignupEmail(newsletterId, kind) {
	if (!SIGNUP_EMAIL_KINDS.includes(kind)) return null;
	await connectDb();
	const newsletter = await Newsletter.findById(newsletterId).select("+reviews").setOptions({ crossAccount: true }).lean();
	const review = newsletter ? getCurrentReview(newsletter, kind) : null;
	return review?.outcome === "block" && !review.decision ? { newsletter, kind, review } : null;
}

// Only while the review is still the one the admin saw: the same content, undecided.
function decideSignupEmail({ newsletter, kind, review }, decision) {
	const field = `reviews.${kind}`;
	return Newsletter.updateOne(
		{ accountId: newsletter.accountId, _id: newsletter._id, [`${field}.hash`]: review.hash, [`${field}.decision`]: null },
		{ $set: Object.fromEntries(Object.entries(decision).map(([key, value]) => [`${field}.${key}`, value])) }
	);
}

// From now on, it goes out as its owner wrote it.
export async function approveSignupEmailReview({ newsletterId, kind, admin }) {
	const held = await findHeldSignupEmail(newsletterId, kind);
	if (!held) return { error: "Nothing waits for a review here" };
	const { modifiedCount } = await decideSignupEmail(held, { decision: "approved", decidedBy: admin.email, decidedAt: new Date() });
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	console.info(`[admin] ${admin.email} approved the ${SIGNUP_EMAIL_NAMES[kind]} email of newsletter ${newsletterId} after its content check`);
	return { ok: true };
}

// It stays held until its owner changes it; they read the note, or a plain line.
export async function rejectSignupEmailReview({ newsletterId, kind, admin, note = "", block = false }) {
	const held = await findHeldSignupEmail(newsletterId, kind);
	if (!held) return { error: "Nothing waits for a review here" };
	const text = cleanNote(note);
	const { modifiedCount } = await decideSignupEmail(held, {
		decision: "rejected",
		decidedBy: admin.email,
		decidedAt: new Date(),
		...(text && { note: text }),
	});
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	const { newsletter } = held;
	const name = SIGNUP_EMAIL_NAMES[kind];
	console.info(`[admin] ${admin.email} rejected the ${name} email of newsletter ${newsletter._id} after its content check${block ? " and blocked its account" : ""}`);
	await sendAlert({
		accountId: newsletter.accountId,
		key: `signup-email-rejected:${newsletter._id}:${kind}`,
		title: `Your ${name} email can't be sent`,
		detail: `${text ? `${text}.` : ACCEPTABLE_USE} ${SIGNUP_EMAIL_INSTEAD[kind]} until you change it.`,
		path: getSignupEmailPath(newsletter._id, kind),
		cooldownMinutes: 1,
	});
	if (block) {
		await blockAccount(newsletter.accountId, {
			reason: text || "Your account is under review",
			by: "admin",
			detail: `Blocked by ${admin.email} after the content check of the ${name} email of newsletter ${newsletter._id}`,
		});
	}
	return { ok: true };
}
