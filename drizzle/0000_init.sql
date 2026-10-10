CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"newsletter_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preview_text" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'rich' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience_limit" integer,
	"source" text DEFAULT 'dashboard' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"test_sent_at" timestamp with time zone,
	"archive_slug" text,
	"thumbnail_url" text,
	"archive_listed" boolean DEFAULT true NOT NULL,
	"archive_pinned" boolean DEFAULT false NOT NULL,
	"web_views" integer DEFAULT 0 NOT NULL,
	"stats_recipients" integer DEFAULT 0 NOT NULL,
	"stats_sent" integer DEFAULT 0 NOT NULL,
	"stats_delivered" integer DEFAULT 0 NOT NULL,
	"stats_bounced" integer DEFAULT 0 NOT NULL,
	"stats_complained" integer DEFAULT 0 NOT NULL,
	"stats_opened" integer DEFAULT 0 NOT NULL,
	"stats_clicked" integer DEFAULT 0 NOT NULL,
	"stats_unsubscribed" integer DEFAULT 0 NOT NULL,
	"stats_failed" integer DEFAULT 0 NOT NULL,
	"last_chance_recipients" integer DEFAULT 0 NOT NULL,
	"last_chance_sent" integer DEFAULT 0 NOT NULL,
	"last_chance_delivered" integer DEFAULT 0 NOT NULL,
	"last_chance_bounced" integer DEFAULT 0 NOT NULL,
	"last_chance_complained" integer DEFAULT 0 NOT NULL,
	"last_chance_failed" integer DEFAULT 0 NOT NULL,
	"last_chance_dormant" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_archive_slug_unique" UNIQUE("archive_slug")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"newsletter_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text,
	"subscribed_at" timestamp with time zone DEFAULT now(),
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"last_open_at" timestamp with time zone,
	"last_click_at" timestamp with time zone,
	"ignored_issues" integer,
	"last_engaged_at" timestamp with time zone,
	"last_chance_at" timestamp with time zone,
	"stats_sent" integer DEFAULT 0 NOT NULL,
	"stats_opens" integer DEFAULT 0 NOT NULL,
	"stats_clicks" integer DEFAULT 0 NOT NULL,
	"imported_emails_received" integer,
	"imported_open_rate" real,
	"imported_click_rate" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"ses_message_id" text,
	"message_id" text,
	"campaign_id" text,
	"email" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"campaign_id" text,
	"newsletter_id" text NOT NULL,
	"contact_id" text,
	"email" text NOT NULL,
	"provider" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"ses_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"image_url" text,
	"from_name" text,
	"from_email" text NOT NULL,
	"reply_to" text,
	"postal_address" text,
	"archive_enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"require_confirmation" boolean DEFAULT false NOT NULL,
	"cleanup" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"welcome" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"confirmation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_newsletter_created_idx" ON "campaigns" USING btree ("newsletter_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_started_idx" ON "campaigns" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_idx" ON "campaigns" USING btree ("scheduled_at") WHERE "campaigns"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_newsletter_email_idx" ON "contacts" USING btree ("newsletter_id","email");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_subscribed_idx" ON "contacts" USING btree ("subscribed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contacts_status_subscribed_idx" ON "contacts" USING btree ("status","subscribed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contacts_newsletter_subscribed_idx" ON "contacts" USING btree ("newsletter_id","subscribed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contacts_newsletter_status_subscribed_idx" ON "contacts" USING btree ("newsletter_id","status","subscribed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contacts_last_chance_idx" ON "contacts" USING btree ("newsletter_id","last_chance_at") WHERE "contacts"."last_chance_at" is not null;--> statement-breakpoint
CREATE INDEX "events_ses_message_idx" ON "events" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "events_campaign_type_idx" ON "events" USING btree ("campaign_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_campaign_contact_idx" ON "messages" USING btree ("campaign_id","contact_id") WHERE "messages"."kind" = 'campaign';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_last_chance_idx" ON "messages" USING btree ("campaign_id","contact_id") WHERE "messages"."kind" = 'last-chance';--> statement-breakpoint
CREATE INDEX "messages_ses_message_idx" ON "messages" USING btree ("ses_message_id") WHERE "messages"."ses_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_kind_created_idx" ON "messages" USING btree ("kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_newsletter_sent_idx" ON "messages" USING btree ("newsletter_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_campaign_status_idx" ON "messages" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "messages_queued_idx" ON "messages" USING btree ("campaign_id","kind","id") WHERE "messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "messages_contact_kind_idx" ON "messages" USING btree ("contact_id","kind");--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "suppressions_created_idx" ON "suppressions" USING btree ("created_at");