-- SES and Resend both hand back a message id that their events point to.
ALTER TABLE "messages" RENAME COLUMN "ses_message_id" TO "provider_message_id";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "ses_message_id" TO "provider_message_id";--> statement-breakpoint
ALTER INDEX "messages_ses_message_idx" RENAME TO "messages_provider_message_idx";--> statement-breakpoint
ALTER INDEX "events_ses_message_idx" RENAME TO "events_provider_message_idx";
