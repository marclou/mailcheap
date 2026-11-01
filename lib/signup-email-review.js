import "server-only";
import { sendAlert } from "@/lib/alerts";
import { getOwnConfirmation } from "@/lib/confirmation-content";
import {
	alertCheckFailed,
	alertOverCheckLimit,
	describeCategories,
	getReviewInput,
	hashReviewInput,
	isContentReviewEnabled,
	isOverCheckLimit,
	runReview,
	toStoredReview,
} from "@/lib/content-review";
import { getOwnLastChance } from "@/lib/last-chance-content";
import { getSectionPath } from "@/lib/newsletter-sections";
import { getNewsletterPagePath } from "@/lib/newsletters";
import { getWelcomeContent } from "@/lib/sending-rules";
import Newsletter from "@/models/Newsletter";

// The newsletter's own emails that MailCheap sends on its own once they're written: the confirmation and welcome emails
// new subscribers get, and the list cleanup's last-chance email (lib/newsletter-emails.js).
export const SIGNUP_EMAIL_KINDS = ["confirmation", "welcome", "lastChance"];
// Each kind as its messages name it (models/Message.js), and in words.
export const SIGNUP_EMAIL_MESSAGE_KINDS = { confirmation: "confirmation", welcome: "welcome", lastChance: "last-chance" };
export const SIGNUP_EMAIL_NAMES = { confirmation: "confirmation", welcome: "welcome", lastChance: "last-chance" };
const TITLES = { confirmation: "Confirmation email", welcome: "Welcome email", lastChance: "Last-chance email" };
// What new subscribers, or cold contacts, get while the newsletter's own email waits for an admin, or after one rejected it.
export const SIGNUP_EMAIL_INSTEAD = {
	confirmation: "New subscribers get the built-in confirmation email",
	welcome: "New subscribers get no welcome email",
	lastChance: "Contacts who stopped opening get the built-in last-chance email",
};
const SECTIONS = { confirmation: "signups", welcome: "welcome", lastChance: "cleanup" };
// These emails keep going out, so a check that couldn't run is tried again, an hour later.
const RETRY_FAILED_MS = 60 * 60_000;

// The newsletter's own email of this kind as it goes out, or null: a welcome email that's off has nothing to check, and
// neither do the built-in confirmation and last-chance emails, MailCheap's own.
export function getOwnSignupEmail(newsletter, kind) {
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "lastChance") return newsletter?.cleanup?.enabled ? getOwnLastChance(newsletter) : null;
	return newsletter?.requireConfirmation ? getOwnConfirmation(newsletter) : null;
}

// Its owner's settings page for that email, from anywhere.
export function getSignupEmailPath(newsletterId, kind) {
	return getNewsletterPagePath(newsletterId, getSectionPath(SECTIONS[kind]));
}

function readCheck(newsletter, kind) {
	const content = getOwnSignupEmail(newsletter, kind);
	if (!content) return null;
	const input = getReviewInput({ campaign: content, newsletter });
	return { input, hash: hashReviewInput(input) };
}

// Waiting for an admin, or rejected by one, until the content changes.
function isHeld(review) {
	return review.decision === "rejected" || (review.outcome === "block" && review.decision !== "approved");
}

// The stored check of the newsletter's own email of this kind when it read the content as it is now, else null.
// newsletter: with its reviews (select("+reviews")).
export function getCurrentReview(newsletter, kind) {
	const check = readCheck(newsletter, kind);
	const stored = newsletter?.reviews?.[kind];
	return check && stored?.hash === check.hash ? stored : null;
}

// Checks the newsletter's own email of this kind once per version of its content, as an issue is (lib/content-review.js),
// and says whether it's held: new subscribers then get the built-in confirmation email or no welcome email, and cold
// contacts the built-in last-chance email. A check that can't run lets it go. newsletter: with its reviews.
export async function reviewSignupEmail({ account, newsletter, kind, now = Date.now() }) {
	const check = readCheck(newsletter, kind);
	if (!check) return { held: false };
	const stored = newsletter.reviews?.[kind];
	const isSameContent = stored?.hash === check.hash;
	const isRetry = isSameContent && stored.outcome === "error" && now - new Date(stored.checkedAt).getTime() >= RETRY_FAILED_MS;
	if (isSameContent && !isRetry) return { held: isHeld(stored) };
	if (!isContentReviewEnabled()) return { held: false };

	const review = await runReview(account, check.input, check.hash, { reuse: false });
	console.info(`[content-review] newsletter ${newsletter._id} ${SIGNUP_EMAIL_NAMES[kind]} email: ${review.outcome}${review.categories?.length ? ` (${review.categories.join(", ")})` : ""}`);
	// Kept only in place of the check it read: another send or save may have checked newer content meanwhile, or an admin
	// decided on it. Its tips aren't: only an issue's review step shows them.
	const field = `reviews.${kind}`;
	const { modifiedCount } = await Newsletter.updateOne(
		{
			accountId: newsletter.accountId,
			_id: newsletter._id,
			[`${field}.hash`]: stored?.hash ?? null,
			[`${field}.checkedAt`]: stored?.checkedAt ?? null,
		},
		{ $set: { [field]: toStoredReview(check.hash, { ...review, tips: undefined }) } }
	);
	if (modifiedCount) await alertAdmins({ newsletter, kind, review });
	return { held: isHeld(review) };
}

// After a save, so its owner sees right away whether the email they saved waits, and new subscribers don't wait for it.
export async function reviewSignupEmails({ account, newsletterId }) {
	const newsletter = await Newsletter.findOne({ accountId: account._id, _id: newsletterId }).select("+reviews").lean();
	if (!newsletter) return;
	for (const kind of SIGNUP_EMAIL_KINDS) await reviewSignupEmail({ account, newsletter, kind });
}

// What its owner sees of the check of their own email of each kind: in_review, or rejected with the admin's note, and
// null while it goes out. Never why. The reviews are read here, never on the documents pages and the API get.
export async function getSignupEmailReviewStatuses(newsletter) {
	const stored = await Newsletter.findOne({ accountId: newsletter.accountId, _id: newsletter._id }).select("+reviews").lean();
	const withReviews = { ...newsletter, reviews: stored?.reviews };
	return Object.fromEntries(
		SIGNUP_EMAIL_KINDS.map((kind) => {
			const review = getCurrentReview(withReviews, kind);
			if (!review || !isHeld(review)) return [kind, null];
			return [kind, review.decision === "rejected" ? { status: "rejected", note: review.note ?? null } : { status: "in_review", note: null }];
		})
	);
}

// Admin alerts only (no account): its owner sees In review, never the check's reasons. They name the email, never its text.
function alertAdmins({ newsletter, kind, review }) {
	const name = SIGNUP_EMAIL_NAMES[kind];
	const what = `The ${name} email of newsletter ${newsletter._id}`;
	const where = `the ${name} email of newsletter ${newsletter._id} of account ${newsletter.accountId}`;
	const path = `/admin/newsletters/${newsletter._id}`;
	if (isOverCheckLimit(review)) return alertOverCheckLimit({ accountId: newsletter.accountId, what, path });
	if (review.outcome === "block") {
		return sendAlert({
			accountId: null,
			key: `signup-email-review:${newsletter._id}:${kind}`,
			title: `${TITLES[kind]} held for review`,
			detail: `The content check found ${describeCategories(review.categories)} in ${where}. ${SIGNUP_EMAIL_INSTEAD[kind]} until you decide.`,
			action: "Approve or reject it on the newsletter's admin page.",
			path,
			cooldownMinutes: 1,
		});
	}
	if (review.outcome === "flag") {
		return sendAlert({
			accountId: null,
			key: `signup-email-flagged:${newsletter._id}:${kind}`,
			title: `${TITLES[kind]} flagged`,
			detail: `The content check wasn't sure about ${where} (${describeCategories(review.categories)}). It goes out.`,
			action: "Take a look when you can.",
			path,
			cooldownMinutes: 1,
		});
	}
	if (review.outcome === "error") return alertCheckFailed({ failures: review.failures, what: `${what} of account ${newsletter.accountId}` });
	return null;
}
