import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { newId } from "./ids.js";

// Ids keep MongoDB's 24 hex characters: signed email links and tracking tokens already in inboxes carry
// them, and they still sort by creation time (lib/ids.js).
const id = () => text("id").primaryKey().$defaultFn(newId);
const ref = (name) => text(name);
const at = (name) => timestamp(name, { withTimezone: true, mode: "date" });
const counter = (name) => integer(name).notNull().default(0);
const timestamps = {
	createdAt: at("created_at").notNull().defaultNow(),
	updatedAt: at("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
};

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "canceled"];
// pending: signed up to a newsletter that asks new subscribers to confirm, and hasn't yet.
export const CONTACT_STATUSES = ["active", "pending", "unsubscribed", "bounced", "complained", "dormant"];
export const MESSAGE_STATUSES = ["queued", "sent", "delivered", "bounced", "complained", "failed", "suppressed"];

export const newsletters = pgTable("newsletters", {
	_id: id(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	imageUrl: text("image_url"),
	fromName: text("from_name"),
	fromEmail: text("from_email").notNull(),
	replyTo: text("reply_to"),
	postalAddress: text("postal_address"),
	archiveEnabled: boolean("archive_enabled").notNull().default(false),
	description: text("description"),
	socialLinks: jsonb("social_links").$type().notNull().default([]),
	// The archive's author page; the author's name is fromName. { bio, imageUrl }
	author: jsonb("author").$type().notNull().default({}),
	// New signups get an email with a link and only join once they click it (confirmed opt-in).
	requireConfirmation: boolean("require_confirmation").notNull().default(false),
	// Checked when an issue is sent (lib/cleanup.js). { enabled, issues, days }; empty numbers use defaults.
	cleanup: jsonb("cleanup").$type().notNull().default({ enabled: false }),
	// { enabled, subject, previewText, markdown }
	welcome: jsonb("welcome").$type().notNull().default({ enabled: false }),
	// The newsletter's own confirmation email; the built-in one goes out until it has one.
	confirmation: jsonb("confirmation").$type().notNull().default({}),
	...timestamps,
});

export const campaigns = pgTable(
	"campaigns",
	{
		_id: id(),
		newsletterId: ref("newsletter_id")
			.notNull()
			.references(() => newsletters._id),
		subject: text("subject").notNull().default(""),
		previewText: text("preview_text").notNull().default(""),
		// rich: written in the editor, stored as an HTML fragment in html. html: a designed document sent
		// as is. markdown: older drafts and API campaigns.
		format: text("format").notNull().default("rich"),
		markdown: text("markdown").notNull().default(""),
		html: text("html").notNull().default(""),
		status: text("status").notNull().default("draft"),
		// Warm-up: send to the most engaged contacts first, capped at audienceLimit.
		audienceLimit: integer("audience_limit"),
		source: text("source").notNull().default("dashboard"),
		scheduledAt: at("scheduled_at"),
		startedAt: at("started_at"),
		sentAt: at("sent_at"),
		testSentAt: at("test_sent_at"),
		archiveSlug: text("archive_slug").unique(),
		thumbnailUrl: text("thumbnail_url"),
		// Unlisted issues keep their /p/slug page but stay off the archive index.
		archiveListed: boolean("archive_listed").notNull().default(true),
		// Pinned issues sit in the Featured row at the top of the archive.
		archivePinned: boolean("archive_pinned").notNull().default(false),
		// Archive page views, once per browser and day.
		webViews: counter("web_views"),
		statsRecipients: counter("stats_recipients"),
		statsSent: counter("stats_sent"),
		statsDelivered: counter("stats_delivered"),
		statsBounced: counter("stats_bounced"),
		statsComplained: counter("stats_complained"),
		statsOpened: counter("stats_opened"),
		statsClicked: counter("stats_clicked"),
		statsUnsubscribed: counter("stats_unsubscribed"),
		statsFailed: counter("stats_failed"),
		// The list cleanup at this send: last-chance emails sent instead of the issue, and contacts made dormant.
		lastChanceRecipients: counter("last_chance_recipients"),
		lastChanceSent: counter("last_chance_sent"),
		lastChanceDelivered: counter("last_chance_delivered"),
		lastChanceBounced: counter("last_chance_bounced"),
		lastChanceComplained: counter("last_chance_complained"),
		lastChanceFailed: counter("last_chance_failed"),
		lastChanceDormant: counter("last_chance_dormant"),
		...timestamps,
	},
	(table) => [
		index("campaigns_newsletter_created_idx").on(table.newsletterId, table.createdAt.desc()),
		index("campaigns_status_idx").on(table.status),
		index("campaigns_started_idx").on(table.startedAt.desc()),
		// The sender function's cron looks for scheduled sends that are due.
		index("campaigns_scheduled_idx").on(table.scheduledAt).where(sql`${table.status} = 'scheduled'`),
	]
);

export const contacts = pgTable(
	"contacts",
	{
		_id: id(),
		newsletterId: ref("newsletter_id")
			.notNull()
			.references(() => newsletters._id),
		email: text("email").notNull(),
		status: text("status").notNull().default("active"),
		source: text("source"),
		subscribedAt: at("subscribed_at").defaultNow(),
		confirmedAt: at("confirmed_at"),
		unsubscribedAt: at("unsubscribed_at"),
		lastSentAt: at("last_sent_at"),
		lastOpenAt: at("last_open_at"),
		lastClickAt: at("last_click_at"),
		// List cleanup (lib/cleanup.js): issues received since the last sign of life (open, click,
		// confirmation, signup, "keep sending it" click), when that was, and when the last-chance email went out.
		ignoredIssues: integer("ignored_issues"),
		lastEngagedAt: at("last_engaged_at"),
		lastChanceAt: at("last_chance_at"),
		statsSent: counter("stats_sent"),
		statsOpens: counter("stats_opens"),
		statsClicks: counter("stats_clicks"),
		// From a CSV import: engagement on the previous platform, so sends reach the most engaged first.
		importedEmailsReceived: integer("imported_emails_received"),
		importedOpenRate: real("imported_open_rate"),
		importedClickRate: real("imported_click_rate"),
		...timestamps,
	},
	(table) => [
		uniqueIndex("contacts_newsletter_email_idx").on(table.newsletterId, table.email),
		index("contacts_email_idx").on(table.email),
		// The contacts list shows the newest subscribers first, with or without newsletter and status filters.
		index("contacts_subscribed_idx").on(table.subscribedAt.desc().nullsLast(), table._id.desc()),
		index("contacts_status_subscribed_idx").on(table.status, table.subscribedAt.desc().nullsLast(), table._id.desc()),
		index("contacts_newsletter_subscribed_idx").on(table.newsletterId, table.subscribedAt.desc().nullsLast(), table._id.desc()),
		index("contacts_newsletter_status_subscribed_idx").on(
			table.newsletterId,
			table.status,
			table.subscribedAt.desc().nullsLast(),
			table._id.desc()
		),
		// The list cleanup totals in newsletter settings.
		index("contacts_last_chance_idx").on(table.newsletterId, table.lastChanceAt).where(sql`${table.lastChanceAt} is not null`),
	]
);

export const messages = pgTable(
	"messages",
	{
		_id: id(),
		kind: text("kind").notNull(),
		campaignId: ref("campaign_id"),
		newsletterId: ref("newsletter_id").notNull(),
		contactId: ref("contact_id"),
		email: text("email").notNull(),
		provider: text("provider"),
		status: text("status").notNull().default("queued"),
		providerMessageId: text("provider_message_id"),
		error: text("error"),
		sentAt: at("sent_at"),
		deliveredAt: at("delivered_at"),
		openedAt: at("opened_at"),
		clickedAt: at("clicked_at"),
		bouncedAt: at("bounced_at"),
		complainedAt: at("complained_at"),
		...timestamps,
	},
	(table) => [
		// One email per contact per campaign, even if a send is retried.
		uniqueIndex("messages_campaign_contact_idx")
			.on(table.campaignId, table.contactId)
			.where(sql`${table.kind} = 'campaign'`),
		// And at most one last-chance email per contact per send.
		uniqueIndex("messages_last_chance_idx")
			.on(table.campaignId, table.contactId)
			.where(sql`${table.kind} = 'last-chance'`),
		index("messages_provider_message_idx").on(table.providerMessageId).where(sql`${table.providerMessageId} is not null`),
		index("messages_kind_created_idx").on(table.kind, table.createdAt.desc()),
		// The overview's emails sent per hour.
		index("messages_newsletter_sent_idx").on(table.newsletterId, table.sentAt),
		index("messages_campaign_status_idx").on(table.campaignId, table.status),
		// The sender function walks queued messages in order.
		index("messages_queued_idx").on(table.campaignId, table.kind, table._id).where(sql`${table.status} = 'queued'`),
		index("messages_contact_kind_idx").on(table.contactId, table.kind),
	]
);

// Only problem events are stored (see lib/email-events.js); deliveries and engagement live on messages.
export const events = pgTable(
	"events",
	{
		_id: id(),
		type: text("type").notNull(),
		providerMessageId: text("provider_message_id"),
		messageId: ref("message_id"),
		campaignId: ref("campaign_id"),
		email: text("email"),
		occurredAt: at("occurred_at").notNull().defaultNow(),
		data: jsonb("data"),
		...timestamps,
	},
	(table) => [
		index("events_provider_message_idx").on(table.providerMessageId),
		index("events_campaign_type_idx").on(table.campaignId, table.type),
	]
);

// Global: an address that bounced or complained is never emailed again from any newsletter.
export const suppressions = pgTable(
	"suppressions",
	{
		_id: id(),
		email: text("email").notNull().unique(),
		reason: text("reason").notNull(),
		detail: text("detail"),
		...timestamps,
	},
	(table) => [index("suppressions_created_idx").on(table.createdAt)]
);

export const apiKeys = pgTable("api_keys", {
	_id: id(),
	name: text("name").notNull(),
	prefix: text("prefix").notNull(),
	hash: text("hash").notNull().unique(),
	lastUsedAt: at("last_used_at"),
	revokedAt: at("revoked_at"),
	...timestamps,
});

// One row per alert kind: lastSentAt enforces the cooldown between repeated alerts.
export const alerts = pgTable("alerts", {
	_id: id(),
	key: text("key").notNull().unique(),
	title: text("title"),
	lastSentAt: at("last_sent_at"),
	...timestamps,
});

// Rate limits shared by every server instance (lib/rate-limit.js): one counter per key and window.
export const rateLimits = pgTable(
	"rate_limits",
	{
		key: text("key").notNull(),
		windowStart: bigint("window_start", { mode: "number" }).notNull(),
		count: integer("count").notNull().default(0),
		expiresAt: at("expires_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.key, table.windowStart] }), index("rate_limits_expires_idx").on(table.expiresAt)]
);

// The sender function holds this lease while it drains the queue, so cron ticks never overlap.
export const leases = pgTable("leases", {
	name: text("name").primaryKey(),
	holder: text("holder").notNull(),
	expiresAt: at("expires_at").notNull(),
});
