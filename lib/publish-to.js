import { REJECTED_PAUSE_CODE, REVIEW_CODES, REVIEW_PAUSE_CODE } from "./content-review-codes.js";

// Where an issue goes (Campaign.publishTo): by email and on the newsletter's website, by email only, or on the website
// only. Issues from before the choice have none and went both ways.
export const PUBLISH_TARGETS = ["both", "email", "web"];
export const PUBLISH_OPTIONS = [
	{ value: "both", label: "Email and web", description: "Sent to your contacts and on your website" },
	{ value: "email", label: "Email only", description: "Sent, but never on your website" },
	{ value: "web", label: "Web only", description: "On your website, no email goes out" },
];
// An issue that went out: by email, or on the website alone (a web-only issue is sent with no messages).
export const PUBLISHED_STATUSES = ["sending", "paused", "sent"];
// The issues the newsletter's website shows: out, not email-only, and not held by the content check.
export const WEB_FILTER = {
	status: { $in: PUBLISHED_STATUSES },
	publishTo: { $ne: "email" },
	pauseCode: { $nin: [REVIEW_PAUSE_CODE, REJECTED_PAUSE_CODE] },
};

export function readPublishTo(campaign) {
	return PUBLISH_TARGETS.includes(campaign?.publishTo) ? campaign.publishTo : "both";
}

export function sendsEmail(campaign) {
	return readPublishTo(campaign) !== "web" && campaign?.channel !== "sms";
}

export function sendsSms(campaign) {
	return campaign?.channel === "sms";
}

export function goesOnWeb(campaign) {
	return readPublishTo(campaign) !== "email";
}

export function describePublishTo(campaign) {
	return PUBLISH_OPTIONS.find(({ value }) => value === readPublishTo(campaign)).label;
}

// WEB_FILTER, for a campaign already loaded.
export function isOnWebsite(campaign) {
	return PUBLISHED_STATUSES.includes(campaign?.status) && goesOnWeb(campaign) && !REVIEW_CODES.has(campaign.pauseCode);
}
