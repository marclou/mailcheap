import "server-only";
import * as z from "zod";
import { scoped } from "@/lib/account-scope";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import { dateOutput, findNewsletter, idInput, newsletterFilterInput, newsletterInput, toIso } from "@/lib/actions/shared";
import { countAudience, findLiveSegment } from "@/lib/segment-queries";
import { MAX_SEGMENT_CONDITIONS, MAX_SEGMENT_NAME, SEGMENT_MATCHES, SEGMENT_OPS, checkSegmentRules, compileSegment, describeSegment } from "@/lib/segments";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";
import Segment from "@/models/Segment";

const GROUP = "Segments";
const MAX_SEGMENTS = 100;
// A campaign in one of these goes out to its segment later: the segment can't go before it does.
const WAITING_STATUSES = ["scheduled", "sending", "paused"];

const segmentId = idInput("segment");
const nameInput = z.string().trim().min(1).max(MAX_SEGMENT_NAME).describe(`The segment's name, ${MAX_SEGMENT_NAME} characters at most`);
const matchInput = z.enum(SEGMENT_MATCHES).describe("all: contacts meeting every condition (the default). any: contacts meeting at least one.");
const conditionInput = z.object({
	field: z
		.string()
		.trim()
		.max(40)
		.describe(
			"opened, clicked: the last open or click (a click counts as an open). missed_issues: issues received in a row without opening or clicking any. emails_opened: emails opened in all. signed_up: the signup date. source: where the contact came from (website, import, dashboard, api, or a source an API caller gave). email: the address. tag: one of the contact's tags. first_name: whether the contact has a first name. fields.<key>: one of the account's own fields (list_contact_fields)."
		),
	op: z
		.enum(SEGMENT_OPS)
		.describe(
			"opened, clicked: within, not_within (days) or never. missed_issues, emails_opened: at_least or less_than (a number). signed_up: within, not_within (days), before or since (a date). source: is or is_not. email: contains or ends_with. tag: has or has_not. first_name: is_set or not_set. fields.<key>: is, contains, is_set or not_set for text; at_least, less_than, is_set or not_set for numbers; before, since, is_set or not_set for dates."
		),
	value: z
		.union([z.number(), z.string()])
		.optional()
		.describe(
			"Days (1 to 3650) for within and not_within, a number for at_least and less_than, YYYY-MM-DD (UTC) for before and since, a tag for has and has_not, text for the rest. None for never, is_set and not_set."
		),
});
const conditionsInput = z
	.array(conditionInput)
	.min(1)
	.max(MAX_SEGMENT_CONDITIONS)
	.describe(`The conditions, ${MAX_SEGMENT_CONDITIONS} at most. Dates count back from each send, so "within 30 days" moves with time.`);

const CountsSchema = {
	contacts: z.number().int().describe("Active contacts it picks now"),
	neverMailed: z.number().int().describe("Of those, contacts this account never emailed: a send takes them in steps"),
};
const SegmentSchema = z.object({
	id: z.string(),
	newsletterId: z.string(),
	name: z.string(),
	match: z.enum(SEGMENT_MATCHES),
	conditions: z.array(z.object({ field: z.string(), op: z.enum(SEGMENT_OPS), value: z.union([z.number(), z.string()]).nullable() })),
	description: z.string().describe("The conditions in words"),
	...CountsSchema,
	createdAt: dateOutput,
	updatedAt: dateOutput,
});

function readRules(account, input) {
	const { rules, problem } = checkSegmentRules(input, { fields: account.contactFields ?? [] });
	if (problem) throw actionError("validation_failed", problem);
	return rules;
}

async function toSegment(account, segment) {
	const rules = { match: segment.match ?? "all", conditions: segment.conditions ?? [] };
	return {
		id: String(segment._id),
		newsletterId: String(segment.newsletterId),
		name: segment.name,
		match: rules.match,
		conditions: rules.conditions.map(({ field, op, value }) => ({ field, op, value: value ?? null })),
		description: describeSegment(rules, account.contactFields ?? []),
		...(await countAudience(account, segment.newsletterId, compileSegment(rules))),
		createdAt: toIso(segment.createdAt),
		updatedAt: toIso(segment.updatedAt),
	};
}

async function findSegment(account, id) {
	const segment = isObjectIdString(id) ? await findLiveSegment(account, id) : null;
	if (!segment) throw actionError("not_found", "Segment not found");
	return segment;
}

const listSegments = defineAction({
	name: "list_segments",
	tryWithoutPlan: true,
	title: "List segments",
	group: GROUP,
	description: "Lists segments, oldest first, with their conditions in words and how many active contacts each picks now.",
	http: { method: "GET", path: "/segments" },
	readOnly: true,
	input: z.object({ newsletter: newsletterFilterInput }),
	output: z.object({ segments: z.array(SegmentSchema) }),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter, { _id: 1 }) : null;
		const segments = await Segment.find(scoped(account, { deletedAt: null, ...(newsletter && { newsletterId: newsletter._id }) }))
			.sort({ createdAt: 1, _id: 1 })
			.limit(MAX_SEGMENTS)
			.lean();
		return { segments: await Promise.all(segments.map((segment) => toSegment(account, segment))) };
	},
});

const getSegment = defineAction({
	name: "get_segment",
	tryWithoutPlan: true,
	title: "Get a segment",
	group: GROUP,
	description: "Gets one segment with its conditions and how many active contacts it picks now.",
	http: { method: "GET", path: "/segments/{id}" },
	readOnly: true,
	input: z.object({ id: segmentId }),
	output: SegmentSchema,
	handler: async ({ account, input }) => toSegment(account, await findSegment(account, input.id)),
});

const countSegment = defineAction({
	name: "count_segment",
	tryWithoutPlan: true,
	title: "Count a segment's contacts",
	group: GROUP,
	description: "Counts the active contacts some conditions would pick, without saving anything: try them before create_segment.",
	http: { method: "POST", path: "/segments/count" },
	readOnly: true,
	rateLimit: { limit: 600, window: "1 h" },
	example: { conditions: [{ field: "opened", op: "within", value: 30 }] },
	input: z.object({ newsletter: newsletterInput, match: matchInput.optional(), conditions: conditionsInput }),
	output: z.object({ description: z.string().describe("The conditions in words"), ...CountsSchema }),
	handler: async ({ account, input }) => {
		const newsletter = await findNewsletter(account, input.newsletter, { _id: 1 });
		const rules = readRules(account, input);
		return {
			description: describeSegment(rules, account.contactFields ?? []),
			...(await countAudience(account, newsletter._id, compileSegment(rules))),
		};
	},
});

const createSegment = defineAction({
	name: "create_segment",
	tryWithoutPlan: true,
	title: "Create a segment",
	group: GROUP,
	description:
		"Saves conditions that pick some of a newsletter's contacts, to send campaigns to them only (segment on update_campaign, send_campaign or schedule_campaign). Contacts join and leave it as they meet the conditions.",
	http: { method: "POST", path: "/segments", status: 201 },
	rateLimit: { limit: 60, window: "1 h" },
	example: { name: "Engaged", conditions: [{ field: "opened", op: "within", value: 30 }] },
	input: z.object({ newsletter: newsletterInput, name: nameInput, match: matchInput.optional(), conditions: conditionsInput }),
	output: SegmentSchema,
	handler: async ({ account, input }) => {
		const newsletter = await findNewsletter(account, input.newsletter, { _id: 1 });
		const rules = readRules(account, input);
		const count = await Segment.countDocuments(scoped(account, { newsletterId: newsletter._id, deletedAt: null }));
		if (count >= MAX_SEGMENTS) throw actionError("conflict", `A newsletter has ${MAX_SEGMENTS} segments at most`);
		const segment = await Segment.create({ accountId: account._id, newsletterId: newsletter._id, name: input.name, ...rules });
		return toSegment(account, segment.toObject());
	},
});

const updateSegment = defineAction({
	name: "update_segment",
	tryWithoutPlan: true,
	title: "Update a segment",
	group: GROUP,
	description:
		"Renames a segment or changes its conditions. Send only what changes; conditions replace the old ones. Campaigns going to it, scheduled ones included, use the new conditions when they go out.",
	http: { method: "PATCH", path: "/segments/{id}" },
	idempotent: true,
	example: { name: "Engaged this quarter", conditions: [{ field: "opened", op: "within", value: 90 }] },
	input: z.object({ id: segmentId, name: nameInput.optional(), match: matchInput.optional(), conditions: conditionsInput.optional() }),
	output: SegmentSchema,
	handler: async ({ account, input }) => {
		const segment = await findSegment(account, input.id);
		const rules =
			input.match === undefined && input.conditions === undefined
				? null
				: readRules(account, { match: input.match ?? segment.match, conditions: input.conditions ?? segment.conditions });
		const set = { ...(input.name !== undefined && { name: input.name }), ...rules };
		if (Object.keys(set).length > 0) {
			const { matchedCount } = await Segment.updateOne(scoped(account, { _id: segment._id, deletedAt: null }), { $set: set });
			if (!matchedCount) throw actionError("not_found", "Segment not found");
		}
		return toSegment(account, await findSegment(account, input.id));
	},
});

const deleteSegment = defineAction({
	name: "delete_segment",
	tryWithoutPlan: true,
	title: "Delete a segment",
	group: GROUP,
	description:
		"Deletes a segment. Its contacts stay as they are. A scheduled, sending or paused campaign going to it answers conflict: change who it goes to first. Drafts going to it can't be sent until they get another segment or none.",
	http: { method: "DELETE", path: "/segments/{id}" },
	destructive: true,
	idempotent: true,
	input: z.object({ id: segmentId }),
	output: z.object({ id: z.string(), deleted: z.literal(true) }),
	handler: async ({ account, input }) => {
		const segment = await findSegment(account, input.id);
		if (await Campaign.exists(scoped(account, { segmentId: segment._id, status: { $in: WAITING_STATUSES } }))) {
			throw actionError("conflict", "A scheduled or sending campaign goes to this segment: change who it goes to first");
		}
		// Kept in the database, like every customer document.
		await Segment.updateOne(scoped(account, { _id: segment._id, deletedAt: null }), { $set: { deletedAt: new Date() } });
		return { id: String(segment._id), deleted: true };
	},
});

export const segmentActions = [listSegments, getSegment, countSegment, createSegment, updateSegment, deleteSegment];
