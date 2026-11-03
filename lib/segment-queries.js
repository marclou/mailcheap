import { Types } from "mongoose";
import { scoped, scopedNewsletter } from "./account-scope.js";
import { codedError } from "./account-state.js";
import { contactListFilter, readDay } from "./contacts.js";
import { GMAIL_DOMAINS } from "./email-aliases.js";
import { ACTIVITY_DAYS, SEGMENT_DELETED, compileSegment } from "./segments.js";
import { isObjectIdString } from "./validation.js";
import Contact from "../models/Contact.js";
import Segment from "../models/Segment.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// A segment the account still has, of a team member's newsletter for them. Deleted ones stay in the database for the
// campaigns that went to them.
export function findLiveSegment(account, id, select) {
	const query = Segment.findOne(scopedNewsletter(account, { _id: id, deletedAt: null }));
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

// What a contacts export holds, read the same way when its link is made (its count) and when its file is downloaded.
// signedUpSince and signedUpBefore: YYYY-MM-DD days. null when the segment it names is gone or isn't the account's.
export async function findExportFilter(account, { segmentId, signedUpSince, signedUpBefore, ...filters }) {
	const segmentFilter = segmentId ? await findSegmentListFilter(account, segmentId) : null;
	if (segmentId && !segmentFilter) return null;
	return contactListFilter(account, {
		newsletterId: filters.newsletterId,
		status: filters.status,
		query: filters.query,
		tag: filters.tag,
		source: filters.source,
		signedUpSince: readDay(signedUpSince),
		signedUpBefore: readDay(signedUpBefore),
		segmentFilter,
	});
}

// A newsletter's active contacts a segment's filter picks (all of them without one), and how many of them opened and
// clicked an email in the last ACTIVITY_DAYS days. A click sets the last open too.
export async function countActivity(account, newsletterId, filter, { now = new Date() } = {}) {
	const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS);
	const [counts] = await Contact.aggregate([
		{ $match: audienceFilter(account, new Types.ObjectId(String(newsletterId)), filter) },
		{
			$group: {
				_id: null,
				contacts: { $sum: 1 },
				opened: { $sum: { $cond: [{ $gte: ["$lastOpenAt", since] }, 1, 0] } },
				clicked: { $sum: { $cond: [{ $gte: ["$lastClickAt", since] }, 1, 0] } },
			},
		},
	]);
	return { contacts: counts?.contacts ?? 0, opened: counts?.opened ?? 0, clicked: counts?.clicked ?? 0 };
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
	const [contacts, neverMailed, gmail] = await Promise.all([
		Contact.countDocuments(audience),
		Contact.countDocuments({ ...audience, lastSentAt: null }),
		Contact.countDocuments({ ...audience, email: GMAIL_EMAIL }),
	]);
	return { contacts, neverMailed, gmail };
}

// Gmail's own addresses, which a new domain's first day holds back past its share (lib/send-spread.js).
const GMAIL_EMAIL = new RegExp(`@(${GMAIL_DOMAINS.map((domain) => domain.replace(/\./g, "\\.")).join("|")})$`);

// The segments whose conditions a contact meets, whatever its status, as the contacts list filters them: one query for
// all of them.
export async function findContactSegments(account, contact, segments) {
	if (segments.length === 0) return [];
	const [matches] = await Contact.aggregate([
		{ $match: scoped(account, { _id: contact._id }) },
		{ $facet: Object.fromEntries(segments.map((segment, index) => [`s${index}`, [{ $match: compileSegment(segment) }, { $project: { _id: 1 } }]])) },
	]);
	return segments.filter((_, index) => matches?.[`s${index}`]?.length > 0);
}

// The live segments of a newsletter among these IDs, which an issue's sections name (lib/sections.js). A deleted one, or
// another newsletter's or account's, isn't there, and its sections show to nobody.
export function findSectionSegments(account, newsletterId, ids) {
	if (ids.length === 0) return [];
	return Segment.find(scoped(account, { _id: { $in: ids }, newsletterId, deletedAt: null }))
		.select({ name: 1, match: 1, conditions: 1 })
		.lean();
}

// Which of these contacts each segment picks, as its conditions read now: its ID to theirs, in one query.
export async function findSegmentMembers(account, contactIds, segments) {
	const members = new Map(segments.map((segment) => [String(segment._id), new Set()]));
	if (segments.length === 0 || contactIds.length === 0) return members;
	const [matches] = await Contact.aggregate([
		{ $match: scoped(account, { _id: { $in: contactIds.map((id) => new Types.ObjectId(String(id))) } }) },
		{ $facet: Object.fromEntries(segments.map((segment, index) => [`s${index}`, [{ $match: compileSegment(segment) }, { $project: { _id: 1 } }]])) },
	]);
	for (const [index, segment] of segments.entries()) {
		for (const { _id } of matches?.[`s${index}`] ?? []) members.get(String(segment._id)).add(String(_id));
	}
	return members;
}

// How many of the active contacts an issue goes to each tag or segment of its sections picks. audience: the issue's own
// segment filter, or null for every active contact. groups: { kind, value }; segments: the live ones among them.
export async function countSectionGroups(account, newsletterId, audience, groups, segments) {
	const counts = await Promise.all(
		groups.map((group) => {
			const segment = group.kind === "segment" ? segments.find(({ _id }) => String(_id) === group.value) : null;
			if (group.kind === "segment" && !segment) return null;
			const filter = group.kind === "tag" ? { tags: group.value } : compileSegment(segment);
			return Contact.countDocuments(audienceFilter(account, newsletterId, audience ? { $and: [audience, filter] } : filter));
		})
	);
	return groups.map((group, index) => ({ group, readers: counts[index] }));
}

// How many of the active contacts an issue goes to have each tag, in one query: each tag to its count. audience: as
// above. The aggregation doesn't cast, so the newsletter's ID is made an ObjectId here.
export async function countSectionTags(account, newsletterId, audience) {
	const tagged = { "tags.0": { $exists: true } };
	const rows = await Contact.aggregate([
		{ $match: audienceFilter(account, new Types.ObjectId(String(newsletterId)), audience ? { $and: [audience, tagged] } : tagged) },
		{ $unwind: "$tags" },
		{ $group: { _id: "$tags", readers: { $sum: 1 } } },
	]);
	return new Map(rows.map(({ _id, readers }) => [_id, readers]));
}

// Every active contact, then each segment's.
export async function countSegmentCards(account, newsletterId, segments) {
	const counts = await Promise.all(
		[null, ...segments.map((segment) => compileSegment(segment))].map((filter) =>
			Contact.countDocuments(audienceFilter(account, newsletterId, filter))
		)
	);
	return { everyone: counts[0], segments: counts.slice(1) };
}
