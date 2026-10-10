import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sendAlert } from "./alerts.js";
import { getDb } from "./db.js";
import { laterOf, withEngagement } from "./engagement.js";
import { campaignIncrements, contactIncrements, toRecord } from "./rows.js";
import { campaigns, contacts, events, messages, suppressions } from "./schema.js";
import { CAMPAIGN_MESSAGE_KINDS, getCampaignStatsPath } from "./sending-rules.js";
import { getResendEventPlan } from "./resend-event-mapping.js";
import { getSesEventPlan, getTrackingPlan } from "./ses-event-mapping.js";
import { isLikelyScanner } from "./tracking.js";

export { getResendEventPlan } from "./resend-event-mapping.js";
export { getSesEventPlan } from "./ses-event-mapping.js";

// Every send produces a delivery event; storing those raw would fill a small database within months.
const RECORDED_EVENT_TYPES = new Set(["Bounce", "Complaint", "Reject", "DeliveryDelay", "RenderingFailure"]);

async function findOneMessage(where) {
	const [row] = await getDb().select().from(messages).where(where).limit(1);
	return toRecord(row);
}

// The message_id tag covers events that arrive before providerMessageId is saved.
async function findMessage({ providerMessageId, messageId }) {
	if (providerMessageId) {
		const message = await findOneMessage(eq(messages.providerMessageId, providerMessageId));
		if (message) return message;
	}
	if (!messageId) return null;

	const message = await findOneMessage(eq(messages._id, messageId));
	if (!message) return null;
	if (message.providerMessageId && providerMessageId && message.providerMessageId !== providerMessageId) return null;
	if (!message.providerMessageId && providerMessageId) {
		await getDb()
			.update(messages)
			.set({ providerMessageId })
			.where(and(eq(messages._id, message._id), isNull(messages.providerMessageId)));
	}
	return message;
}

// Each counter moves only on the first transition, so SNS redeliveries are harmless.
async function applyMessageUpdates(message, plan) {
	const db = getDb();
	const campaignInc = {};
	const contactInc = {};
	const statsPath = getCampaignStatsPath(message.kind);

	for (const { field, stat, contactStat } of plan.firsts) {
		const updated = await db
			.update(messages)
			.set({ [field]: plan.occurredAt })
			.where(and(eq(messages._id, message._id), isNull(messages[field])))
			.returning({ _id: messages._id });
		if (updated.length === 0) continue;
		if (stat) campaignInc[`${statsPath}.${stat}`] = 1;
		if (contactStat) contactInc[`stats.${contactStat}`] = 1;
	}

	if (plan.status) {
		const updated = await db
			.update(messages)
			.set({ status: plan.status.to })
			.where(and(eq(messages._id, message._id), inArray(messages.status, plan.status.from)))
			.returning({ _id: messages._id });
		if (updated.length > 0 && plan.status.stat) campaignInc[`${statsPath}.${plan.status.stat}`] = 1;
	}

	if (plan.error) {
		await db.update(messages).set({ error: plan.error.slice(0, 500) }).where(eq(messages._id, message._id));
	}

	const updates = [];
	if (CAMPAIGN_MESSAGE_KINDS.includes(message.kind) && message.campaignId && Object.keys(campaignInc).length > 0) {
		updates.push(db.update(campaigns).set(campaignIncrements(campaignInc)).where(eq(campaigns._id, message.campaignId)));
	}
	if (message.contactId && (plan.engagement || Object.keys(contactInc).length > 0)) {
		const set = {
			...Object.fromEntries(
				Object.entries(plan.engagement ?? {}).map(([field, at]) => [field, laterOf(contacts[field], at)])
			),
			...contactIncrements(contactInc),
		};
		updates.push(
			db
				.update(contacts)
				.set(plan.engagement ? withEngagement(set, plan.occurredAt) : set)
				.where(eq(contacts._id, message.contactId))
		);
	}
	await Promise.all(updates);
}

// Global: the address is never emailed again, from any newsletter.
async function suppress({ emails, reason, detail, contactStatus, contactStatusFrom }) {
	if (emails.length === 0) return;
	const db = getDb();
	const rows = emails.map((email) => ({ email, reason, detail }));
	// A complaint outranks an earlier bounce or manual suppression.
	await (reason === "complaint"
		? db
				.insert(suppressions)
				.values(rows)
				.onConflictDoUpdate({ target: suppressions.email, set: { reason, detail } })
		: db.insert(suppressions).values(rows).onConflictDoNothing({ target: suppressions.email }));
	await db
		.update(contacts)
		.set({ status: contactStatus })
		.where(and(inArray(contacts.email, emails), inArray(contacts.status, contactStatusFrom)));
}

// Mailcheap's own open pixel and click links update messages the way SES events do.
export async function recordEngagement({ messageId, type, userAgent }) {
	const [message] = await getDb()
		.select({ _id: messages._id, kind: messages.kind, campaignId: messages.campaignId, contactId: messages.contactId, sentAt: messages.sentAt })
		.from(messages)
		.where(eq(messages._id, messageId));
	if (!message) return;
	if (type === "Click" && isLikelyScanner({ userAgent, sentAt: message.sentAt })) return;
	await applyMessageUpdates(message, getTrackingPlan(type));
}

// SES events (through SNS) and Resend webhooks map to the same plan (lib/*-event-mapping.js).
export function handleSesEvent(sesEvent) {
	return handleEventPlan(getSesEventPlan(sesEvent));
}

export function handleResendEvent(event) {
	return handleEventPlan(getResendEventPlan(event));
}

async function handleEventPlan(plan) {
	if (!plan) return { handled: false };

	const message = await findMessage(plan);
	if (message) await applyMessageUpdates(message, plan);
	if (plan.suppression) await suppress(plan.suppression);
	if (plan.suppression?.reason === "complaint") {
		await sendAlert({
			key: "complaints",
			title: "Spam complaint",
			detail: `${plan.suppression.emails.join(", ")} marked an email as spam. Contacts are suppressed.`,
			path: message?.campaignId ? `/campaigns/${message.campaignId}` : "",
		});
	}

	if (RECORDED_EVENT_TYPES.has(plan.type)) {
		await getDb()
			.insert(events)
			.values({
				type: plan.type,
				providerMessageId: plan.providerMessageId,
				messageId: message?._id,
				campaignId: message?.campaignId,
				email: plan.email ?? message?.email,
				occurredAt: plan.occurredAt,
				data: plan.data,
			});
	}
	return { handled: true, messageId: message ? String(message._id) : null };
}
