import { scoped } from "./account-scope.js";
import { codedError } from "./account-state.js";
import { SEGMENT_DELETED, compileSegment } from "./segments.js";
import { isObjectIdString } from "./validation.js";
import Contact from "../models/Contact.js";
import Segment from "../models/Segment.js";

// A segment the account still has. Deleted ones stay in the database for the campaigns that went to them.
export function findLiveSegment(account, id, select) {
	const query = Segment.findOne(scoped(account, { _id: id, deletedAt: null }));
	return (select ? query.select(select) : query).lean();
}

// A newsletter's segments, oldest first, as the dashboard lists them.
export function listLiveSegments(account, newsletterId) {
	return Segment.find(scoped(account, { newsletterId, deletedAt: null }))
		.sort({ createdAt: 1, _id: 1 })
		.limit(100)
		.select({ name: 1, match: 1, conditions: 1 })
		.lean();
}

// The contacts list's filter for one of the account's segments: its newsletter's contacts that meet its conditions,
// whatever their status. null for a segment the account doesn't have anymore.
export async function findSegmentListFilter(account, id) {
	const segment = isObjectIdString(String(id)) ? await findLiveSegment(account, id, { newsletterId: 1, match: 1, conditions: 1 }) : null;
	return segment && { newsletterId: segment.newsletterId, $and: [compileSegment(segment)] };
}

// Who a campaign goes to: null for every active contact, else its segment's filter as of now. A campaign whose segment
// was deleted sends to nobody until it gets another one or none.
export async function findCampaignSegmentFilter(campaign, { now = new Date() } = {}) {
	if (!campaign.segmentId) return null;
	const segment = await findLiveSegment(campaign.accountId, campaign.segmentId, { match: 1, conditions: 1 });
	if (!segment) throw codedError({ code: "send_check_failed", message: SEGMENT_DELETED });
	return compileSegment(segment, { now });
}

function audienceFilter(account, newsletterId, filter) {
	return scoped(account, { newsletterId, status: "active", ...(filter && { $and: [filter] }) });
}

// Active contacts of a newsletter a segment's filter picks (all of them without one), and those this account never
// emailed, which a send takes in steps (lib/first-send.js).
export async function countAudience(account, newsletterId, filter) {
	const audience = audienceFilter(account, newsletterId, filter);
	const [contacts, neverMailed] = await Promise.all([
		Contact.countDocuments(audience),
		Contact.countDocuments({ ...audience, lastSentAt: null }),
	]);
	return { contacts, neverMailed };
}

// The contacts page's cards: every active contact, then each segment's.
export async function countSegmentCards(account, newsletterId, segments) {
	const counts = await Promise.all(
		[null, ...segments.map((segment) => compileSegment(segment))].map((filter) =>
			Contact.countDocuments(audienceFilter(account, newsletterId, filter))
		)
	);
	return { everyone: counts[0], segments: counts.slice(1) };
}
