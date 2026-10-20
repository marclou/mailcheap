import "server-only";
import * as z from "zod";
import { scoped } from "@/lib/account-scope";
import { getAccountSendProblem } from "@/lib/account-state";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import {
	assertSendingEnabled,
	dateOutput,
	findNewsletter,
	findTestRecipient,
	idInput,
	newsletterFilterInput,
	newsletterInput,
	readPositiveInteger,
	toIso,
} from "@/lib/actions/shared";
import { notifyActivity } from "@/lib/alerts";
import { PUBLISHED_STATUSES, getIssuePageUrl, revalidateArchive } from "@/lib/archive-data";
import { isArchiveSlugTaken, uniqueArchiveSlug } from "@/lib/archive-slugs";
import { MAX_CAMPAIGN_LINKS, findCampaignLinks } from "@/lib/campaign-links";
import { countRemainingContacts, recentCampaignsPipeline } from "@/lib/campaign-queries";
import { getCampaignActivity, getCampaignComparison } from "@/lib/campaign-report";
import { summarizePreview } from "@/lib/cleanup";
import { FIRST_SEND, LIMITS, WARMUP, getAppUrl } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { getLinkLabels } from "@/lib/link-stats";
import { formatRate } from "@/lib/rate-levels";
import { renderEmail } from "@/lib/render-email";
import { COMPARED_ISSUES, TIMELINE_HOURS } from "@/lib/report-stats";
import { getScheduleProblem } from "@/lib/schedule";
import { publishScheduledSend } from "@/lib/scheduling";
import { countAudience, findLiveSegment } from "@/lib/segment-queries";
import { SEGMENT_DELETED, compileSegment } from "@/lib/segments";
import { loadSender } from "@/lib/sender";
import { checkCampaignSend, getCleanupPreview, queueCampaign, sendTestEmail, sendToMoreContacts } from "@/lib/sending";
import { getIssueWebUrl, getSendProblem } from "@/lib/sending-rules";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import { firstImageUrl } from "@/lib/thumbnail";
import { MAX_BODY_BYTES, isObjectIdString } from "@/lib/validation";
import Campaign, { CAMPAIGN_STATUSES } from "@/models/Campaign";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";
import Segment from "@/models/Segment";

const GROUP = "Campaigns";
// A scheduled campaign stays editable until it goes out.
const EDITABLE_STATUSES = ["draft", "scheduled"];
const LISTED_STATUSES = CAMPAIGN_STATUSES.filter((status) => status !== "canceled");
const FORMATS = ["markdown", "rich", "html"];
const STAT_KEYS = ["recipients", "sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed", "failed"];
const LAST_CHANCE_KEYS = ["recipients", "sent", "delivered", "bounced", "complained", "failed", "dormant"];
const COPY_SUFFIX = " (copy)";
const SUMMARY_FIELDS = { html: 0, markdown: 0 };
const IRREVERSIBLE = "Sending can't be undone: emails can't be recalled once they go out. Ask the user to confirm first.";
const FIRST_SEND_WAIT_HOURS = FIRST_SEND.waitMinutes / 60;
const { pause, block } = LIMITS;
const RATE_LEVELS = `Past ${formatRate(pause.bounceRate)} hard bounces (at least ${pause.minBounces}) or ${formatRate(pause.complaintRate)} complaints (at least ${pause.minComplaints}), the campaign pauses with pauseCode high_rates, or first_send_slice for a slice, and resume_campaign sends the rest. Past ${formatRate(block.bounceRate)} (at least ${block.minBounces}) or ${formatRate(block.complaintRate)} (at least ${block.minComplaints}), the account is blocked.`;
const PACE = `MailCheap Cloud paces a send by the volume its account has proven: its largest campaign of the last ${WARMUP.provenDays} days whose bounces and complaints stayed under the pause level, counted a day after it went out. A send, with what the account's other sends still have to send or sent in the last ${WARMUP.recentHours} hours, goes at full speed up to ${WARMUP.quickEmails} emails, or that volume times ${WARMUP.growth.first} on the first day of the account's ${WARMUP.days}-day warm-up, rising to ${WARMUP.growth.last} by its last day and after it. A bigger send goes out over ${WARMUP.minHours} hours plus ${WARMUP.hoursPerDoubling} for each time it doubles that, ${WARMUP.maxHours} at most (spreadHours, sendingUntil); a resume keeps the pace, each step of send_campaign_to_more gets its own`;
const HOW_IT_GOES_OUT = `${PACE}. Contacts never mailed before go in steps: a slice first, the rest ${FIRST_SEND_WAIT_HOURS} hours after it if the slice's bounces and complaints stay under the pause level. ${RATE_LEVELS}`;

const campaignId = idInput("campaign");
const subjectInput = z.string().trim().max(200).describe("Subject line, 200 characters at most");
const previewTextInput = z.string().trim().max(300).describe("Text inbox apps show after the subject, 300 characters at most");
const formatInput = z
	.enum(FORMATS)
	.describe(
		"markdown: Markdown laid out in the newsletter's design. rich: an HTML fragment (paragraphs, headings, links, images) in the same design, what the dashboard editor writes. html: a complete HTML email sent as is, with the footer added unless it contains {{unsubscribe_url}}."
	);
const contentInput = z.string().max(MAX_BODY_BYTES).describe("The body in that format, 500 KB at most");
const audienceLimitInput = z
	.number()
	.int()
	.min(1)
	.max(10_000_000)
	.optional()
	.describe("Send to this many contacts at most, the most engaged first. The rest can follow with send_campaign_to_more.");
const segmentInput = z
	.string()
	.trim()
	.max(100)
	.nullable()
	.optional()
	.describe("A segment's ID (list_segments): only the active contacts it picks when the campaign goes out get it. null: every active contact.");

const StatsSchema = z.object(Object.fromEntries(STAT_KEYS.map((key) => [key, z.number().int()])));
const SendProblemSchema = z.object({ code: z.string(), message: z.string() });
const CampaignSchema = z.object({
	id: z.string(),
	newsletterId: z.string(),
	status: z.enum(CAMPAIGN_STATUSES),
	subject: z.string(),
	previewText: z.string(),
	format: z.enum(FORMATS),
	archiveSlug: z.string().nullable().describe("The issue's page is /p/<archiveSlug> on the archive"),
	archiveUrl: z.string().nullable().describe("The issue's public page, once sent with the archive on"),
	archivePinned: z.boolean(),
	audienceLimit: z.number().int().nullable(),
	segmentId: z.string().nullable().describe("The segment it goes to, or null for every active contact"),
	scheduledAt: dateOutput,
	startedAt: dateOutput,
	sendingUntil: dateOutput.describe(
		`About when a paced send finishes, a first send's ${FIRST_SEND_WAIT_HOURS}-hour check included, or null at full speed`
	),
	spreadHours: z
		.number()
		.nullable()
		.describe("The hours this send, or its latest step, goes out over because it's bigger than its account's proven volume allows, or null at full speed"),
	sentAt: dateOutput,
	testSentAt: dateOutput,
	pauseReason: z.string().nullable(),
	pauseCode: z
		.string()
		.nullable()
		.describe("plan_limit_emails, account_blocked, high_rates, first_send_slice… when the send paused itself. resume_campaign goes on after high_rates and first_send_slice"),
	stats: StatsSchema,
	source: z.string().describe("dashboard or api"),
	dashboardUrl: z.string(),
	createdAt: dateOutput,
	updatedAt: dateOutput,
});
const CampaignDetailSchema = CampaignSchema.extend({
	content: z.string(),
	sendProblem: SendProblemSchema.nullable().describe("What blocks sending this draft right now, or null"),
	activeContacts: z.number().int().describe("Active contacts of its newsletter"),
	segment: z
		.object({ id: z.string(), name: z.string(), deleted: z.boolean().describe("A deleted segment's campaign can't be sent until it gets another") })
		.nullable(),
	audience: z
		.object({
			contacts: z.number().int().describe("Active contacts it goes to: its segment's, or all of them"),
			neverMailed: z.number().int().describe("Of those, contacts this account never emailed: a send takes them in steps"),
		})
		.describe("Who it would go to now"),
});
const RateSchema = z.number().nullable();

function toCampaign(campaign, newsletter) {
	const id = String(campaign._id);
	return {
		id,
		newsletterId: String(campaign.newsletterId),
		status: campaign.status,
		subject: campaign.subject ?? "",
		previewText: campaign.previewText ?? "",
		format: campaign.format ?? "rich",
		archiveSlug: campaign.archiveSlug ?? null,
		archiveUrl: getIssuePageUrl({ campaign, newsletter }),
		archivePinned: Boolean(campaign.archivePinned),
		audienceLimit: campaign.audienceLimit ?? null,
		segmentId: campaign.segmentId ? String(campaign.segmentId) : null,
		scheduledAt: toIso(campaign.scheduledAt),
		startedAt: toIso(campaign.startedAt),
		sendingUntil: toIso(campaign.sendingUntil),
		spreadHours: campaign.spreadHours ?? null,
		sentAt: toIso(campaign.sentAt),
		testSentAt: toIso(campaign.testSentAt),
		pauseReason: campaign.pauseReason ?? null,
		pauseCode: campaign.pauseCode ?? null,
		stats: Object.fromEntries(STAT_KEYS.map((key) => [key, campaign.stats?.[key] ?? 0])),
		source: campaign.source ?? "dashboard",
		dashboardUrl: `${getAppUrl()}/campaigns/${id}`,
		createdAt: toIso(campaign.createdAt),
		updatedAt: toIso(campaign.updatedAt),
	};
}

// Deleted (canceled) campaigns are gone as far as callers can tell.
async function findCampaign(account, id) {
	const campaign = isObjectIdString(id) ? await Campaign.findOne(scoped(account, { _id: id })).lean() : null;
	if (!campaign || campaign.status === "canceled") throw actionError("not_found", "Campaign not found");
	return campaign;
}

function findCampaignNewsletter(account, campaign) {
	return Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).lean();
}

// The email as contacts got it, for what each of its links shows.
function renderCampaignEmail(campaign, newsletter) {
	const { format, markdown, html, subject, previewText } = campaign;
	return renderEmail({ format, markdown, html, subject, previewText, newsletter }).html;
}

async function reload(account, campaign) {
	const [fresh, newsletter] = await Promise.all([
		Campaign.findOne(scoped(account, { _id: campaign._id })).lean(),
		findCampaignNewsletter(account, campaign),
	]);
	return toCampaign(fresh, newsletter);
}

// The checks a send runs, with their codes: the account, the from address, the email itself, then who it goes to.
async function getSendBlocker(account, campaign, newsletter) {
	const accountProblem = getAccountSendProblem(account);
	if (accountProblem) return accountProblem;
	const sender = newsletter ? await loadSender(account, newsletter) : null;
	const problem = getSendProblem({ campaign, newsletter, sender });
	if (problem) return { code: problem === sender?.problem ? "sender_not_allowed" : "send_check_failed", message: problem };
	if (campaign.segmentId && !(await findLiveSegment(account, campaign.segmentId, { _id: 1 }))) {
		return { code: "send_check_failed", message: SEGMENT_DELETED };
	}
	return null;
}

// The segment a campaign goes to, deleted or not, or null when it goes to every active contact.
async function findCampaignSegment(account, campaign) {
	if (!campaign.segmentId) return null;
	const segment = await Segment.findOne(scoped(account, { _id: campaign.segmentId }))
		.select({ name: 1, match: 1, conditions: 1, deletedAt: 1 })
		.lean();
	const isDeleted = !segment || Boolean(segment.deletedAt);
	return { id: String(campaign.segmentId), name: segment?.name ?? "", deleted: isDeleted, rules: isDeleted ? null : segment };
}

// What a send or schedule sets it to: undefined keeps its segment, null leaves it to every active contact. A segment
// has to be a live one of the campaign's newsletter.
async function readSegmentInput(account, newsletterId, value) {
	if (value === undefined) return undefined;
	if (!value) return null;
	const segment = isObjectIdString(value) ? await findLiveSegment(account, value, { newsletterId: 1 }) : null;
	if (!segment) throw actionError("not_found", "Segment not found");
	if (String(segment.newsletterId) !== String(newsletterId)) throw actionError("validation_failed", "segment: it belongs to another newsletter");
	return segment._id;
}

function withSegment(campaign, segmentId) {
	return segmentId === undefined ? campaign : { ...campaign, segmentId };
}

// The send's audience settings in one write: the limit, and the segment when one was given.
function audienceUpdate({ limit, segmentId }) {
	const set = { ...(limit && { audienceLimit: limit }), ...(segmentId && { segmentId }) };
	const unset = { ...(!limit && { audienceLimit: 1 }), ...(segmentId === null && { segmentId: 1 }) };
	return { ...(Object.keys(set).length > 0 && { $set: set }), ...(Object.keys(unset).length > 0 && { $unset: unset }) };
}

async function assertCanSend(account, campaign, newsletter) {
	const blocker = await getSendBlocker(account, campaign, newsletter);
	if (blocker) throw actionError(blocker.code, blocker.message);
}

async function toCampaignDetail(account, campaign) {
	const [newsletter, segment] = await Promise.all([findCampaignNewsletter(account, campaign), findCampaignSegment(account, campaign)]);
	const [activeContacts, audience, sendProblem] = await Promise.all([
		Contact.countDocuments(scoped(account, { newsletterId: campaign.newsletterId, status: "active" })),
		segment?.deleted ? { contacts: 0, neverMailed: 0 } : countAudience(account, campaign.newsletterId, segment && compileSegment(segment.rules)),
		EDITABLE_STATUSES.includes(campaign.status) ? getSendBlocker(account, campaign, newsletter) : null,
	]);
	return {
		...toCampaign(campaign, newsletter),
		content: (campaign.format === "markdown" ? campaign.markdown : campaign.html) ?? "",
		sendProblem,
		activeContacts,
		segment: segment && { id: segment.id, name: segment.name, deleted: segment.deleted },
		audience,
	};
}

function assertEditable(campaign, message) {
	if (!EDITABLE_STATUSES.includes(campaign.status)) throw actionError("conflict", message);
}

function statusConflict(campaign) {
	const messages = {
		sending: "This campaign is already sending",
		paused: "This campaign is paused: resume it instead",
		sent: "This campaign was already sent: send it to more contacts instead",
	};
	return actionError("conflict", messages[campaign.status] ?? `This campaign is ${campaign.status}`);
}

function readContent(format, content) {
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > MAX_BODY_BYTES) {
		throw actionError("validation_failed", `The content is ${Math.ceil(bytes / 1000)} KB. The limit is ${MAX_BODY_BYTES / 1000} KB.`);
	}
	return {
		format,
		[format === "markdown" ? "markdown" : "html"]: content,
		thumbnailUrl: firstImageUrl({ format, html: content, markdown: content }) ?? undefined,
	};
}

function notifySend(account, campaign, action) {
	return notifyActivity([`${action}: ${campaign.subject || "(no subject)"}`, `${getAppUrl()}/campaigns/${campaign._id}`], {
		accountId: account._id,
	});
}

function toRate(part, total) {
	return total ? Math.round((part / total) * 10_000) / 10_000 : null;
}

async function setArchiveSlug(account, campaign, value) {
	const slug = String(value ?? "").trim().toLowerCase().replace(/-+$/, "");
	const isPublished = PUBLISHED_STATUSES.includes(campaign.status);
	if (!slug && isPublished) throw actionError("validation_failed", "A sent issue needs a URL");
	if (slug && !ARCHIVE_SLUG_PATTERN.test(slug)) throw actionError("validation_failed", "Use lowercase letters, digits and hyphens");
	if (slug === (campaign.archiveSlug ?? "")) return;
	if (slug && (await isArchiveSlugTaken(slug, { exceptId: campaign._id }))) throw actionError("conflict", "Another issue uses this URL");
	try {
		await Campaign.updateOne(scoped(account, { _id: campaign._id }), slug ? { $set: { archiveSlug: slug } } : { $unset: { archiveSlug: 1 } });
	} catch (error) {
		if (error?.code === 11000) throw actionError("conflict", "Another issue uses this URL");
		throw error;
	}
	if (isPublished) revalidateArchive();
}

const listCampaigns = defineAction({
	name: "list_campaigns",
	tryWithoutPlan: true,
	title: "List campaigns",
	group: GROUP,
	description:
		"Lists campaigns, newest activity first: sent issues by send date, scheduled ones by send time, drafts by last edit. Content is left out; get_campaign has it.",
	http: { method: "GET", path: "/campaigns" },
	readOnly: true,
	example: { status: "sent", limit: 10 },
	input: z.object({
		newsletter: newsletterFilterInput,
		status: z.enum(LISTED_STATUSES).optional().describe("Only campaigns with this status"),
		limit: z.number().int().min(1).max(200).optional().describe("How many, 50 by default, 200 at most"),
	}),
	output: z.object({ campaigns: z.array(CampaignSchema) }),
	handler: async ({ account, input }) => {
		const newsletter = input.newsletter ? await findNewsletter(account, input.newsletter) : null;
		const [campaigns, newsletters] = await Promise.all([
			Campaign.aggregate(
				recentCampaignsPipeline({
					accountId: scoped(account).accountId,
					limit: input.limit ?? 50,
					newsletterId: newsletter?._id,
					status: input.status,
					fields: SUMMARY_FIELDS,
				})
			),
			Newsletter.find(scoped(account)).select({ slug: 1, archiveEnabled: 1, archiveHost: 1 }).lean(),
		]);
		const byId = new Map(newsletters.map((item) => [String(item._id), item]));
		return { campaigns: campaigns.map((campaign) => toCampaign(campaign, byId.get(String(campaign.newsletterId)))) };
	},
});

const getCampaign = defineAction({
	name: "get_campaign",
	tryWithoutPlan: true,
	title: "Get a campaign",
	group: GROUP,
	description: "Gets a campaign with its content, stats and, for drafts, what would block sending it now.",
	http: { method: "GET", path: "/campaigns/{id}" },
	readOnly: true,
	input: z.object({ id: campaignId }),
	output: CampaignDetailSchema,
	handler: async ({ account, input }) => toCampaignDetail(account, await findCampaign(account, input.id)),
});

const getCampaignReport = defineAction({
	name: "get_campaign_report",
	tryWithoutPlan: true,
	title: "Get a campaign's report",
	group: GROUP,
	description:
		"Delivery, open, click, bounce, complaint and unsubscribe rates of a sent campaign, how they compare with the newsletter's earlier issues, its opens and clicks hour by hour after sending, the clicks on each of its links, its list cleanup emails, results by inbox provider, and how many contacts a capped send hasn't reached yet.",
	http: { method: "GET", path: "/campaigns/{id}/report" },
	readOnly: true,
	input: z.object({ id: campaignId }),
	output: z.object({
		campaign: CampaignSchema,
		rates: z
			.object({
				delivered: RateSchema,
				opened: RateSchema,
				clicked: RateSchema,
				bounced: RateSchema,
				complained: RateSchema,
				unsubscribed: RateSchema,
			})
			.describe("Fractions from 0 to 1: delivered, bounced and complained of sent; opened, clicked and unsubscribed of delivered"),
		links: z
			.array(
				z.object({
					url: z.string().describe("The link, without the parameters that only track visits, like utm_source"),
					text: z.string().nullable().describe("What the email shows for it: its text, or its picture's alt text"),
					clickers: z.number().int().describe("Contacts who clicked it at least once"),
					clicks: z.number().int().describe("Every counted click on it, repeat clicks included"),
				})
			)
			.describe(
				`The links that got clicks, most clicked first, ${MAX_CAMPAIGN_LINKS} at most. The same page counts once whatever its tracking parameters; link scanners' visits and the unsubscribe link don't count.`
			),
		comparison: z
			.object({
				issues: z.number().int().describe(`How many earlier issues the average covers, ${COMPARED_ISSUES} at most`),
				opened: RateSchema.describe("Their open rate: all their opens over all the contacts they reached"),
				clicked: RateSchema.describe("Their click rate, counted the same way"),
			})
			.nullable()
			.describe(
				"The newsletter's last sent issues before this one, pooled so a small send barely counts: compare with rates.opened and rates.clicked, which keep climbing for about three days after a send starts. Null with fewer than two that reached anyone"
			),
		timeline: z
			.object({
				hours: z
					.array(z.object({ at: dateOutput, opens: z.number().int(), clicks: z.number().int() }))
					.describe(
						`First opens and first clicks in each hour, from the hour the send started until now, ${TIMELINE_HOURS} hours at most`
					),
				later: z
					.object({ opens: z.number().int(), clicks: z.number().int() })
					.describe("First opens and first clicks after those hours"),
			})
			.nullable()
			.describe("Null for a campaign that never started sending"),
		linkClickers: z.number().int().describe("Contacts who clicked at least one link: each link's clickers are a share of them"),
		linksComplete: z
			.boolean()
			.describe("False for a send that started before MailCheap counted clicks per link: links has the clicks since linksCountedSince"),
		linksCountedSince: dateOutput.describe("When an incomplete send's clicks started counting per link; null otherwise"),
		lastChance: z
			.object(Object.fromEntries(LAST_CHANCE_KEYS.map((key) => [key, z.number().int()])))
			.describe("List cleanup at this send: last-chance emails instead of the issue, and contacts made dormant"),
		providers: z.array(
			z.object({
				provider: z.string(),
				sent: z.number().int(),
				delivered: z.number().int(),
				opened: z.number().int(),
				clicked: z.number().int(),
				bounced: z.number().int(),
				complained: z.number().int(),
			})
		),
		remaining: z.number().int().describe("Active contacts a capped send hasn't reached yet"),
		firstSend: z
			.object({ slice: z.number().int(), held: z.number().int(), checkAt: dateOutput, checkedAt: dateOutput })
			.nullable()
			.describe(
				`Contacts never mailed before go in steps: a first slice, then the held rest ${FIRST_SEND_WAIT_HOURS} hours after it if the slice's bounces and complaints stay under the pause level. ${RATE_LEVELS}`
			),
	}),
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		const [newsletter, { providers, timeline }, comparison, remaining, links] = await Promise.all([
			findCampaignNewsletter(account, campaign),
			getCampaignActivity(campaign),
			getCampaignComparison(campaign),
			countRemainingContacts(campaign),
			findCampaignLinks(campaign),
		]);
		const { stats = {}, lastChance = {}, firstSend } = campaign;
		const reached = stats.delivered || stats.sent;
		const labels = newsletter
			? getLinkLabels(renderCampaignEmail(campaign, newsletter), { webUrl: getIssueWebUrl({ campaign, newsletter }) })
			: new Map();
		return {
			campaign: toCampaign(campaign, newsletter),
			rates: {
				delivered: toRate(stats.delivered, stats.sent),
				opened: toRate(stats.opened, reached),
				clicked: toRate(stats.clicked, reached),
				bounced: toRate(stats.bounced, stats.sent),
				complained: toRate(stats.complained, stats.sent),
				unsubscribed: toRate(stats.unsubscribed, reached),
			},
			comparison: comparison && { issues: comparison.issues, ...comparison.average },
			timeline: timeline && {
				hours: timeline.hours.filter(({ isFuture }) => !isFuture).map(({ at, opens, clicks }) => ({ at: toIso(at), opens, clicks })),
				later: timeline.later,
			},
			links: links.links.map(({ key, url, clickers, clicks }) => ({ url, text: labels.get(key) ?? null, clickers, clicks })),
			linkClickers: links.clickers,
			linksComplete: links.isComplete,
			linksCountedSince: toIso(links.countedSince),
			lastChance: Object.fromEntries(LAST_CHANCE_KEYS.map((key) => [key, lastChance[key] ?? 0])),
			providers,
			remaining,
			firstSend: firstSend?.slice
				? { slice: firstSend.slice, held: firstSend.held ?? 0, checkAt: toIso(firstSend.checkAt), checkedAt: toIso(firstSend.checkedAt) }
				: null,
		};
	},
});

const createCampaign = defineAction({
	name: "create_campaign",
	tryWithoutPlan: true,
	title: "Create a draft campaign",
	group: GROUP,
	description:
		"Creates a draft. Nothing is sent: review it in the dashboard or with get_campaign, then send_test_email, schedule_campaign or send_campaign.",
	http: { method: "POST", path: "/campaigns", status: 201 },
	rateLimit: { limit: 60, window: "1 h" },
	example: { subject: "This week", previewText: "Three links worth your time", content: "# This week\n\nThree links worth your time." },
	input: z.object({
		newsletter: newsletterInput,
		subject: subjectInput.optional(),
		previewText: previewTextInput.optional(),
		format: formatInput.optional().describe("markdown (the default when content is given), rich or html, as in update_campaign"),
		content: contentInput.optional(),
		archiveSlug: z
			.string()
			.regex(ARCHIVE_SLUG_PATTERN, "Use lowercase letters, digits and dashes, 120 at most")
			.optional()
			.describe("The issue's page path once sent. Default: made from the subject; a taken slug gets a number."),
		segment: segmentInput,
	}),
	output: CampaignDetailSchema,
	handler: async ({ account, input, via }) => {
		const newsletter = await findNewsletter(account, input.newsletter, { _id: 1 });
		const content = input.content ? readContent(input.format ?? "markdown", input.content) : { format: input.format ?? "rich" };
		const segmentId = await readSegmentInput(account, newsletter._id, input.segment);
		const campaign = await Campaign.create({
			accountId: account._id,
			newsletterId: newsletter._id,
			subject: input.subject ?? "",
			previewText: input.previewText ?? "",
			...content,
			...(input.archiveSlug && { archiveSlug: await uniqueArchiveSlug(input.archiveSlug) }),
			...(segmentId && { segmentId }),
			source: via === "dashboard" ? "dashboard" : "api",
		});
		return toCampaignDetail(account, campaign.toObject());
	},
});

const updateCampaign = defineAction({
	name: "update_campaign",
	tryWithoutPlan: true,
	title: "Update a draft campaign",
	group: GROUP,
	description:
		"Changes a draft or scheduled campaign's subject, preview text, content or segment. Send only the fields to change; format goes with content. Sent campaigns can't change.",
	http: { method: "PATCH", path: "/campaigns/{id}" },
	idempotent: true,
	example: { subject: "This week, and one more link" },
	input: z.object({
		id: campaignId,
		subject: subjectInput.optional(),
		previewText: previewTextInput.optional(),
		format: formatInput.optional().describe("With content: the format it's in. Default: the campaign's current format."),
		content: contentInput.optional(),
		segment: segmentInput,
	}),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		assertEditable(campaign, "Only drafts can be edited");
		if (input.format !== undefined && input.content === undefined) throw actionError("validation_failed", "format: send content with it");

		const { thumbnailUrl, ...content } = input.content === undefined ? {} : readContent(input.format ?? campaign.format, input.content);
		const segmentId = await readSegmentInput(account, campaign.newsletterId, input.segment);
		const set = {
			...(input.subject !== undefined && { subject: input.subject }),
			...(input.previewText !== undefined && { previewText: input.previewText }),
			...content,
			...(thumbnailUrl && { thumbnailUrl }),
			...(segmentId && { segmentId }),
		};
		const unsetFields = {
			...(input.content !== undefined && !thumbnailUrl && { thumbnailUrl: 1 }),
			...(segmentId === null && { segmentId: 1 }),
		};
		const unset = Object.keys(unsetFields).length > 0 ? unsetFields : null;
		if (Object.keys(set).length === 0 && !unset) return reload(account, campaign);
		// The status check is part of the write, so a change can't land on a campaign that just started sending.
		const { matchedCount } = await Campaign.updateOne(scoped(account, { _id: campaign._id, status: { $in: EDITABLE_STATUSES } }), {
			...(Object.keys(set).length > 0 && { $set: set }),
			...(unset && { $unset: unset }),
		});
		if (!matchedCount) throw actionError("conflict", "This campaign is already sending");
		return reload(account, campaign);
	},
});

const deleteCampaign = defineAction({
	name: "delete_campaign",
	tryWithoutPlan: true,
	title: "Delete a draft campaign",
	group: GROUP,
	description:
		"Deletes a draft or scheduled campaign: it leaves every list and a scheduled send never goes out. Sent campaigns can't be deleted.",
	http: { method: "DELETE", path: "/campaigns/{id}" },
	destructive: true,
	idempotent: true,
	whileBlocked: true,
	input: z.object({ id: campaignId }),
	output: z.object({ id: z.string(), deleted: z.literal(true) }),
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		assertEditable(campaign, "Only drafts can be deleted");
		// Kept in the database as canceled, like every customer document.
		const { matchedCount } = await Campaign.updateOne(scoped(account, { _id: campaign._id, status: { $in: EDITABLE_STATUSES } }), {
			$set: { status: "canceled" },
			$unset: { scheduledAt: 1 },
		});
		if (!matchedCount) throw actionError("conflict", "This campaign is already sending");
		return { id: String(campaign._id), deleted: true };
	},
});

const duplicateCampaign = defineAction({
	name: "duplicate_campaign",
	tryWithoutPlan: true,
	title: "Duplicate a campaign",
	group: GROUP,
	description: "Copies a campaign's subject, preview text and content into a new draft.",
	http: { method: "POST", path: "/campaigns/{id}/duplicate", status: 201 },
	rateLimit: { limit: 60, window: "1 h" },
	input: z.object({ id: campaignId }),
	output: CampaignSchema,
	handler: async ({ account, input, via }) => {
		const campaign = await findCampaign(account, input.id);
		const maxSubject = 200 - COPY_SUFFIX.length;
		const copy = await Campaign.create({
			accountId: account._id,
			newsletterId: campaign.newsletterId,
			subject: campaign.subject ? `${campaign.subject.slice(0, maxSubject)}${COPY_SUFFIX}` : "",
			previewText: campaign.previewText,
			format: campaign.format,
			markdown: campaign.markdown,
			html: campaign.html,
			thumbnailUrl: campaign.thumbnailUrl,
			// A copy of an API draft is still content from the API key's holder, not from the dashboard.
			...((campaign.source === "api" || via !== "dashboard") && { source: "api" }),
		});
		return reload(account, copy);
	},
});

const sendTest = defineAction({
	name: "send_test_email",
	title: "Send a test email",
	group: GROUP,
	description:
		"Sends the campaign as saved to the account owner's address, subject prefixed with [Test]. Nobody else gets it. It counts toward the plan's emails.",
	http: { method: "POST", path: "/campaigns/{id}/test" },
	openWorld: true,
	rateLimit: { limit: 30, window: "1 h" },
	input: z.object({ id: campaignId }),
	output: z.object({ sentTo: z.string(), messageId: z.string() }),
	handler: async ({ account, user, input }) => {
		const campaign = await findCampaign(account, input.id);
		assertSendingEnabled();
		const to = await findTestRecipient({ account, user });
		const { messageId } = await sendTestEmail({ accountId: account._id, campaignId: String(campaign._id), to });
		return { sentTo: to, messageId };
	},
});

const scheduleCampaign = defineAction({
	name: "schedule_campaign",
	title: "Schedule a campaign",
	group: GROUP,
	description: `Schedules a draft to send by itself at a time within a year. It goes out without asking again, unless unschedule_campaign runs first. ${IRREVERSIBLE} Plan limits and pre-send checks run now and again when it goes out. ${HOW_IT_GOES_OUT}`,
	http: { method: "POST", path: "/campaigns/{id}/schedule" },
	destructive: true,
	idempotent: true,
	openWorld: true,
	rateLimit: { limit: 30, window: "1 h" },
	example: { scheduledAt: "2026-10-20T09:00:00Z" },
	input: z.object({
		id: campaignId,
		scheduledAt: z.string().max(40).describe("ISO 8601 date and time, e.g. 2026-10-20T09:00:00Z, at least a minute ahead"),
		audienceLimit: audienceLimitInput,
		segment: segmentInput.describe(
			"A segment's ID (list_segments): only the active contacts it picks when the campaign goes out get it. null: every active contact. Default: the campaign's segment."
		),
	}),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (!EDITABLE_STATUSES.includes(campaign.status)) throw statusConflict(campaign);
		assertSendingEnabled();
		const at = new Date(input.scheduledAt);
		const problem = getScheduleProblem(at);
		if (problem) throw actionError("validation_failed", problem);
		const newsletter = await findCampaignNewsletter(account, campaign);
		const segmentId = await readSegmentInput(account, campaign.newsletterId, input.segment);
		await assertCanSend(account, withSegment(campaign, segmentId), newsletter);
		const limit = readPositiveInteger(input.audienceLimit);
		await checkCampaignSend({ accountId: account._id, campaignId: campaign._id, audienceLimit: limit, at, segmentId });

		const update = audienceUpdate({ limit, segmentId });
		const { matchedCount } = await Campaign.updateOne(scoped(account, { _id: campaign._id, status: { $in: EDITABLE_STATUSES } }), {
			...update,
			$set: { ...update.$set, status: "scheduled", scheduledAt: at },
		});
		if (!matchedCount) throw actionError("conflict", "The campaign changed, refresh and try again");

		try {
			await publishScheduledSend({ accountId: account._id, campaignId: campaign._id, scheduledAt: at });
		} catch (error) {
			console.error("[campaigns] Scheduling failed:", error);
			const previous =
				campaign.status === "scheduled"
					? { $set: { status: "scheduled", scheduledAt: campaign.scheduledAt } }
					: { $set: { status: "draft" }, $unset: { scheduledAt: 1 } };
			await Campaign.updateOne(scoped(account, { _id: campaign._id, status: "scheduled", scheduledAt: at }), previous);
			throw actionError("unavailable", `Couldn't schedule it: ${error.message}`);
		}

		const when = `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
		await notifySend(account, campaign, `Send scheduled for ${when}${limit ? ` (first ${formatNumber(limit)})` : ""}`);
		return reload(account, campaign);
	},
});

const unscheduleCampaign = defineAction({
	name: "unschedule_campaign",
	tryWithoutPlan: true,
	title: "Cancel a scheduled send",
	group: GROUP,
	description: "Turns a scheduled campaign back into a draft, so it doesn't go out.",
	http: { method: "POST", path: "/campaigns/{id}/unschedule" },
	idempotent: true,
	whileBlocked: true,
	input: z.object({ id: campaignId }),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		const { matchedCount } = await Campaign.updateOne(scoped(account, { _id: campaign._id, status: "scheduled" }), {
			$set: { status: "draft" },
			$unset: { scheduledAt: 1 },
		});
		if (!matchedCount && campaign.status !== "draft") throw actionError("conflict", "It isn't scheduled anymore");
		return reload(account, campaign);
	},
});

const sendCampaign = defineAction({
	name: "send_campaign",
	title: "Send a campaign now",
	group: GROUP,
	description: `Sends a draft or scheduled campaign now to the newsletter's active contacts, or its segment's, most engaged first. ${IRREVERSIBLE} A campaign that is already sending or sent answers conflict, so a retry never sends twice. Plan limits, the from address, the postal address and the email size are checked first. ${HOW_IT_GOES_OUT}`,
	http: { method: "POST", path: "/campaigns/{id}/send" },
	destructive: true,
	openWorld: true,
	rateLimit: { limit: 30, window: "1 h" },
	input: z.object({
		id: campaignId,
		audienceLimit: audienceLimitInput,
		segment: segmentInput.describe(
			"A segment's ID (list_segments): only the active contacts it picks get it. null: every active contact. Default: the campaign's segment."
		),
	}),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (!EDITABLE_STATUSES.includes(campaign.status)) throw statusConflict(campaign);
		assertSendingEnabled();
		const segmentId = await readSegmentInput(account, campaign.newsletterId, input.segment);
		await assertCanSend(account, withSegment(campaign, segmentId), await findCampaignNewsletter(account, campaign));

		const limit = readPositiveInteger(input.audienceLimit);
		const { matchedCount } = await Campaign.updateOne(
			scoped(account, { _id: campaign._id, status: { $in: EDITABLE_STATUSES } }),
			audienceUpdate({ limit, segmentId })
		);
		if (!matchedCount) throw actionError("conflict", "This campaign is already sending");
		await queueCampaign({ accountId: account._id, campaignId: String(campaign._id) });
		// Sending a scheduled campaign now replaces its schedule; the job left in QStash then does nothing.
		await Campaign.updateOne(scoped(account, { _id: campaign._id }), { $unset: { scheduledAt: 1 } });
		revalidateArchive();
		await notifySend(account, campaign, limit ? `Send started (first ${formatNumber(limit)})` : "Send started");
		return reload(account, campaign);
	},
});

const sendCampaignToMore = defineAction({
	name: "send_campaign_to_more",
	title: "Send a campaign to more contacts",
	group: GROUP,
	description: `Sends a sent campaign to contacts who haven't received it yet, the next most engaged first: a send in steps. ${IRREVERSIBLE} Each call starts a new step, so check get_campaign_report before calling it again; while a step is still sending it answers conflict. ${HOW_IT_GOES_OUT}`,
	http: { method: "POST", path: "/campaigns/{id}/send-more" },
	destructive: true,
	openWorld: true,
	rateLimit: { limit: 30, window: "1 h" },
	example: { additional: 2000 },
	input: z.object({
		id: campaignId,
		additional: z
			.number()
			.int()
			.min(1)
			.max(10_000_000)
			.optional()
			.describe("How many more contacts. Default: everyone who hasn't received it."),
	}),
	output: CampaignSchema.extend({ added: z.number().int().describe("Contacts this step adds") }),
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (campaign.status !== "sent") {
			throw actionError("conflict", campaign.status === "sending" ? "Wait until the current step has gone out" : "Only sent campaigns can go to more contacts");
		}
		assertSendingEnabled();
		await assertCanSend(account, campaign, await findCampaignNewsletter(account, campaign));
		const more = readPositiveInteger(input.additional);
		const { added } = await sendToMoreContacts({ accountId: account._id, campaignId: String(campaign._id), additional: more });
		await notifySend(account, campaign, `Send to more started (${more ? `next ${formatNumber(more)}` : "everyone left"})`);
		return { ...(await reload(account, campaign)), added };
	},
});

const pauseCampaign = defineAction({
	name: "pause_campaign",
	title: "Pause a campaign",
	group: GROUP,
	description: "Stops a campaign that is sending. Emails already sent stay sent; the rest wait until resume_campaign.",
	http: { method: "POST", path: "/campaigns/{id}/pause" },
	idempotent: true,
	whileBlocked: true,
	input: z.object({ id: campaignId }),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (campaign.status === "sending") {
			await Campaign.updateOne(scoped(account, { _id: campaign._id, status: "sending" }), { $set: { status: "paused" } });
		} else if (campaign.status !== "paused") {
			throw actionError("conflict", "Only a campaign that is sending can pause");
		}
		return reload(account, campaign);
	},
});

const resumeCampaign = defineAction({
	name: "resume_campaign",
	title: "Resume a paused campaign",
	group: GROUP,
	description: `Sends the rest of a paused campaign. ${IRREVERSIBLE} The plan limits and the account's state are checked again first. Resumed after a high_rates or first_send_slice pause, only the block level stops it again.`,
	http: { method: "POST", path: "/campaigns/{id}/resume" },
	destructive: true,
	openWorld: true,
	rateLimit: { limit: 30, window: "1 h" },
	input: z.object({ id: campaignId }),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (campaign.status !== "paused") throw actionError("conflict", "Only paused campaigns can resume");
		assertSendingEnabled();
		await queueCampaign({ accountId: account._id, campaignId: String(campaign._id) });
		await notifySend(account, campaign, "Send resumed");
		return reload(account, campaign);
	},
});

const updateCampaignArchive = defineAction({
	name: "update_campaign_archive",
	tryWithoutPlan: true,
	title: "Update a campaign's archive page",
	group: GROUP,
	description:
		"Changes the path of a campaign's archive page (/p/<slug>), or pins a sent issue to the top of the archive. Works on sent campaigns too.",
	http: { method: "PATCH", path: "/campaigns/{id}/archive" },
	idempotent: true,
	example: { pinned: true },
	input: z.object({
		id: campaignId,
		slug: z.string().max(120).optional().describe("Lowercase letters, digits and dashes. Empty removes it from a draft."),
		pinned: z.boolean().optional().describe("Pinned issues lead the archive"),
	}),
	output: CampaignSchema,
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		if (input.slug !== undefined) await setArchiveSlug(account, campaign, input.slug);
		if (input.pinned !== undefined && input.pinned !== Boolean(campaign.archivePinned)) {
			const current = await Campaign.findOne(scoped(account, { _id: campaign._id })).select({ archiveSlug: 1, archiveListed: 1 }).lean();
			if (!current.archiveSlug || current.archiveListed === false) throw actionError("conflict", "Not listed on the archive");
			await Campaign.updateOne(scoped(account, { _id: campaign._id }), { $set: { archivePinned: input.pinned } });
			revalidateArchive();
		}
		return reload(account, campaign);
	},
});

const previewCampaignCleanup = defineAction({
	name: "preview_campaign_cleanup",
	tryWithoutPlan: true,
	title: "Preview the list cleanup of a send",
	group: GROUP,
	description:
		"Counts what the newsletter's list cleanup would do if the campaign went out now: issues sent, last-chance emails instead, contacts still waiting to answer one, and contacts made dormant. Reads the whole list, so it can take a few seconds.",
	http: { method: "GET", path: "/campaigns/{id}/cleanup-preview" },
	readOnly: true,
	rateLimit: { limit: 30, window: "1 h" },
	input: z.object({
		id: campaignId,
		audienceLimit: audienceLimitInput.describe("Count for a send capped at this many contacts"),
		includeRanks: z
			.boolean()
			.optional()
			.describe("Also return, for each cold contact, how many issue recipients come before it, to recount any limit without asking again"),
	}),
	output: z.object({
		enabled: z.boolean().describe("False when the newsletter's list cleanup is off; the counts are null then"),
		issue: z.number().int().nullable(),
		lastChance: z.number().int().nullable(),
		waiting: z.number().int().nullable(),
		dormant: z.number().int().nullable(),
		ranks: z
			.object({
				issue: z.number().int(),
				lastChance: z.array(z.number().int()),
				waiting: z.array(z.number().int()),
				dormant: z.array(z.number().int()),
			})
			.optional(),
	}),
	handler: async ({ account, input }) => {
		const campaign = await findCampaign(account, input.id);
		const preview = await getCleanupPreview({ accountId: account._id, campaignId: campaign._id });
		if (!preview.enabled) return { enabled: false, issue: null, lastChance: null, waiting: null, dormant: null };
		const { enabled, ...ranks } = preview;
		return { enabled, ...summarizePreview(ranks, input.audienceLimit), ...(input.includeRanks && { ranks }) };
	},
});

export const campaignActions = [
	listCampaigns,
	getCampaign,
	getCampaignReport,
	createCampaign,
	updateCampaign,
	deleteCampaign,
	duplicateCampaign,
	sendTest,
	scheduleCampaign,
	unscheduleCampaign,
	sendCampaign,
	sendCampaignToMore,
	pauseCampaign,
	resumeCampaign,
	updateCampaignArchive,
	previewCampaignCleanup,
];
