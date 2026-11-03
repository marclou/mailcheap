// The content check's pauses (lib/content-review.js), shared with the pages that show them. What the owner reads never
// says why: the check's reasons are for admins only.
export const REVIEW_PAUSE_CODE = "content_review";
export const REJECTED_PAUSE_CODE = "content_rejected";
export const REVIEW_PAUSE_REASON = "Under review: a person checks it before it goes out, usually within a few hours";
export const REJECTED_PAUSE_REASON = "This issue can't be sent";
export const REVIEW_CODES = new Set([REVIEW_PAUSE_CODE, REJECTED_PAUSE_CODE]);
// A change to the page of an issue that's out, which the check would hold, or which it can't read this hour: the page
// keeps what it showed.
export const WEB_CHANGE_REFUSED = "This change can't go on your website, so your page keeps its current version";
export const WEB_CHANGE_TOO_MANY = "Too many changes to check this hour: try again later";

// The paid classifier's budget per account. Moderation is free, so it keeps running past it, under a cap that only stops
// a flood. New content past the budget waits for an admin: nothing goes out unchecked.
export const CLASSIFIER_CHECKS = { name: "content-classifier", limit: 100, window: "1 h" };
export const MODERATION_CHECKS = { name: "content-moderation", limit: 500, window: "1 h" };
// The review step's own budget per account, on top of the classifier's: a send of the content it checked uses its check.
// Past it, the review step has no tips and a send checks as it would have.
export const DRAFT_CHECKS = { name: "content-draft-check", limit: 30, window: "1 h" };
